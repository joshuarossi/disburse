import { useActivityEnvironment } from "@/features/workspace/ActivityEnvironment";
import { chainEnvironment } from "../../../shared/assets";
import { AccountFundingCheck } from "@/features/payments/AccountFundingCheck";
import { recipientPayoutIssue } from "../../../shared/recipientAssurance";
import { formatMoney } from "@/lib/formatMoney";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Search,
  ShieldCheck,
  Users,
  CalendarDays,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSessionToken } from "@/lib/session";
import { getChainName, getTokenSymbolsForChain } from "@/lib/chains";
import {
  amountToBaseUnits,
  formatBaseUnits,
  isValidAddress,
} from "../../../shared/validation";
import { nextPayDate, type Cadence } from "../../../shared/recurrence";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/Dialog";
import { payoutInstructionError } from "../../../shared/payoutInstructions";

export type EditableBatch = {
  id: Id<"disbursements">;
  name: string;
  purpose: "payroll" | "invoice" | "other";
  chainId: number;
  safeId?: Id<"safes">;
  token: string;
  payDate?: number;
  recipients: Array<{
    beneficiaryId: string;
    amount: string;
    recipientAddress?: string;
    recipientName?: string;
  }>;
};

export function PaymentBatchForm({
  orgId,
  onClose,
  initialPurpose = "payroll",
  initialRecipientIds = [],
  initialCadence = "once",
  initialChainId,
  initialSafeId,
  draft,
}: {
  orgId: Id<"orgs">;
  onClose: () => void;
  initialPurpose?: "payroll" | "invoice" | "other";
  initialRecipientIds?: string[];
  initialCadence?: "once" | Cadence;
  initialChainId?: number;
  initialSafeId?: Id<"safes">;
  draft?: EditableBatch;
}) {
  const sessionToken = useSessionToken();
  const args = sessionToken ? { orgId, sessionToken } : "skip";
  const beneficiaries = useQuery(
    api.beneficiaries.list,
    args === "skip" ? args : { ...args, activeOnly: true, includeTags: true },
  );
  const payoutRecipients = beneficiaries?.map((recipient) => {
    const saved = draft?.recipients.find(
      (row) => row.beneficiaryId === recipient._id,
    );
    return {
      ...recipient,
      walletAddress: saved?.recipientAddress ?? recipient.walletAddress,
      name: saved?.recipientName ?? recipient.name,
    };
  });
  const { environment } = useActivityEnvironment();
  const allSafes = useQuery(api.safes.getForOrg, args);
  const safes = allSafes?.filter(
    (safe) => safe.isActive !== false && chainEnvironment(safe.chainId) === environment,
  );
  const createGrouped = useMutation(api.paymentRuns.createGrouped);
  const useSavedInstructions = !draft;
  const [createdBatches, setCreatedBatches] = useState<Array<{
    disbursementId: Id<"disbursements">;
    token: string;
    chainId: number;
    recipientCount: number;
  }> | null>(null);
  const updateDraft = useMutation(api.paymentRuns.updateDraft);
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(draft?.name ?? "");
  const [purpose, setPurpose] = useState(draft?.purpose ?? initialPurpose);
  const initialRecipient = beneficiaries?.find((b) =>
    initialRecipientIds.includes(b._id),
  );
  const [chain, setChain] = useState<number | null>(
    draft?.chainId ?? initialChainId ?? null,
  );
  const chainId =
    chain ?? initialRecipient?.preferredChainId ?? safes?.[0]?.chainId;
  const [accountChoices, setAccountChoices] = useState<Record<number, string>>({});
  const accountFor = (network: number | undefined) => {
    const candidates = safes?.filter(s => s.chainId === network) ?? [];
    const initial = draft?.safeId ?? initialSafeId;
    const initialNetwork = draft?.chainId ?? initialChainId ?? allSafes?.find(s => s._id === initial)?.chainId;
    const choice = network === undefined ? undefined
      : accountChoices[network] ?? (network === initialNetwork ? initial : undefined);
    return choice ? candidates.find(s => s._id === choice)
      : candidates.length === 1 ? candidates[0] : undefined;
  };
  const tokens = chainId ? getTokenSymbolsForChain(chainId) : [];
  const [chosenToken, setToken] = useState<string | null>(draft?.token ?? null);
  const token =
    chosenToken ?? initialRecipient?.preferredToken ?? tokens[0] ?? "USDC";
  const [payDate, setPayDate] = useState(
    new Date(draft?.payDate ?? Date.now() + 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const [timing, setTiming] = useState<"now" | "scheduled">(
    draft?.payDate || initialCadence !== "once" ? "scheduled" : "now",
  );
  const [cadence, setCadence] = useState<"once" | Cadence>(initialCadence);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    draft
      ? Object.fromEntries(
          draft.recipients.map((r) => [r.beneficiaryId, r.amount]),
        )
      : Object.fromEntries(initialRecipientIds.map((id) => [id, ""])),
  );
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [sameAmount, setSameAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const selected =
    payoutRecipients?.filter((b) =>
      Object.prototype.hasOwnProperty.call(amounts, b._id),
    ) ?? [];
  const unavailableSelections = beneficiaries ? Object.keys(amounts).filter(id => !payoutRecipients?.some(recipient => recipient._id === id)) : [];
  const payoutFor = (recipient: {
    preferredToken?: string;
    preferredChainId?: number;
  }) => ({
    token: useSavedInstructions ? (recipient.preferredToken ?? token) : token,
    chainId: useSavedInstructions
      ? (recipient.preferredChainId ?? chainId)
      : chainId,
  });
  const paymentGroups = [
    ...selected
      .reduce((map, recipient) => {
        const payout = payoutFor(recipient);
        const key = `${payout.chainId}:${payout.token}`;
        const group = map.get(key) ?? { ...payout, recipients: [] };
        group.recipients.push(recipient);
        map.set(key, group);
        return map;
      }, new Map<string, { token: string; chainId: number | undefined; recipients: typeof selected }>())
      .values(),
  ];
  const groupTotal = (group: (typeof paymentGroups)[number]) => {
    try {
      return formatBaseUnits(
        group.recipients.reduce(
          (sum, r) =>
            sum +
            (amounts[r._id]
              ? amountToBaseUnits(amounts[r._id], group.token)
              : 0n),
          0n,
        ),
        group.token,
      );
    } catch {
      return null;
    }
  };
  const fundingAccounts = (safes ?? [])
    .filter((s) =>
      paymentGroups.length
        ? paymentGroups.some((g) => accountFor(g.chainId)?._id === s._id)
        : accountFor(chainId)?._id === s._id,
    )
    .map((account) => ({
      ...account,
      payments: paymentGroups
        .filter((g) => g.chainId === account.chainId)
        .map((g) => ({ token: g.token, amount: groupTotal(g) })),
    }));
  const instructionErrors = selected.flatMap((recipient) => {
    const reviewIssue = recipientPayoutIssue(recipient);
    if (reviewIssue)
      return [
        `${recipient.name}: ${reviewIssue}. Complete the payout review in Recipients first.`,
      ];
    const payout = payoutFor(recipient);
    if (
      !payout.chainId ||
      !safes?.some((safe) => safe.chainId === payout.chainId)
    )
      return [
        `${recipient.name} needs a linked funding account on ${payout.chainId ? getChainName(payout.chainId) : "their payment network"}.`,
      ];
    if (!getTokenSymbolsForChain(payout.chainId).includes(payout.token))
      return [
        `${recipient.name}: ${payout.token} is unavailable on ${getChainName(payout.chainId)}.`,
      ];
    const error = payoutInstructionError(recipient, {
      ...payout,
      chainId: payout.chainId,
    });
    return error ? [error] : [];
  });
  const groups = [
    ...new Set(beneficiaries?.flatMap((b) => b.tags ?? []) ?? []),
  ];
  const filtered =
    payoutRecipients?.filter(
      (b) =>
        isValidAddress(b.walletAddress) &&
        !recipientPayoutIssue(b) &&
        b.name.toLowerCase().includes(search.toLowerCase()) &&
        (!group || b.tags?.includes(group)),
    ) ?? [];
  const total = useMemo(() => {
    try {
      return formatBaseUnits(
        Object.values(amounts).reduce(
          (sum, amount) =>
            sum + (amount ? amountToBaseUnits(amount, token) : 0n),
          0n,
        ),
        token,
      );
    } catch {
      return null;
    }
  }, [amounts, token]);
  const date = new Date(`${payDate}T12:00:00Z`).getTime();
  const nextDates = [];
  if (cadence !== "once" && Number.isFinite(date)) {
    let next = date;
    for (let i = 0; i < 3; i++) {
      nextDates.push(
        new Date(next).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      );
      next = nextPayDate(next, cadence, new Date(date).getUTCDate());
    }
  }
  const validate = (includeTiming = true) => {
    if (includeTiming && !name.trim())
      return "Give this payment a name so your team can find it later.";
    if (
      !useSavedInstructions &&
      (!chainId ||
        !tokens.length ||
        !safes?.some((safe) => safe.chainId === chainId))
    )
      return "Connect a funding account before creating a batch.";
    if (!useSavedInstructions && !tokens.includes(token))
      return "This funding account does not support the requested currency. Choose a compatible account.";
    if (
      includeTiming &&
      timing === "scheduled" &&
      (!Number.isFinite(date) || date <= Date.now())
    )
      return "Choose a future pay date.";
    if (!selected.length) return "Select at least one recipient.";
    if (instructionErrors.length) return instructionErrors[0]!;
    for (const group of paymentGroups)
      if (!accountFor(group.chainId))
        return `Choose the funding account for ${getChainName(group.chainId!)}.`;
    if (selected.length > 200) return "Use up to 200 recipients in one batch.";
    if (selected.length !== Object.keys(amounts).length)
      return "A selected recipient is no longer available. Select your recipients again.";
    try {
      for (const recipient of selected)
        amountToBaseUnits(amounts[recipient._id], payoutFor(recipient).token);
    } catch {
      return "Enter a positive amount with up to 6 decimal places for every recipient.";
    }
    return "";
  };
  const submit = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      setStep(validate(false) ? 1 : 2);
      return;
    }
    if (!sessionToken || !chainId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (!draft) {
        const result = await createGrouped({
          orgId,
          sessionToken,
          name,
          purpose,
          payDate: timing === "scheduled" ? date : undefined,
          cadence: cadence === "once" ? undefined : cadence,
          recipients: selected.map((recipient) => ({
            beneficiaryId: recipient._id,
            amount: amounts[recipient._id],
            token: payoutFor(recipient).token,
            chainId: payoutFor(recipient).chainId!,
            safeId: accountFor(payoutFor(recipient).chainId)!._id,
          })),
        });
        setCreatedBatches(result.batches);
        return;
      }
      const fields = {
        sessionToken,
        name,
        purpose,
        chainId,
        safeId: accountFor(chainId)!._id,
        token,
        payDate: timing === "scheduled" ? date : undefined,
        recipients: selected.map((b) => ({
          beneficiaryId: b._id,
          amount: amounts[b._id],
        })),
      };
      const result = await updateDraft({ ...fields, disbursementId: draft.id });
      navigate(`/org/${orgId}/disbursements?focus=${result.disbursementId}`);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save this batch. Try again.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (createdBatches)
    return (
      <Dialog title="Payment drafts saved" onClose={onClose}>
        <div className="space-y-5 p-6">
          <p role="status">
            Created {createdBatches.length} batch
            {createdBatches.length === 1 ? "" : "es"}. No funds have moved.
          </p>
          <p className="text-sm text-slate-400">
            Review and approve each batch. Different currencies and networks are
            sent separately.
          </p>
          <ul className="space-y-3">
            {createdBatches.map((batch) => (
              <li key={batch.disbursementId}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigate(
                      `/org/${orgId}/disbursements?focus=${batch.disbursementId}`,
                    );
                    onClose();
                  }}
                >
                  Review {batch.token} · {getChainName(batch.chainId)} ·{" "}
                  {batch.recipientCount} recipient
                  {batch.recipientCount === 1 ? "" : "s"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      title={
        draft
          ? "Edit payment draft"
          : purpose === "payroll"
            ? "Run payroll"
            : "New payment"
      }
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="flex gap-6 border-b border-white/10 px-6 py-4">
        <span className="finance-step" data-active={step === 1}>
          1 &nbsp; Recipients
        </span>
        <span className="finance-step" data-active={step === 2}>
          2 &nbsp; Timing
        </span>
        <span className="finance-step" data-active={step === 3}>
          3 &nbsp; Review
        </span>
      </div>
      <div className="p-6">
        {step === 1 &&
          !!beneficiaries?.some(
            (b) => b.isActive && recipientPayoutIssue(b),
          ) && (
            <p className="mb-5 rounded-lg bg-accent-500/10 p-3 text-sm leading-6">
              Only recipients with reviewed payout details can be selected.{" "}
              <button
                type="button"
                className="workspace-action-link"
                onClick={() => {
                  onClose();
                  navigate(`/org/${orgId}/beneficiaries`);
                }}
              >
                Complete recipient details or review
              </button>
            </p>
          )}
        {error && !instructionErrors.includes(error) && (
          <p
            role="alert"
            className="mb-5 rounded-lg bg-red-500/10 p-3 text-sm text-red-400"
          >
            {error}
          </p>
        )}
        {draft && (
          <p className="mb-5 rounded-lg bg-accent-500/10 p-3 text-xs leading-5 text-slate-400">
            Changes affect this draft only. Existing recipients keep their saved
            payout addresses. Recurring instructions are managed separately.
          </p>
        )}
        {step === 1 ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">Who are you paying?</h3>
              <span className="text-xs text-slate-400">
                {selected.length} selected
              </span>
            </div>
            <div className="mb-3 flex flex-wrap gap-3">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <input
                  className="finance-field pl-9"
                  aria-label="Search recipients"
                  placeholder="Search saved recipients"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                aria-label="Filter by group"
                className="finance-field !w-auto"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">All groups</option>
                {groups.map((group) => (
                  <option key={group}>{group}</option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setAmounts((prev) => ({
                    ...prev,
                    ...Object.fromEntries(
                      filtered.map((b) => [b._id, prev[b._id] ?? ""]),
                    ),
                  }))
                }
              >
                Select shown
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
              {beneficiaries === undefined ? (
                <p role="status" className="p-6 text-sm text-slate-400">
                  Loading recipients...
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-6 text-sm text-slate-400">
                  No recipients found. Add or import recipients from your
                  recipient list.
                </p>
              ) : (
                filtered.map((b) => (
                  <div
                    key={b._id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-3 last:border-0 sm:flex"
                  >
                    <input
                      type="checkbox"
                      className="col-start-1 row-start-1"
                      aria-label={`Select ${b.name}`}
                      checked={Object.prototype.hasOwnProperty.call(
                        amounts,
                        b._id,
                      )}
                      onChange={(e) =>
                        setAmounts((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) next[b._id] = "";
                          else delete next[b._id];
                          return next;
                        })
                      }
                    />
                    <div className="col-start-2 row-start-1 min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {b.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {b.type === "business" ? "Business" : "Individual"} ·{" "}
                        {b.walletAddress.slice(0, 6)}…
                        {b.walletAddress.slice(-4)}
                      </p>
                    </div>
                    {Object.prototype.hasOwnProperty.call(amounts, b._id) && (
                      <input
                        className="finance-field col-span-2 col-start-2 row-start-2 text-right tabular-nums sm:!w-32"
                        aria-label={`Amount for ${b.name}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amounts[b._id]}
                        onChange={(e) =>
                          setAmounts((prev) => ({
                            ...prev,
                            [b._id]: e.target.value,
                          }))
                        }
                      />
                    )}
                    <span className="col-start-3 row-start-1 text-right text-xs text-slate-500">
                      {b.preferredToken ?? token}
                      <span className="block">
                        {b.preferredChainId
                          ? getChainName(b.preferredChainId)
                          : "No network preference"}
                      </span>
                      {!b.preferredToken && (
                        <span className="block">No currency preference</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
            {unavailableSelections.map(id => (
              <div key={id} role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 p-3 text-sm">
                <p>{draft?.recipients.find(r => r.beneficiaryId === id)?.recipientName ?? "Selected recipient"} is archived or unavailable. Remove them from this draft to continue.</p>
                <Button size="sm" variant="secondary" onClick={() => setAmounts(current => { const next = { ...current }; delete next[id]; return next; })}>Remove unavailable recipient</Button>
              </div>
            ))}
            {instructionErrors.length > 0 && (
              <div
                role="alert"
                className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400"
              >
                {instructionErrors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            )}
            {selected.length > 1 && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  className="finance-field !w-36"
                  aria-label="Amount for all recipients"
                  placeholder="Same amount"
                  inputMode="decimal"
                  value={sameAmount}
                  onChange={(e) => setSameAmount(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setAmounts((prev) =>
                      Object.fromEntries(
                        Object.keys(prev).map((id) => [id, sameAmount]),
                      ),
                    )
                  }
                >
                  Apply to selected
                </Button>
              </div>
            )}
            <details className="mt-5 rounded-lg border border-white/10 p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Payment defaults
              </summary>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Saved recipient instructions are used automatically. These
                defaults apply when a recipient has not chosen a currency or
                network.
              </p>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <label>
                  <span className="finance-label">Default payment network</span>
                  <select
                    className="finance-field"
                    value={chainId ?? ""}
                    onChange={(e) => setChain(Number(e.target.value))}
                  >
                    {chainId &&
                      !safes?.some((safe) => safe.chainId === chainId) && (
                        <option value={chainId}>
                          {getChainName(chainId)} · No linked funding account
                        </option>
                      )}
                    <option value="" disabled>
                      Select a payment network
                    </option>
                    {[...new Set(safes?.map(s => s.chainId) ?? [])].map(network => (
                      <option key={network} value={network}>
                        {getChainName(network)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="finance-label">Payment currency</span>
                  <select
                    aria-label="Payment currency"
                    className="finance-field"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  >
                    {!tokens.includes(token) && (
                      <option value={token}>
                        {token} · Unavailable on this account
                      </option>
                    )}
                    {tokens.map((token) => (
                      <option key={token}>{token}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    {useSavedInstructions
                      ? "Default for recipients without a saved currency. Each requested currency and network gets its own batch."
                      : "Each batch pays one currency on one network. Saved recipient instructions must match."}{" "}
                    No automatic conversion.
                  </span>
                </label>
              </div>
            </details>
            {paymentGroups.length > 0 && (
              <section className="mt-5 space-y-4" aria-label="Payment funding">
                <h4 className="text-sm font-semibold">Pay from</h4>
                {[...new Set(paymentGroups.map(g => g.chainId))].map(network => (
                  <label className="block" key={network}>
                    <span className="finance-label">Funding account on {getChainName(network!)}</span>
                    <select className="finance-field" aria-label={`Funding account on ${getChainName(network!)}`} value={accountFor(network)?._id ?? ""}
                      onChange={e => setAccountChoices(current => ({ ...current, [network!]: e.target.value }))}>
                      <option value="" disabled>Choose an account</option>
                      {safes?.filter(s => s.chainId === network).map(s => (
                        <option key={s._id} value={s._id}>
                          {s.name ?? getChainName(s.chainId) + " account"} · {s.safeAddress.slice(-6)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <p className="text-xs text-slate-400">This account funds the payment and its fees. Recurring payments keep the same account.</p>
              </section>
            )}
            <div className="mt-5 space-y-3">
              {fundingAccounts.map((account) => (
                <AccountFundingCheck
                  key={account._id}
                  safeId={account._id}
                  chainId={account.chainId}
                  payments={account.payments}
                />
              ))}
            </div>
          </>
        ) : step === 2 ? (
          <>
            <h3 className="mb-5 text-lg font-semibold">
              When should they be paid?
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <label>
                <span className="finance-label">Payment name</span>
                <input
                  data-autofocus
                  className="finance-field"
                  placeholder="e.g. September payroll"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                <span className="finance-label">Payment purpose</span>
                <select
                  className="finance-field"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as typeof purpose)}
                >
                  <option value="payroll">Payroll & contractors</option>
                  <option value="invoice">Vendor payments</option>
                  <option value="other">Other payments</option>
                </select>
              </label>
              <label>
                <span className="finance-label">Repeat</span>
                <select
                  className="finance-field"
                  disabled={!!draft}
                  value={cadence}
                  onChange={(e) => {
                    setCadence(e.target.value as typeof cadence);
                    if (e.target.value !== "once") setTiming("scheduled");
                  }}
                >
                  <option value="once">One time</option>
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
              <label>
                <span className="finance-label">When to pay</span>
                <select
                  className="finance-field"
                  value={timing}
                  disabled={cadence !== "once"}
                  onChange={(e) => setTiming(e.target.value as typeof timing)}
                >
                  <option value="now">As soon as approved</option>
                  <option value="scheduled">Choose a pay date</option>
                </select>
              </label>
              {timing === "scheduled" && (
                <label>
                  <span className="finance-label">Pay date</span>
                  <input
                    className="finance-field"
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    12:00 UTC. Review and approve before this date.
                  </span>
                </label>
              )}
            </div>
            {cadence !== "once" && (
              <div className="mt-5 rounded-lg bg-accent-500/10 p-4 text-sm text-slate-300">
                <CalendarDays className="mr-2 inline h-4 w-4 text-accent-400" />
                Next pay dates: {nextDates.join(" · ")}
                <p className="mt-2 text-xs text-slate-400">
                  Future batches are prepared 3 days before payday. Your team
                  reviews and approves each one. You can pause the schedule at
                  any time.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-2xl font-semibold text-white">{name}</h3>
            <p className="mt-2 text-sm text-slate-400">
              {paymentGroups.length > 1
                ? `${paymentGroups.length} separately approved batches`
                : getChainName(paymentGroups[0]?.chainId ?? chainId!)}{" "}
              ·{" "}
              {timing === "now"
                ? "As soon as approved"
                : `${new Date(date).toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "long" })} at 12:00 UTC`}
            </p>
            <div className="my-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="finance-panel order-2 p-4 sm:order-1">
                <Users className="mb-2 h-4 w-4 text-slate-400" />
                <p className="text-lg font-semibold">
                  {selected.length} recipient{selected.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="finance-panel order-1 col-span-2 p-4 sm:order-2 sm:col-span-1">
                <p className="finance-label">Total payment</p>
                <p className="text-lg font-semibold tabular-nums">
                  {paymentGroups.map((g) => (
                    <span key={`${g.chainId}:${g.token}`} className="block">
                      {groupTotal(g) === null
                        ? "Check amounts"
                        : formatMoney(groupTotal(g)!, g.token, true)}{" "}
                      {g.token}
                      <span className="block text-xs font-normal text-slate-400">
                        {getChainName(g.chainId!)}
                      </span>
                    </span>
                  ))}
                </p>
              </div>
              <div className="finance-panel order-3 p-4">
                <p className="finance-label">Frequency</p>
                <p className="text-lg font-semibold">
                  {
                    {
                      once: "One time",
                      weekly: "Weekly",
                      biweekly: "Every 2 weeks",
                      monthly: "Monthly",
                    }[cadence]
                  }
                </p>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <ul
                aria-label="Recipient payout review"
                className="divide-y divide-white/10 sm:hidden"
              >
                {selected.map((b) => (
                  <li key={b._id} className="space-y-2 py-4">
                    <p className="font-medium">{b.name}</p>
                    <p className="break-all text-lg font-semibold tabular-nums">
                      {formatMoney(amounts[b._id], payoutFor(b).token, true)}{" "}
                      {payoutFor(b).token}
                    </p>
                    <p className="break-all font-mono text-xs text-slate-400">
                      {b.walletAddress}
                    </p>
                    <p className="text-xs text-slate-400">
                      {getChainName(payoutFor(b).chainId!)}
                    </p>
                  </li>
                ))}
              </ul>
              <table className="finance-table hidden sm:table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Payout address</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((b) => (
                    <tr key={b._id}>
                      <td>
                        {b.name}
                        <span className="block text-xs text-slate-400">
                          {getChainName(payoutFor(b).chainId!)}
                        </span>
                      </td>
                      <td
                        title={b.walletAddress}
                        className="max-w-56 break-all font-mono text-xs"
                      >
                        {b.walletAddress}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(amounts[b._id], payoutFor(b).token, true)}{" "}
                        {payoutFor(b).token}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 space-y-3">
              {fundingAccounts.map((account) => (
                <AccountFundingCheck
                  key={account._id}
                  safeId={account._id}
                  chainId={account.chainId}
                  payments={account.payments}
                />
              ))}
            </div>
            <div className="mt-6 flex gap-3 rounded-lg bg-accent-500/10 p-4">
              <ShieldCheck className="h-5 w-5 shrink-0 text-accent-400" />
              <div>
                <p className="text-sm font-medium">
                  Save a draft for your team
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Saving does not move funds. Each currency and network is
                  prepared as a separate batch for approval in Payments. Batches
                  can complete independently. Network fees are confirmed during
                  signing.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-white/10 bg-navy-950 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-slate-500">
            {selected.length} recipient{selected.length === 1 ? "" : "s"} ·
            Total before fees
          </p>
          <p className="font-semibold tabular-nums">
            {instructionErrors.length
              ? "Resolve payout instructions"
              : useSavedInstructions && paymentGroups.length
                ? paymentGroups
                    .map(
                      (g) =>
                        `${groupTotal(g) === null ? "Check amounts" : formatMoney(groupTotal(g)!, g.token, true)} ${g.token} · ${getChainName(g.chainId!)}`,
                    )
                    .join(" / ")
                : `${total === null ? "Check amounts" : formatMoney(total, token, true)} ${token}`}
          </p>
        </div>
        <div className="flex gap-2">
          {step > 1 && (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft />
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button
              disabled={instructionErrors.length > 0}
              onClick={() => {
                const message = validate(step === 2);
                setError(message);
                if (!message) {
                  if (!name.trim())
                    setName(
                      selected.length === 1
                        ? `${selected[0].name} payment`
                        : `${purpose === "payroll" ? "Payroll" : "Payments"} · ${new Date().toLocaleDateString()}`,
                    );
                  setStep(step + 1);
                }
              }}
            >
              {step === 1 ? "Continue to timing" : "Review payment"}
              <ArrowRight />
            </Button>
          ) : (
            <Button disabled={saving} onClick={submit}>
              <Check />
              {saving
                ? "Saving…"
                : draft
                  ? "Save changes"
                  : paymentGroups.length > 1
                    ? `Save ${paymentGroups.length} payment drafts`
                    : "Save payment draft"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
