import { beforeEach, afterEach, vi } from 'vitest';
import { refreshReportIndex } from './reportHelpers';
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { CHAIN_TOKENS } from "../../shared/chains";
import { identifyAsset, supportedReportSymbols } from "../../shared/assets";
import {
  createFullOrgSetup,
  createTestBeneficiary,
  createTestDisbursement,
  signIn,
  TEST_WALLETS,
} from "./factories";

describe("asset and environment boundaries in finance reports", () => {
  it("excludes test funds, unknown networks and same-symbol impostors from business totals", async () => {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const ids = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      const deposits = [
        {
          chainId: 1,
          tokenAddress: CHAIN_TOKENS[1].USDC.address,
          amountRaw: "corrupt",
          amount: "1000000",
          decimals: 6,
          tokenSymbol: "USDC",
        },
        {
          chainId: 1,
          tokenAddress: CHAIN_TOKENS[1].USDC.address,
          amountRaw: "1000000",
          amount: "1000000",
          decimals: 0,
          tokenSymbol: "FAKE",
        },
        {
          chainId: 8453,
          tokenAddress: CHAIN_TOKENS[8453].USDC.address,
          amountRaw: "2000000",
          amount: "2",
          decimals: 6,
          tokenSymbol: "USDC",
        },
        {
          chainId: 11155111,
          tokenAddress: CHAIN_TOKENS[11155111].USDC.address,
          amountRaw: "900000000000",
          amount: "900000",
          decimals: 6,
          tokenSymbol: "USDC",
        },
        {
          chainId: 1,
          tokenAddress: TEST_WALLETS.viewer,
          amountRaw: "60000000000",
          amount: "60000",
          decimals: 6,
          tokenSymbol: "USDC",
        },
        {
          chainId: 12345,
          tokenAddress: CHAIN_TOKENS[1].USDC.address,
          amountRaw: "7000000000",
          amount: "7000",
          decimals: 6,
          tokenSymbol: "USDC",
        },
      ];
      for (const [i, deposit] of deposits.entries())
        await ctx.db.insert("deposits", {
          ...deposit,
          orgId: ids.orgId,
          safeId: ids.safeId,
          safeAddress: ids.safeAddress,
          toAddress: ids.safeAddress,
          timestamp: Date.now(),
          txHash: `0x${String(i).repeat(64)}`,
          source: "safe_tx_service",
          createdAt: Date.now(),
        });
      return ids;
    });
    const { sessionToken } = await signIn(t, "admin");
    await refreshReportIndex(t, ids.orgId);
    const args = { orgId: ids.orgId, sessionToken };
    const business = await t.query(api.reports.getTransactionReport, args);
    expect(
      business.totals.map((t) => [t.chainId, t.token, t.inflow]).sort(),
    ).toEqual([
      [1, "USDC", "1"],
      [8453, "USDC", "2"],
    ]);
    expect(new Set(business.totals.map((t) => t.assetId)).size).toBe(2);
    expect(business.excludedCount).toBe(2);
    expect(
      business.items.find(
        (i) => i.tokenAddress === TEST_WALLETS.viewer.toLowerCase(),
      ),
    ).toMatchObject({ includedInTotals: false, amount: "60000" });
    const test = await t.query(api.reports.getTransactionReport, {
      ...args,
      environment: "test",
    });
    expect(test.totals).toHaveLength(1);
    expect(test.totals[0]).toMatchObject({
      chainId: 11155111,
      inflow: "900000",
    });
    const unknown = await t.query(api.reports.getTransactionReport, {
      ...args,
      environment: "unclassified",
    });
    expect(unknown.items).toHaveLength(2);
    expect(unknown.totals).toEqual([]);
    const currencies = await t.query(api.reports.getTransactionReport, {
      ...args,
      token: ["USDC"],
    });
    expect(currencies.items.every((row) => row.recognized)).toBe(true);
    expect(currencies.assets.some((asset) => !asset.recognized)).toBe(true);
    const otherAsset = identifyAsset(1, TEST_WALLETS.viewer, "USDC").assetId;
    const exact = await t.query(api.reports.getTransactionReport, {
      ...args,
      assetIds: [otherAsset],
    });
    expect(exact.items).toHaveLength(1);
    expect(exact.items[0]).toMatchObject({
      amount: "60000",
      includedInTotals: false,
      assetId: otherAsset,
    });
    expect(exact.totals).toEqual([]);
    const wrongEnvironment = await t.query(api.reports.getTransactionReport, {
      ...args,
      environment: "test",
      assetIds: [otherAsset],
    });
    expect(wrongEnvironment.items).toEqual([]);
    const wrongNetwork = await t.query(api.reports.getTransactionReport, {
      ...args,
      chainId: 8453,
      assetIds: [otherAsset],
    });
    expect(wrongNetwork.items).toEqual([]);
  });

  it("separates spending for the same recipient and currency across networks and retains unknown historical payments", async () => {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const ids = await createFullOrgSetup(ctx, {
        walletAddress: TEST_WALLETS.admin,
      });
      const b = await createTestBeneficiary(ctx, ids.orgId, {
        isActive: false,
      });
      for (const chainId of [1, 8453, 11155111, undefined]) {
        const id = await createTestDisbursement(
          ctx,
          ids.orgId,
          ids.safeId,
          b,
          ids.userId,
          { status: "executed", amount: "0.000001" },
        );
        await ctx.db.patch(id, { chainId });
      }
      return ids;
    });
    const { sessionToken } = await signIn(t, "admin");
    await refreshReportIndex(t, ids.orgId);
    const args = { orgId: ids.orgId, sessionToken };
    const spending = await t.query(api.reports.getSpendingByBeneficiary, args);
    expect(spending.items).toHaveLength(2);
    expect(
      spending.items.every(
        (s) =>
          s.totalPaid === "0.000001" &&
          s.beneficiaryName.endsWith("(archived)"),
      ),
    ).toBe(true);
    const unknown = await t.query(api.reports.getTransactionReport, {
      ...args,
      environment: "unclassified",
    });
    expect(unknown.items).toHaveLength(1);
    expect(unknown.items[0]).toMatchObject({
      network: "Unknown network",
      includedInTotals: false,
    });
  });

  it("never recognizes a native currency based on a reported ticker", () => {
    expect(identifyAsset(1, TEST_WALLETS.viewer, "ETH").recognized).toBe(false);
    expect(
      identifyAsset(137, "0x0000000000000000000000000000000000000000", "ETH"),
    ).toMatchObject({ token: "POL", recognized: true, decimals: 18 });
    expect(
      identifyAsset(12345, CHAIN_TOKENS[1].USDC.address, "USDC").recognized,
    ).toBe(false);
  });

  it("derives supported currency filters from the selected network and activity", () => {
    expect(supportedReportSymbols("production")).toContain("PYUSD");
    expect(supportedReportSymbols("production", 137)).toContain("POL");
    expect(supportedReportSymbols("test")).not.toContain("POL");
    expect(supportedReportSymbols("test", 1)).toEqual([]);
    expect(supportedReportSymbols("unclassified")).toEqual([]);
  });

  it("restricts deposit writes to internal sync and validates the organization, network and destination", async () => {
    const module = await import("../depositsData");
    expect(module.upsertDeposit.isInternal).toBe(true);
    expect(module.storePage.isInternal).toBe(true);
    const t = convexTest(schema);
    const ids = await t.run((ctx) =>
      createFullOrgSetup(ctx, { walletAddress: TEST_WALLETS.admin }),
    );
    const args = {
      orgId: ids.orgId,
      safeId: ids.safeId,
      chainId: 11155111,
      safeAddress: ids.safeAddress,
      toAddress: ids.safeAddress,
      tokenAddress: CHAIN_TOKENS[11155111].USDC.address,
      tokenSymbol: "USDC",
      decimals: 6,
      amountRaw: "1",
      amount: "0.000001",
      timestamp: Date.now(),
      txHash: `0x${"1".repeat(64)}`,
      transferId: `e${"1".repeat(64)}1`,
      source: "safe_tx_service" as const,
    };
    await expect(
      t.mutation(internal.depositsData.upsertDeposit, {
        ...args,
        toAddress: TEST_WALLETS.viewer,
      }),
    ).rejects.toThrow("destination");
    await expect(
      t.mutation(internal.depositsData.upsertDeposit, { ...args, chainId: 1 }),
    ).rejects.toThrow("network");
    await expect(
      t.mutation(internal.depositsData.upsertDeposit, args),
    ).resolves.toEqual({ inserted: true });
    await expect(
      t.mutation(internal.depositsData.upsertDeposit, args),
    ).resolves.toEqual({ inserted: false });
  });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
