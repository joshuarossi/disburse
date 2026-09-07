import { expect, it } from "vitest";
import { parseOfacXml } from "../lib/ofacXml";
import {
  addressIndexTerm,
  buildSdnIndex,
  matchListedAddress,
  matchSdnName,
  nameSearchPlan,
  normalizeScreeningName,
  screeningSimilarity,
  type SdnEntry,
} from "../../shared/sanctions";

const entry = (name: string, fields: Partial<SdnEntry> = {}): SdnEntry => ({
  sdnId: 1,
  primaryName: name,
  firstName: "",
  lastName: name,
  sourceType: "Individual",
  entityType: "individual",
  aliases: [],
  weakAliases: [],
  programs: [],
  addresses: [],
  ...fields,
});
const xml = (rows: string, count = 1) =>
  `<sdnList xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML"><publshInformation><Publish_Date>09/04/2026</Publish_Date><Record_Count>${count}</Record_Count></publshInformation>${rows}</sdnList>`;

it("parses the published flat XML, aliases, weak classifications and exact digital currency identifiers", () => {
  const data = parseOfacXml(
    xml(
      `<sdnEntry><uid>12</uid><firstName>María</firstName><lastName>García</lastName><sdnType>Individual</sdnType><akaList><aka><category>strong</category><lastName>Мария Гарсия</lastName></aka><aka><category>weak</category><lastName>M &amp; G</lastName></aka></akaList><programList><program>EXAMPLE</program></programList><idList><id><idType>Digital Currency Address - ETH</idType><idNumber>0x0000000000000000000000000000000000000001</idNumber></id><id><idType>Digital Currency Address - XBT</idType><idNumber>1LeadingZeroPreserved001</idNumber></id></idList></sdnEntry>`,
    ),
  );
  expect(data).toMatchObject({
    expected: 1,
    publishedAt: Date.UTC(2026, 8, 4),
    entries: [
      {
        sdnId: 12,
        primaryName: "María García",
        aliases: ["Мария Гарсия", "M & G"],
        weakAliases: ["M & G"],
        programs: ["EXAMPLE"],
        addresses: [
          {
            currency: "ETH",
            address: "0x0000000000000000000000000000000000000001",
          },
          { currency: "XBT", address: "1LeadingZeroPreserved001" },
        ],
      },
    ],
  });
});

it("rejects truncated snapshots, count mismatches, duplicate identities and entity declarations", () => {
  const row = "<sdnEntry><uid>12</uid><lastName>Example</lastName></sdnEntry>";
  for (const data of [
    xml(row).slice(0, -8),
    xml(row, 2),
    xml(row + row, 2),
    xml(""),
    "<!DOCTYPE test [<!ENTITY example 'bad'>]>" + xml(row),
    xml("<sdnEntry><uid>13</uid></sdnEntry>"),
  ])
    expect(() => parseOfacXml(data)).toThrow();
});

it("retrieves aliases independently, folds accents and punctuation, preserves non-Latin scripts and avoids empty-name matches", () => {
  const record = entry("Different primary entity", {
    aliases: ["Мария Гарсия", "María García", "محمد أحمد", "张 伟", "M & G"],
    weakAliases: ["M & G"],
  });
  for (const name of ["garcia maria", "Мария Гарсия", "محمد أحمد", "伟 张"])
    expect(matchSdnName(name, record)?.matchScore).toBe(1);
  expect(matchSdnName("M & G", record)?.alias).toBe("weak");
  expect(normalizeScreeningName("O’Neil, José")).toBe("jose oneil");
  expect(matchSdnName("Unrelated Company", record)).toBeNull();
  expect(() => nameSearchPlan("?!")).toThrow();
  expect(normalizeScreeningName("Мария")).not.toBe("");
  expect(matchSdnName("Мария", entry("张伟"))).toBeNull();
});

it("candidate lookup retains every qualifying edited name, including repeated characters and one-word typos", () => {
  const originals = [
    "Alexander",
    "Mohammed Hassan",
    "Мария Гарсия",
    "محمود احمد",
    "aaaaaaaaaaaa",
    "International Example Company",
    "李伟",
    "Jane Smith",
    "aaaaaaaaaaaaaaaaaaab",
  ];
  const records = originals.map((name, i) =>
    entry(`Primary entity ${i}`, { sdnId: i + 1, aliases: [name] }),
  );
  const index = buildSdnIndex(records);
  const inputs = new Set(originals);
  for (const original of originals) {
    const chars = Array.from(original);
    for (let position = 0; position < chars.length; position++) {
      inputs.add(
        [...chars.slice(0, position), "x", ...chars.slice(position + 1)].join(
          "",
        ),
      );
      inputs.add(
        [...chars.slice(0, position), ...chars.slice(position + 1)].join(""),
      );
      inputs.add(
        [...chars.slice(0, position), "a", ...chars.slice(position)].join(""),
      );
    }
  }
  for (const input of inputs) {
    const plan = nameSearchPlan(input);
    const counts = new Map<number, number>();
    for (const row of index.filter((p) => plan.keys.includes(p.term)))
      for (const id of row.sdnIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const record of records)
      if (matchSdnName(input, record))
        expect(counts.get(record.sdnId) ?? 0, input).toBeGreaterThanOrEqual(
          plan.minimumShared,
        );
  }
  expect(screeningSimilarity("alexandre", "alexander")).toBe(0);
  expect(matchSdnName("Alexandor", records[0])).not.toBeNull();
});

it("uses exact address identity and distinguishes listed, different, unspecified and test networks", () => {
  const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const listed = { currency: "ETH", address };
  expect(
    addressIndexTerm({
      ...listed,
      address: address.toUpperCase().replace("0X", "0x"),
    }),
  ).toBe(`a:evm:${address}`);
  expect(matchListedAddress(address, 1, listed)).toMatchObject({
    networkMatch: "listed_network",
    listedChainId: 1,
  });
  expect(matchListedAddress(address, 8453, listed)).toMatchObject({
    networkMatch: "other_network",
    listedChainId: 1,
  });
  expect(
    matchListedAddress(address, 1, { ...listed, currency: "USDT" }),
  ).toMatchObject({ networkMatch: "unspecified_network" });
  expect(matchListedAddress(address, 11155111, listed)).toBeNull();
  expect(matchListedAddress(address.slice(0, -1) + "e", 1, listed)).toBeNull();
  expect(
    matchListedAddress(address, 1, {
      currency: "XBT",
      address: "bitcoin-address",
    }),
  ).toBeNull();
});
