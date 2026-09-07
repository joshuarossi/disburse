/** OFAC list matching. Scores describe string similarity, not an entity's risk. */
export const SCREENING_ENGINE = "ofac-sdn-v2.1";
export const NAME_THRESHOLD = 0.85;
export const OFAC_SOURCE =
  "https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml";
export type ListedAddress = { currency: string; address: string };
export type SdnEntry = {
  sdnId: number;
  entityType: "individual" | "entity";
  sourceType: string;
  primaryName: string;
  firstName: string;
  lastName: string;
  aliases: string[];
  weakAliases: string[];
  programs: string[];
  addresses: ListedAddress[];
};

export function normalizeScreeningName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
const points = (s: string) => Array.from(s);
function grams(name: string) {
  const chars = points(name);
  return [
    ...new Set(
      chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join("")),
    ),
  ];
}
export function entryNames(entry: SdnEntry) {
  return [
    ...new Set(
      [
        entry.primaryName,
        `${entry.firstName} ${entry.lastName}`.trim(),
        ...entry.aliases,
      ].filter(Boolean),
    ),
  ];
}
export function nameSearchPlan(name: string) {
  const normalized = normalizeScreeningName(name);
  const length = points(normalized).length;
  if (!length || length > 200)
    throw new Error(
      "Use a recipient name containing 1 to 200 letters or numbers for screening.",
    );
  const maximumLength = Math.floor(length / NAME_THRESHOLD + 1e-9);
  const minimumLength = Math.ceil(length * NAME_THRESHOLD - 1e-9);
  const maxEdits = Math.floor(maximumLength * (1 - NAME_THRESHOLD) + 1e-9);
  const trigrams = grams(normalized);
  const minimumShared = trigrams.length - 3 * maxEdits;
  // An edit destroys at most three of the query's distinct trigrams. When
  // repetition makes that bound unhelpful, complete length buckets preserve recall.
  const keys =
    maxEdits === 0
      ? []
      : minimumShared > 0
        ? trigrams.map((g) => `g:${g}`)
        : Array.from(
            { length: maximumLength - minimumLength + 1 },
            (_, i) => `l:${minimumLength + i}`,
          );
  return {
    normalized,
    keys: [`e:${normalized}`, ...keys],
    minimumShared: maxEdits === 0 || minimumShared <= 0 ? 1 : minimumShared,
    minimumLength,
    maximumLength,
  };
}
export function nameIndexTerms(entry: SdnEntry) {
  const terms = new Set<string>();
  for (const raw of entryNames(entry)) {
    const name = normalizeScreeningName(raw);
    if (!name) continue;
    terms.add(`e:${name}`);
    terms.add(`l:${points(name).length}`);
    for (const gram of grams(name)) terms.add(`g:${gram}`);
  }
  return [...terms];
}
export function screeningSimilarity(left: string, right: string) {
  const a = points(left),
    b = points(right);
  const length = Math.max(a.length, b.length);
  if (!length) return 0;
  const limit = Math.floor(length * (1 - NAME_THRESHOLD) + 1e-9);
  if (Math.abs(a.length - b.length) > limit) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    if (Math.min(...row) > limit) return 0;
    previous = row;
  }
  const score = 1 - previous[b.length] / length;
  return score + 1e-9 >= NAME_THRESHOLD ? score : 0;
}
export function matchSdnName(name: string, entry: SdnEntry) {
  const normalized = normalizeScreeningName(name);
  let best: {
    matchedName: string;
    matchScore: number;
    alias: "primary" | "strong" | "weak";
  } | null = null;
  for (const candidate of entryNames(entry)) {
    const score = screeningSimilarity(
      normalized,
      normalizeScreeningName(candidate),
    );
    if (score && (!best || score > best.matchScore))
      best = {
        matchedName: candidate,
        matchScore: score,
        alias:
          candidate === entry.primaryName
            ? "primary"
            : entry.weakAliases.includes(candidate)
              ? "weak"
              : "strong",
      };
  }
  return best;
}
export function addressIndexTerm(address: ListedAddress) {
  return /^0x[0-9a-f]{40}$/i.test(address.address)
    ? `a:evm:${address.address.toLowerCase()}`
    : `a:${address.currency}:${address.address}`;
}
export function listedAddressNetwork(currency: string) {
  return (
    { ETH: 1, ARB: 42161, ETC: 61, BSC: 56 } as Record<
      string,
      number | undefined
    >
  )[currency];
}
export function matchListedAddress(
  address: string,
  chainId: number | undefined,
  listed: ListedAddress,
) {
  if (
    !/^0x[0-9a-f]{40}$/i.test(address) ||
    !/^0x[0-9a-f]{40}$/i.test(listed.address) ||
    address.toLowerCase() !== listed.address.toLowerCase()
  )
    return null;
  if (chainId === 11155111 || chainId === 84532) return null;
  const listedChainId = listedAddressNetwork(listed.currency);
  return {
    address: listed.address,
    listedCurrency: listed.currency,
    listedChainId,
    networkMatch:
      !listedChainId || !chainId
        ? ("unspecified_network" as const)
        : chainId === listedChainId
          ? ("listed_network" as const)
          : ("other_network" as const),
  };
}

export function buildSdnIndex(entries: SdnEntry[]) {
  const index = new Map<string, Set<number>>();
  for (const entry of entries) {
    const terms = [
      ...nameIndexTerms(entry),
      ...entry.addresses.map(addressIndexTerm),
    ];
    for (const term of terms) {
      const ids = index.get(term) ?? new Set<number>();
      ids.add(entry.sdnId);
      index.set(term, ids);
    }
  }
  return [...index]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([term, values]) => {
      const ids = [...values].sort((a, b) => a - b);
      return Array.from(
        { length: Math.ceil(ids.length / 1000) },
        (_, part) => ({
          term,
          part,
          sdnIds: ids.slice(part * 1000, (part + 1) * 1000),
        }),
      );
    });
}
