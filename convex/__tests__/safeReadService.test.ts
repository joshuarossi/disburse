import { expect, it } from "vitest";
import { safeReadHeaders } from "../lib/safeReadService";
it("permits only the explicitly selected free authenticated plan", () => {
  expect(
    safeReadHeaders(8453, {
      SAFE_TX_SERVICE_API_KEY: "test-placeholder",
      SAFE_TX_SERVICE_PLAN: "builder",
    }),
  ).toEqual({ Authorization: "Bearer test-placeholder" });
});
it.each(["growth", "scale", "public", undefined])(
  "refuses to use an unreviewed or paid key for %s",
  (plan) => {
    expect(() =>
      safeReadHeaders(8453, {
        SAFE_TX_SERVICE_API_KEY: "test-placeholder",
        SAFE_TX_SERVICE_PLAN: plan,
      }),
    ).toThrow("free Safe Builder");
  },
);
it.each([1, 137, 8453, 42161])(
  "does not silently depend on exploration-only access on production network %s",
  (chainId) => {
    expect(() => safeReadHeaders(chainId, {})).toThrow("not configured");
  },
);
it.each([11155111, 84532])(
  "keeps unbilled public exploration on testnet %s",
  (chainId) => {
    expect(safeReadHeaders(chainId, {})).toBeUndefined();
  },
);
it("does not accept a free-plan declaration with a missing key", () => {
  expect(() =>
    safeReadHeaders(8453, { SAFE_TX_SERVICE_PLAN: "builder" }),
  ).toThrow("free Safe Builder");
});
