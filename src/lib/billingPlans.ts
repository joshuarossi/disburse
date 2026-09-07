import { PLAN_LIMITS } from '../../shared/billing';
import { Building2, User, Users } from 'lucide-react';

export const PLANS = {
  starter: { name: 'Starter', price: PLAN_LIMITS.starter.price, description: 'For a single operator', icon: User, popular: false },
  team: { name: 'Team', price: PLAN_LIMITS.team.price, description: 'For small teams', icon: Users, popular: true },
  pro: { name: 'Pro', price: PLAN_LIMITS.pro.price, description: 'For growing teams', icon: Building2, popular: false },
} as const;
export type PlanKey = keyof typeof PLANS;

/** Feature identities stay consistent across plans, translations and list order. */
export function getPlanFeatures(plan: PlanKey) {
  const { maxUsers, maxBeneficiaries } = PLAN_LIMITS[plan];
  return [
    { key: Number.isFinite(maxUsers) ? 'members' : 'membersUnlimited', count: Number.isFinite(maxUsers) ? maxUsers : undefined, text: Number.isFinite(maxUsers) ? `${maxUsers} team member${maxUsers === 1 ? '' : 's'}` : 'No plan limit on members' },
    { key: Number.isFinite(maxBeneficiaries) ? 'recipients' : 'recipientsUnlimited', count: Number.isFinite(maxBeneficiaries) ? maxBeneficiaries : undefined, text: Number.isFinite(maxBeneficiaries) ? `${maxBeneficiaries} saved recipients` : 'No plan limit on recipients' },
    { key: 'accounts', text: 'Separate business accounts' },
    { key: 'payments', text: 'Individual and batch payments' },
    { key: 'schedules', text: 'Scheduled and recurring payments' },
    { key: 'controls', text: 'Approvals and payment limits' },
    { key: 'records', text: 'Audit records and accounting exports' },
  ];
}
