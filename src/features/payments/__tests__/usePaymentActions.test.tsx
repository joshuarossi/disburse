import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { usePaymentActions } from "../usePaymentActions";
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  action: vi.fn(),
  mutation: vi.fn(),
  update: vi.fn(),
  schedule: vi.fn(),
  sign: vi.fn(),
  execute: vi.fn(),
  relayEnabled: true,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "owner" }),
  useChainId: () => 11155111,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));
vi.mock("@/lib/session", () => ({ useSessionToken: () => "session" }));
vi.mock("@/lib/convex", () => ({
  convex: {
    query: (...args: unknown[]) => mock.query(...args),
    action: (...args: unknown[]) => mock.action(...args),
    mutation: (...args: unknown[]) => mock.mutation(...args),
  },
}));
vi.mock("@/lib/relayConfig", () => ({
  get RELAY_FEATURE_ENABLED() {
    return mock.relayEnabled;
  },
  resolveRelaySettings: () => ({ relayFeeMode: "stablecoin_only" }),
}));
vi.mock("@/lib/accountApproval", () => ({
  signAccountApproval: (...args: unknown[]) => mock.sign(...args),
  sendApprovedAccountPayment: (...args: unknown[]) => mock.execute(...args),
}));
const signingRequest = { proposal: { safeTxHash: 'proposal-hash' }, paths: [{ path: ['account'], labels: ['Operations'], approved: false }], blockNumber: '100' };
const id = "payment" as Id<"disbursements">;
const account = { _id: "safe", safeAddress: "account" } as Doc<"safes">;
const org = { _id: "org" } as Doc<"orgs">;
const payment = {
  _id: id,
  orgId: "org",
  safeId: "safe",
  chainId: 11155111,
  token: "USDC",
  status: "draft",
  type: "batch",
  recipients: [
    { recipientAddress: "maya", amount: "1.000001" },
    { recipientAddress: "james", amount: "2.000002" },
  ],
};
beforeEach(() => {
  mock.relayEnabled = true;
  mock.query.mockImplementation(async (ref) =>
    getFunctionName(ref).includes("screening")
      ? { flagged: [], enforcement: "off" }
      : payment,
  );
  mock.action.mockImplementation(async ref => {
    if (getFunctionName(ref) === 'accountApprovals:forSigning') return signingRequest;
    if (getFunctionName(ref) === 'accountApprovals:save') return 'proposal-hash';
    if (getFunctionName(ref) === 'nativePayments:start') return { success: true, attemptId: 'attempt-1' };
    if (getFunctionName(ref) === 'accountApprovals:execution') return { to: 'account', data: 'execution-data' };
  });
  mock.mutation.mockImplementation(async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === 'disbursements:updateStatus') return mock.update(args);
    if (name === 'disbursements:schedule') return mock.schedule(args);
    return { token: 'USDT', tokenAddress: 'fee-token', collector: 'collector', amount: '0.05' };
  });
  mock.sign.mockResolvedValue("proposal-hash");
});

it("persists native recovery before broadcasting and offers settlement checking after a lost wallet response", async () => {
  mock.relayEnabled = false;
  mock.query.mockImplementation(async (ref) =>
    getFunctionName(ref).includes("screening")
      ? { flagged: [], enforcement: "off" }
      : { ...payment, status: "proposed", safeTxHash: "original-hash" },
  );
  mock.execute.mockImplementation(async () => {
    expect(mock.action.mock.calls.map((c) => getFunctionName(c[0]))).toContain(
      "nativePayments:start",
    );
    throw new Error("Wallet response lost after broadcasting");
  });
  const { result } = renderHook(() => usePaymentActions([account], org));
  await act(async () => result.current.run(id, "execute"));
  expect(result.current.error).toContain("Use Check settlement");
  expect(mock.execute).toHaveBeenCalledWith(
    11155111,
    "owner",
    { to: "account", data: "execution-data" },
  );
  expect(mock.update).not.toHaveBeenCalled();
  expect(mock.sign).not.toHaveBeenCalled();
});

it("does not broadcast a native payment if saving its recovery checkpoint fails", async () => {
  mock.relayEnabled = false;
  mock.query.mockImplementation(async (ref) =>
    getFunctionName(ref).includes("screening")
      ? { flagged: [], enforcement: "off" }
      : { ...payment, status: "proposed", safeTxHash: "original-hash" },
  );
  mock.action.mockImplementation(async (ref) => {
    if (getFunctionName(ref) === "nativePayments:start")
      throw new Error("Database unavailable");
  });
  const { result } = renderHook(() => usePaymentActions([account], org));
  await act(async () => result.current.run(id, "execute"));
  expect(result.current.error).toContain("Database unavailable");
  expect(mock.execute).not.toHaveBeenCalled();
});

it('records an explicit wallet decline and resumes the same approved payment after reload', async () => {
  const original = { ...payment, status: 'proposed', approvalMethod: 'workspace', safeTxHash: 'original-hash' };
  mock.query.mockImplementation(async ref => getFunctionName(ref).includes('screening') ? { flagged: [], enforcement: 'off' } : original);
  // The execution method is bound to the approved payment, even if the current
  // workspace default now enables managed fees.
  mock.relayEnabled = true;
  mock.execute.mockRejectedValueOnce(Object.assign(new Error('User declined'), { cause: { code: 4001 } }));
  const first = renderHook(() => usePaymentActions([account], org));
  await act(async () => first.result.current.run(id, 'execute'));
  expect(first.result.current.error).toBe('');
  expect(first.result.current.message).toContain('Retry the original payment');
  expect(mock.mutation.mock.calls.some(([ref, args]) => getFunctionName(ref) === 'nativePayments:walletRejected' && args.attemptId === 'attempt-1')).toBe(true);
  first.unmount();
  mock.query.mockImplementation(async ref => getFunctionName(ref).includes('screening') ? { flagged: [], enforcement: 'off' } : { ...original, status: 'relaying', nativeExecution: { walletRejectedAt: Date.now() } });
  mock.execute.mockResolvedValueOnce('confirmed-broadcast');
  const next = renderHook(() => usePaymentActions([account], org));
  await act(async () => next.result.current.run(id, 'execute'));
  expect(next.result.current.error).toBe('');
  expect(mock.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'relaying', txHash: 'confirmed-broadcast' }));
  expect(mock.sign).not.toHaveBeenCalled();
  expect(mock.action.mock.calls.filter(([ref]) => getFunctionName(ref) === 'nativePayments:start')).toHaveLength(2);
  expect(mock.action.mock.calls.some(([ref]) => getFunctionName(ref) === 'relayExecutor:submit')).toBe(false);
});

it('does not treat a lost RPC response or a rejected save as proof of a declined broadcast', async () => {
  mock.query.mockImplementation(async ref => getFunctionName(ref).includes('screening') ? { flagged: [], enforcement: 'off' } : { ...payment, status: 'proposed', approvalMethod: 'workspace', safeTxHash: 'original-hash' });
  mock.execute.mockRejectedValueOnce(new Error('rejected by RPC: connection closed'));
  const first = renderHook(() => usePaymentActions([account], org));
  await act(async () => first.result.current.run(id, 'execute'));
  expect(first.result.current.error).toContain('Use Check settlement');
  expect(mock.mutation.mock.calls.some(([ref]) => getFunctionName(ref) === 'nativePayments:walletRejected')).toBe(false);
  mock.execute.mockResolvedValueOnce('broadcast-hash');
  mock.update.mockRejectedValueOnce(Object.assign(new Error('Save rejected'), { code: 4001 }));
  await act(async () => first.result.current.run(id, 'execute'));
  expect(first.result.current.error).toContain('Use Check settlement');
  expect(mock.mutation.mock.calls.some(([ref]) => getFunctionName(ref) === 'nativePayments:walletRejected')).toBe(false);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("approves the server-prepared intent only after validating the reviewed fee", async () => {
  const { result } = renderHook(() => usePaymentActions([account], org));
  await act(async () => result.current.run(id, "propose", "", "reviewed-fee"));
  expect(mock.sign).toHaveBeenCalledWith(11155111, 'owner', signingRequest.proposal, ['account']);
  expect(mock.action.mock.calls.map(c => getFunctionName(c[0]))).toEqual(['relayExecutor:checkFee', 'accountApprovals:forSigning', 'accountApprovals:save']);
  expect(mock.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "proposed",
      safeTxHash: "proposal-hash",
    }),
  );
  expect(
    mock.action.mock.calls.map((c) => getFunctionName(c[0])),
  ).not.toContain("relayExecutor:submit");
});
it("wallet rejection leaves the draft pending without submitting or scheduling", async () => {
  mock.sign.mockRejectedValue(new Error("User rejected signature"));
  const { result } = renderHook(() => usePaymentActions([account], org));
  await act(async () => result.current.run(id, "propose", "", "reviewed-fee"));
  expect(result.current.error).toContain("User rejected signature");
  expect(mock.update).toHaveBeenCalledTimes(1);
  expect(mock.update).toHaveBeenCalledWith(
    expect.objectContaining({ status: "pending" }),
  );
  expect(mock.schedule).not.toHaveBeenCalled();
  expect(
    mock.action.mock.calls.map((c) => getFunctionName(c[0])),
  ).not.toContain("relayExecutor:submit");
});
it("a future payment saves its approved schedule without immediate submission", async () => {
  const scheduledAt = Date.now() + 86400000;
  mock.query.mockImplementation(async (ref) =>
    getFunctionName(ref).includes("screening")
      ? { flagged: [], enforcement: "off" }
      : { ...payment, scheduledAt },
  );
  const { result } = renderHook(() => usePaymentActions([account], org));
  await act(async () => result.current.run(id, "propose", "", "reviewed-fee"));
  expect(mock.schedule).toHaveBeenCalledWith(
    expect.objectContaining({ scheduledAt, safeTxHash: "proposal-hash" }),
  );
  expect(
    mock.action.mock.calls.map((c) => getFunctionName(c[0])),
  ).not.toContain("relayExecutor:submit");
});

it("recovers interrupted preparation with the saved proposal and fee, without requesting another signature", async () => {
  const saved = { safeTxHash: 'proposal-hash' };
  mock.update.mockImplementation(async args => { if (args.status === 'proposed') throw new Error('Response lost after approval'); });
  const { result } = renderHook(() => usePaymentActions([account], org));
  await act(async () => result.current.run(id, "propose", "", "reviewed-fee"));
  expect(mock.action.mock.calls.map((c) => getFunctionName(c[0]))).toContain(
    "accountApprovals:save",
  );
  expect(result.current.error).toContain("Use Resume preparation");
  mock.query.mockImplementation(async (ref) => {
    const name = getFunctionName(ref);
    if (name.includes("screening")) return { flagged: [], enforcement: "off" };
    return {
      ...payment,
      status: "pending",
      approvalMethod: "workspace",
      safeTxHash: saved.safeTxHash,
      preparedProposalAt: Date.now(),
      executionFee: {
        token: "USDT",
        tokenAddress: "fee-token",
        collector: "collector",
        amount: "0.05",
      },
    };
  });
  mock.update.mockResolvedValue(undefined);
  await act(async () => result.current.run(id, "resumeProposal"));
  expect(result.current.error).toBe("");
  expect(mock.sign).toHaveBeenCalledTimes(1);
  expect(mock.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "proposed",
      safeTxHash: saved.safeTxHash,
      relayFeeTokenSymbol: "USDT",
    }),
  );
});
