import { keccak256, stringToHex } from "viem";

/** Stable across JSON transport key ordering; callers supply validated JSON values. */
export const fingerprint = (value: unknown) =>
  keccak256(
    stringToHex(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    ),
  );
