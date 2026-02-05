import { Building2, User, Users } from 'lucide-react'

export const PLANS = {
  starter: {
    name: 'Starter',
    price: 25,
    description: 'For individuals',
    icon: User,
    popular: false,
    features: [
      '1 user',
      '1 Safe per chain',
      '25 beneficiaries',
      'One-time disbursements',
      'Audit logs',
      'CSV export',
    ],
    limits: {
      users: 1,
      beneficiaries: 25,
    },
  },
  team: {
    name: 'Team',
    price: 50,
    description: 'For small teams',
    icon: Users,
    popular: true,
    features: [
      '5 users',
      '1 Safe per chain',
      '100 beneficiaries',
      'All 5 roles',
      'Multi-sig approval',
      'Everything in Starter',
    ],
    limits: {
      users: 5,
      beneficiaries: 100,
    },
  },
  pro: {
    name: 'Pro',
    price: 99,
    description: 'For growing teams',
    icon: Building2,
    popular: false,
    features: [
      'Unlimited users',
      '1 Safe per chain',
      'Unlimited beneficiaries',
      'Professional reports',
      'Priority support',
      'Everything in Team',
    ],
    limits: {
      users: Infinity,
      beneficiaries: Infinity,
    },
  },
} as const

export type PlanKey = keyof typeof PLANS

const PLAN_FEATURE_KEYS = [
  'users',
  'safe',
  'beneficiaries',
  'disbursements',
  'audit',
  'export',
  'roles',
  'multisig',
  'everything',
  'reports',
  'support',
] as const

export const getPlanFeatureKey = (index: number) => PLAN_FEATURE_KEYS[index] ?? `feature${index}`
