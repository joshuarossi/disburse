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
  it("keeps an unknown wallet request across remounts and refuses another payment", async () => {
    mocks.send.mockImplementation(async () => {
      expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
        plan: "team",
        payer: props.address,
        chainId: 11155111,
      });
      throw new Error("Wallet transport lost after broadcast");
    });
    const first = open();
    await act(() => first.result.current.handlePayWithWallet());
    expect(first.result.current.paymentStep).toBe("confirm");
    expect(first.result.current.billingError).toContain(
      "response was interrupted",
    );
    first.unmount();
    const second = open();
    expect(second.result.current.hasPendingBilling).toBe(true);
    expect(second.result.current.txHash).toBeUndefined();
    await act(() => second.result.current.handlePayWithWallet());
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("releases an explicitly declined send for a fresh reviewed attempt", async () => {
    mocks.send.mockRejectedValueOnce({ cause: { code: 4001 } });
    const hook = open();
    await act(() => hook.result.current.handlePayWithWallet());
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(hook.result.current.hasPendingBilling).toBe(false);
    expect(hook.result.current.billingError).toContain(
      "Wallet approval declined",
    );
    await act(() => hook.result.current.handlePayWithWallet());
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.verifyCheckout).toHaveBeenCalledWith(expect.objectContaining({ txHash: hash, checkoutId: 'checkout-test' }));
    expect(hook.result.current.paymentStep).toBe("success");
  });

  it("does not open a payment request when recovery storage fails", async () => {
    const hook = open();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });
    await act(() => hook.result.current.handlePayWithWallet());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(hook.result.current.billingError).toContain(
      "Could not save billing recovery",
    );
  });

  it("holds checkout when an earlier record is unreadable", async () => {
    localStorage.setItem(storageKey, "truncated recovery data");
    const hook = open();
    expect(hook.result.current.hasPendingBilling).toBe(true);
    expect(hook.result.current.billingError).toContain("could not be read");
    await act(() => hook.result.current.handlePayWithWallet());
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps the original receipt when confirmation fails after the wallet returns its hash", async () => {
    mocks.receipt.mockRejectedValueOnce(new Error("RPC unavailable"));
    const hook = open();
    await act(() => hook.result.current.handlePayWithWallet());
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
      hash,
      plan: "team",
    });
    expect(hook.result.current.paymentStep).toBe("confirm");
    await act(() => hook.result.current.handleConfirmPayment(hash));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.verifyCheckout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(storageKey)).toBeNull();
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

  it("does not request funds while another tab owns checkout", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object | null) => Promise<unknown>,
        ) => callback(null),
      },
    });
    const hook = open();
    await act(() => hook.result.current.handlePayWithWallet());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(hook.result.current.billingError).toContain("another tab");
  });
});
