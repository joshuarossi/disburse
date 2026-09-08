import { expect, it } from "vitest";
import { accountChangeProgress } from "../accountChangeLifecycle";

it("keeps original provider identity and a monotonic recovery cursor across interrupted checks", () => {
  const original = {
    txHash: `0x${"ab".repeat(32)}`,
    providerId: "request-1",
    searchFromBlock: "1000",
    checks: 4,
  };
  const progress = accountChangeProgress(original, { searchFromBlock: "999" });
  expect(progress).toEqual({ ...original, checks: 5 });
  expect(accountChangeProgress(progress, { searchFromBlock: "1500" })).toEqual({
    ...original,
    searchFromBlock: "1500",
    checks: 6,
  });
  expect(() =>
    accountChangeProgress(original, { txHash: `0x${"cd".repeat(32)}` }),
  ).toThrow("cannot be replaced");
  expect(() =>
    accountChangeProgress(original, { providerId: "request-2" }),
  ).toThrow("cannot be replaced");
  expect(() =>
    accountChangeProgress(
      { searchFromBlock: "1000", checks: 0 },
      { txHash: "invalid" },
    ),
  ).toThrow();
});
