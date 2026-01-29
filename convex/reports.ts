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
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Any member can view reports
    await requireOrgAccess(ctx, args.orgId, walletAddress, ["admin", "approver", "initiator", "clerk", "viewer"]);

    // Fetch all disbursements for the org
    const allDisbursements = await ctx.db
      .query("disbursements")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    // Enrich with beneficiary data
    const enriched = await Promise.all(
      allDisbursements.map(async (d) => {
        // Handle batch disbursements - get first beneficiary name and count
        if (d.type === "batch") {
          const recipients = await ctx.db
            .query("disbursementRecipients")
            .withIndex("by_disbursement", (q) => q.eq("disbursementId", d._id))
            .collect();
          
          let batchDisplayName = "Batch";
          if (recipients.length > 0) {
            const firstRecipient = recipients[0];
            const firstBeneficiary = await ctx.db.get(firstRecipient.beneficiaryId);
            if (firstBeneficiary) {
              const otherCount = recipients.length - 1;
              if (otherCount > 0) {
                batchDisplayName = `${firstBeneficiary.name} +${otherCount}`;
              } else {
                batchDisplayName = firstBeneficiary.name;
              }
            }
          }
          
          return {
            ...d,
            beneficiaryName: batchDisplayName,
            beneficiaryWallet: "",
            displayAmount: d.totalAmount || d.amount || "0",
          };
        }
        
        const beneficiary = d.beneficiaryId ? await ctx.db.get(d.beneficiaryId) : null;
        return {
          ...d,
          beneficiaryName: beneficiary?.name || "Unknown",
          beneficiaryWallet: beneficiary?.walletAddress || "",
          displayAmount: d.amount || "0",
        };
      })
    );

    // Apply filters
    let filtered = enriched;

    // Date range filter
    if (args.startDate) {
      filtered = filtered.filter((d) => d.createdAt >= args.startDate!);
    }
    if (args.endDate) {
      // Add one day to include the end date fully
      const endOfDay = args.endDate + 24 * 60 * 60 * 1000;
      filtered = filtered.filter((d) => d.createdAt <= endOfDay);
    }

    // Status filter
    if (args.status && args.status.length > 0) {
      filtered = filtered.filter((d) => args.status!.includes(d.status));
    }

    // Beneficiary filter (only applies to single disbursements)
    if (args.beneficiaryId) {
      filtered = filtered.filter((d) => d.beneficiaryId === args.beneficiaryId);
    }

    // Token filter
    if (args.token && args.token.length > 0) {
      filtered = filtered.filter((d) => args.token!.includes(d.token));
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    // Calculate totals by token
    const totalsMap = new Map<string, number>();
    filtered.forEach((d) => {
      const current = totalsMap.get(d.token) || 0;
      const amount = parseFloat(d.displayAmount || d.amount || "0");
      totalsMap.set(d.token, current + (isNaN(amount) ? 0 : amount));
    });

    const totals = Array.from(totalsMap.entries()).map(([token, amount]) => ({
      token,
      amount: amount.toFixed(2),
    }));

    // Return items with beneficiary data
    return {
      items: filtered.map((d) => ({
        _id: d._id,
        createdAt: d.createdAt,
        amount: d.displayAmount || d.amount || "0",
        token: d.token,
        status: d.status,
        memo: d.memo,
        txHash: d.txHash,
        beneficiaryName: d.beneficiaryName,
        beneficiaryWallet: d.beneficiaryWallet,
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
