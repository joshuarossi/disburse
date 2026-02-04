import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/rbac";

// Get transaction report with filtering
export const getTransactionReport = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    status: v.optional(v.array(v.string())),
    beneficiaryId: v.optional(v.id("beneficiaries")),
    token: v.optional(v.array(v.string())),
    chainId: v.optional(v.number()),
    chainIds: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view reports
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    const statusFilter = args.status && args.status.length > 0 ? args.status : null;
    const includeDeposits = !statusFilter || statusFilter.includes("received");
    const includeDisbursements = !statusFilter || statusFilter.includes("executed");

    const endOfDay = args.endDate ? args.endDate + 24 * 60 * 60 * 1000 : null;

    // Fetch all disbursements for the org
    const allDisbursements = await ctx.db
      .query("disbursements")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const disbursementRows: Array<{
      _id: Id<"disbursements">;
      createdAt: number;
      amount: string;
      token: string;
      chainId: number | undefined;
      status: string;
      memo: string | undefined;
      txHash: string | undefined;
      beneficiaryName: string;
      beneficiaryWallet: string;
      direction: "outflow";
    }> = [];

    for (const d of allDisbursements) {
      const eventTimestamp = d.executedAt ?? d.updatedAt ?? d.createdAt;

      if (args.startDate && eventTimestamp < args.startDate) continue;
      if (endOfDay && eventTimestamp > endOfDay) continue;

      if (!includeDisbursements) continue;
      if (d.status !== "executed") continue;

      if (args.chainId !== undefined && d.chainId !== args.chainId) continue;
      if (args.chainIds && args.chainIds.length > 0) {
        if (d.chainId === undefined || !args.chainIds.includes(d.chainId)) continue;
      }

      if (args.token && args.token.length > 0 && !args.token.includes(d.token)) continue;

      if (d.type === "batch") {
        const recipients = await ctx.db
          .query("disbursementRecipients")
          .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
          .collect();

        if (recipients.length === 0) {
          if (args.beneficiaryId) continue;
          disbursementRows.push({
            _id: d._id,
            createdAt: eventTimestamp,
            amount: d.totalAmount || d.amount || "0",
            token: d.token,
            chainId: d.chainId,
            status: d.status,
            memo: d.memo,
            txHash: d.txHash,
            beneficiaryName: "Batch",
            beneficiaryWallet: "",
            direction: "outflow",
          });
          continue;
        }

        for (const recipient of recipients) {
          if (args.beneficiaryId && recipient.beneficiaryId !== args.beneficiaryId) {
            continue;
          }
          const beneficiary = await ctx.db.get(recipient.beneficiaryId);
          disbursementRows.push({
            _id: d._id,
            createdAt: eventTimestamp,
            amount: recipient.amount || "0",
            token: d.token,
            chainId: d.chainId,
            status: d.status,
            memo: d.memo,
            txHash: d.txHash,
            beneficiaryName: beneficiary?.name || "Unknown",
            beneficiaryWallet: beneficiary?.walletAddress || "",
            direction: "outflow",
          });
        }
      } else {
        if (args.beneficiaryId && d.beneficiaryId !== args.beneficiaryId) continue;
        const beneficiary = d.beneficiaryId ? await ctx.db.get(d.beneficiaryId) : null;
        disbursementRows.push({
          _id: d._id,
          createdAt: eventTimestamp,
          amount: d.amount || "0",
          token: d.token,
          chainId: d.chainId,
          status: d.status,
          memo: d.memo,
          txHash: d.txHash,
          beneficiaryName: beneficiary?.name || "Unknown",
          beneficiaryWallet: beneficiary?.walletAddress || "",
          direction: "outflow",
        });
      }
    }

    const depositRows: Array<{
      _id: Id<"deposits">;
      createdAt: number;
      amount: string;
      token: string;
      chainId: number | undefined;
      status: "received";
      memo: string | undefined;
      txHash: string | undefined;
      beneficiaryName: string;
      beneficiaryWallet: string;
      direction: "inflow";
    }> = [];

    if (includeDeposits) {
      const deposits = await ctx.db
        .query("deposits")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();

      for (const deposit of deposits) {
        const eventTimestamp = deposit.timestamp;
        if (args.startDate && eventTimestamp < args.startDate) continue;
        if (endOfDay && eventTimestamp > endOfDay) continue;

        if (args.chainId !== undefined && deposit.chainId !== args.chainId) continue;
        if (args.chainIds && args.chainIds.length > 0 && !args.chainIds.includes(deposit.chainId)) continue;
        if (args.token && args.token.length > 0 && !args.token.includes(deposit.tokenSymbol)) continue;

        if (args.beneficiaryId) continue;

        depositRows.push({
          _id: deposit._id,
          createdAt: eventTimestamp,
          amount: deposit.amount || "0",
          token: deposit.tokenSymbol,
          chainId: deposit.chainId,
          status: "received",
          memo: undefined,
          txHash: deposit.txHash,
          beneficiaryName: "External",
          beneficiaryWallet: deposit.fromAddress || "",
          direction: "inflow",
        });
      }
    }

    const filtered = [...disbursementRows, ...depositRows];

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    const totalsMap = new Map<string, number>();
    filtered.forEach((d) => {
      const current = totalsMap.get(d.token) || 0;
      const amount = parseFloat(d.amount || "0");
      totalsMap.set(d.token, current + (isNaN(amount) ? 0 : amount));
    });

    const totals = Array.from(totalsMap.entries()).map(([token, amount]) => ({
      token,
      amount: amount.toFixed(2),
    }));

    return {
      items: filtered.map((d) => ({
        _id: d._id,
        createdAt: d.createdAt,
        amount: d.amount,
        token: d.token,
        chainId: d.chainId,
        status: d.status,
        memo: d.memo,
        txHash: d.txHash,
        beneficiaryName: d.beneficiaryName,
        beneficiaryWallet: d.beneficiaryWallet,
        direction: d.direction,
      })),
      totals,
    };
  },
});

// Get spending by beneficiary report
export const getSpendingByBeneficiary = query({
  args: {
    orgId: v.id("orgs"),
    walletAddress: v.string(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    type: v.optional(v.union(v.literal("individual"), v.literal("business"))),
    chainId: v.optional(v.number()),
    chainIds: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view reports
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    // Fetch all executed disbursements for the org
    const allDisbursements = await ctx.db
      .query("disbursements")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    // Filter to only executed disbursements
    let executed = allDisbursements.filter((d) => d.status === "executed");

    // Apply date range filter
    if (args.startDate) {
      executed = executed.filter((d) => d.createdAt >= args.startDate!);
    }
    if (args.endDate) {
      const endOfDay = args.endDate + 24 * 60 * 60 * 1000;
      executed = executed.filter((d) => d.createdAt <= endOfDay);
    }
    if (args.chainId !== undefined) {
      executed = executed.filter((d) => d.chainId === args.chainId);
    }
    if (args.chainIds && args.chainIds.length > 0) {
      executed = executed.filter((d) => d.chainId !== undefined && args.chainIds!.includes(d.chainId));
    }

    // Enrich with beneficiary data
    // Process both single and batch disbursements
    const enriched: Array<{
      _id: Id<"disbursements">;
      beneficiaryId: Id<"beneficiaries"> | null;
      beneficiary: { _id: Id<"beneficiaries">; name: string; walletAddress: string; type?: "individual" | "business" } | null;
      token: string;
      amount: string | undefined;
      createdAt: number;
      status: string;
    }> = [];

    // Process single disbursements (including those without explicit type for backward compatibility)
    for (const d of executed) {
      if ((d.type === "single" || !d.type) && d.beneficiaryId) {
        const beneficiary = await ctx.db.get(d.beneficiaryId);
        if (beneficiary) {
          enriched.push({
            _id: d._id,
            beneficiaryId: d.beneficiaryId,
            beneficiary: {
              _id: beneficiary._id,
              name: beneficiary.name,
              walletAddress: beneficiary.walletAddress,
              type: beneficiary.type,
            },
            token: d.token,
            amount: d.amount,
            createdAt: d.createdAt,
            status: d.status,
          });
        }
      } else if (d.type === "batch") {
        // Process batch disbursements - expand into individual recipient entries
        const recipients = await ctx.db
          .query("disbursementRecipients")
          .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
          .collect();
        
        for (const recipient of recipients) {
          const beneficiary = await ctx.db.get(recipient.beneficiaryId);
          if (beneficiary) {
            enriched.push({
              _id: d._id,
              beneficiaryId: recipient.beneficiaryId,
              beneficiary: {
                _id: beneficiary._id,
                name: beneficiary.name,
                walletAddress: beneficiary.walletAddress,
                type: beneficiary.type,
              },
              token: d.token,
              amount: recipient.amount,
              createdAt: d.createdAt,
              status: d.status,
            });
          }
        }
      }
    }

    // Filter by beneficiary type if specified
    let filtered = enriched;
    if (args.type) {
      filtered = enriched.filter((d) => {
        if (!d.beneficiary) return false;
        // Handle optional type field (defaults to "individual" if not set)
        const beneficiaryType = d.beneficiary.type || "individual";
        return beneficiaryType === args.type;
      });
    }

    // Group by beneficiaryId and token (separate rows for different tokens)
    const grouped = new Map<string, {
      beneficiaryId: Id<"beneficiaries">;
      token: string;
      transactions: typeof filtered;
    }>();

    filtered.forEach((d) => {
      if (!d.beneficiary || !d.beneficiaryId) return; // Skip if no beneficiary

      const key = `${d.beneficiaryId}_${d.token}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.transactions.push(d);
      } else {
        grouped.set(key, {
          beneficiaryId: d.beneficiaryId,
          token: d.token,
          transactions: [d],
        });
      }
    });

    // Calculate totals and format results
    const results = await Promise.all(
      Array.from(grouped.values()).map(async (group) => {
        const beneficiary = await ctx.db.get(group.beneficiaryId);
        if (!beneficiary) {
          return null;
        }

        const totalPaid = group.transactions.reduce(
          (sum, d) => {
            const amount = parseFloat(d.amount || "0");
            return sum + (isNaN(amount) ? 0 : amount);
          },
          0
        );

        return {
          beneficiaryId: group.beneficiaryId,
          beneficiaryName: beneficiary.name,
          beneficiaryType: beneficiary.type || "individual",
          beneficiaryWallet: beneficiary.walletAddress,
          transactionCount: group.transactions.length,
          totalPaid: totalPaid.toFixed(2),
          token: group.token,
        };
      })
    );

    // Filter out nulls and sort by totalPaid descending
    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => parseFloat(b.totalPaid) - parseFloat(a.totalPaid));
  },
});
