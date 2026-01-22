import { internalMutation } from "../_generated/server";

/**
 * One-time migration to backfill the `type` field for existing beneficiaries.
 * Run this via the Convex dashboard or CLI:
 *   npx convex run migrations/backfillBeneficiaryType:run
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const beneficiaries = await ctx.db.query("beneficiaries").collect();
    
    let updated = 0;
    for (const beneficiary of beneficiaries) {
      if (beneficiary.type === undefined) {
        await ctx.db.patch(beneficiary._id, {
          type: "individual", // Default to individual for existing records
        });
        updated++;
      }
    }
    
    console.log(`Backfilled ${updated} beneficiaries with type="individual"`);
    return { updated, total: beneficiaries.length };
  },
});
