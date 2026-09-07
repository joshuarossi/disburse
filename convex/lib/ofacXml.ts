import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { SdnEntry } from "../../shared/sanctions";

type RawSdnEntry = {
  uid?: string;
  firstName?: string;
  lastName?: string;
  sdnType?: string;
  akaList?: {
    aka?: Array<{ firstName?: string; lastName?: string; category?: string }>;
  };
  idList?: { id?: Array<{ idType?: string; idNumber?: string }> };
  programList?: { program?: string[] };
};

export function parseOfacXml(xml: string) {
  if (
    xml.length > 64 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error("The OFAC download is not a complete supported XML file.");
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
    isArray: (name) => ["sdnEntry", "aka", "id", "program"].includes(name),
  });
  const root = parser.parse(xml).sdnList as
    | {
        publshInformation?: { Record_Count?: string; Publish_Date?: string };
        sdnEntry?: RawSdnEntry[];
      }
    | undefined;
  const expected = Number(root?.publshInformation?.Record_Count);
  const publishedDate = String(root?.publshInformation?.Publish_Date ?? "");
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(publishedDate);
  const publishedAt = match
    ? Date.UTC(+match[3], +match[1] - 1, +match[2])
    : NaN;
  if (
    !Number.isSafeInteger(expected) ||
    expected < 1 ||
    expected > 100_000 ||
    !Number.isFinite(publishedAt) ||
    !match ||
    new Date(publishedAt).getUTCMonth() !== +match[1] - 1 ||
    new Date(publishedAt).getUTCDate() !== +match[2] ||
    publishedAt > Date.now() + 86400_000
  )
    throw new Error("The OFAC publication metadata is invalid.");
  const rows = root?.sdnEntry;
  if (!Array.isArray(rows) || rows.length !== expected)
    throw new Error(
      "The OFAC record count does not match its publication metadata.",
    );
  const ids = new Set<number>();
  const entries: SdnEntry[] = rows.map((row) => {
    const sdnId = Number(row.uid);
    const firstName = String(row.firstName ?? "").trim(),
      lastName = String(row.lastName ?? "").trim();
    const primaryName = [firstName, lastName].filter(Boolean).join(" ");
    if (
      !Number.isSafeInteger(sdnId) ||
      sdnId < 1 ||
      ids.has(sdnId) ||
      !primaryName
    )
      throw new Error(
        "The OFAC download contains an invalid or duplicate identity.",
      );
    ids.add(sdnId);
    const aliases: string[] = [],
      weakAliases: string[] = [];
    for (const alias of row.akaList?.aka ?? []) {
      const name = [alias.firstName, alias.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (name) {
        aliases.push(name);
        if (String(alias.category).toLowerCase() === "weak")
          weakAliases.push(name);
      }
    }
    const addresses: SdnEntry["addresses"] = [];
    for (const identifier of row.idList?.id ?? []) {
      const currency = /^Digital Currency Address\s*-\s*(\w+)$/i
        .exec(String(identifier.idType ?? ""))?.[1]
        .toUpperCase();
      if (!currency) continue;
      const address = String(identifier.idNumber ?? "").trim();
      if (!address || address.length > 256 || /\s/.test(address))
        throw new Error(
          "An OFAC digital currency identifier could not be parsed.",
        );
      addresses.push({ currency, address });
    }
    const sourceType = String(row.sdnType ?? "");
    return {
      sdnId,
      entityType: sourceType === "Individual" ? "individual" : "entity",
      sourceType,
      primaryName,
      firstName,
      lastName,
      aliases: [...new Set(aliases)],
      weakAliases: [...new Set(weakAliases)],
      programs: (row.programList?.program ?? []).map(String),
      addresses,
    };
  });
  return { entries, publishedAt, expected };
}
