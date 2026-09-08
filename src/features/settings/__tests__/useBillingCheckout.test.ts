import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { useBillingCheckout } from "../useBillingCheckout";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  switchChain: vi.fn(),
  verify: vi.fn(),
  subscribe: vi.fn(),
  receipt: vi.fn(),
  create: vi.fn(), begin: vi.fn(), walletResult: vi.fn(), verifyCheckout: vi.fn(), discard: vi.fn(),
  current: null as any, saved: null as any,
}));
vi.mock("wagmi", () => ({
  useSendTransaction: () => ({
    sendTransactionAsync: mocks.send,
    isPending: false,
  }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));
vi.mock("wagmi/actions", () => ({
  getPublicClient: () => ({ waitForTransactionReceipt: mocks.receipt }),
}));
vi.mock("@/lib/wagmi", () => ({ config: {} }));
vi.mock("@/lib/session", () => ({ getSessionToken: () => "test-session" }));
vi.mock("convex/react", () => ({
  useQuery: (fn: any) => getFunctionName(fn) === 'billingCheckoutData:current' ? mocks.current : mocks.saved,
  useAction: (fn: any) => ({ 'billingCheckoutActions:begin': mocks.begin, 'billingCheckoutActions:verify': mocks.verifyCheckout, 'billingCheckoutActions:verifyReplacement': mocks.verifyCheckout }[getFunctionName(fn)] ?? mocks.verify),
  useMutation: (fn: any) => ({ 'billingCheckoutData:create': mocks.create, 'billingCheckoutData:walletResult': mocks.walletResult, 'billingCheckoutData:discard': mocks.discard }[getFunctionName(fn)] ?? mocks.subscribe),
}));

const storageKey = "disburse:pending-billing:org-test";
const hash = `0x${"ab".repeat(32)}`;
const props: Parameters<typeof useBillingCheckout>[0] = {
  orgId: "org-test",
  address: `0x${"11".repeat(20)}`,
  isAdmin: true,
  billing: {
    plan: "trial",
    isActive: true,
    paymentConfig: {
      chainId: 11155111,
      tokenAddress: `0x${"22".repeat(20)}`,
      treasury: `0x${"33".repeat(20)}`,
      decimals: 6,
      symbol: "USDC",
      testnet: true,
      network: "Sepolia",
      explorer: "https://sepolia.etherscan.io",
    },
  } as NonNullable<Parameters<typeof useBillingCheckout>[0]["billing"]>,
};
function open() {
  const hook = renderHook(() => useBillingCheckout(props));
  act(() => hook.result.current.handleOpenPayment("team"));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.current = null; mocks.saved = null;
  mocks.create.mockResolvedValue('checkout-test');
  mocks.begin.mockResolvedValue({ to: `0x${'22'.repeat(20)}`, data: '0xa9059cbb', chainId: 11155111, nonce: 7, attemptId: 'attempt-test', payer: props.address });
  mocks.walletResult.mockResolvedValue(undefined);
  mocks.verifyCheckout.mockResolvedValue({ status: 'applied' });
  mocks.switchChain.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(hash);
  mocks.receipt.mockResolvedValue({ status: "success" });
  mocks.verify.mockResolvedValue({ verified: true });
  mocks.subscribe.mockResolvedValue({ success: true });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<unknown>,
      ) => callback({}),
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("subscription checkout recovery", () => {
  it("restores an earlier unknown wallet request without exposing another send", () => {
    localStorage.setItem(storageKey, JSON.stringify({ attemptId: 'unknown', startedAt: Date.now(), plan: 'team' }));
    const hook = open();
    expect(hook.result.current.hasPendingBilling).toBe(true);
    expect(hook.result.current.paymentStep).toBe('confirm');
    expect(hook.result.current).not.toHaveProperty('handlePayWithWallet');
  });

  it("holds checkout when recovery storage is unreadable", () => {
    localStorage.setItem(storageKey, 'truncated recovery');
    const hook = open();
    expect(hook.result.current.hasPendingBilling).toBe(true);
    expect(hook.result.current.billingError).toContain('could not be read');
  });

  it("recovers a saved company account checkout with its original plan", () => {
    mocks.current = { _id: 'checkout-test', safeId: 'safe-test', plan: 'pro', status: 'requested', active: true, payer: props.address, chainId: 8453, amountRaw: '99000000' };
    const hook = open();
    expect(hook.result.current.selectedPlan).toBe('pro');
    expect(hook.result.current.paymentStep).toBe('select');
    expect(hook.result.current.hasPendingBilling).toBe(false);
    expect(hook.result.current.checkout?.safeId).toBe('safe-test');
  });

  it("shows success after the server applies the account receipt", async () => {
    const hook = open();
    act(() => hook.result.current.setCheckoutId('checkout-test' as any));
    mocks.saved = { _id: 'checkout-test', safeId: 'safe-test', plan: 'team', status: 'applied', active: false, payer: props.address, chainId: 8453, amountRaw: '50000000', txHash: hash };
    hook.rerender();
    expect(hook.result.current.paymentStep).toBe('success');
    expect(hook.result.current.txHash).toBe(hash);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("does not use an unrelated reverted receipt to release a request with an unknown hash", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        attemptId: "unknown",
        startedAt: Date.now(),
        plan: "team",
      }),
    );
    mocks.verify.mockRejectedValue(
      new ConvexError({
        code: "BILLING_PAYMENT_REVERTED",
        txHash: hash,
        message: "This transaction reverted.",
      }),
    );
    const hook = open();
    await act(() => hook.result.current.handleConfirmPayment(hash));
    expect(hook.result.current.hasPendingBilling).toBe(true);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("releases a server-confirmed reverted receipt only when it matches the saved payment", async () => {
    localStorage.setItem(storageKey, JSON.stringify({ hash, plan: "team" }));
    mocks.verify.mockRejectedValueOnce(
      new ConvexError({
        code: "BILLING_PAYMENT_REVERTED",
        txHash: hash,
        message: "No subscription payment was collected.",
      }),
    );
    const hook = open();
    await act(() => hook.result.current.handleConfirmPayment(hash));
    expect(hook.result.current.hasPendingBilling).toBe(false);
    expect(hook.result.current.paymentStep).toBe("select");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

});
