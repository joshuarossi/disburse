// Shared copy and data for the landing page proposals (/1 .. /5).
// Each proposal styles this differently; the facts stay the same.
import { PLAN_LIMITS } from '../../../shared/billing'

export const BRAND = 'Disburse'

export const PROPOSALS = [
  { id: 1, name: 'Ledger', note: 'Editorial, paper and ink' },
  { id: 2, name: 'Console', note: 'Dark, precise, operator-grade' },
  { id: 3, name: 'Cobalt', note: 'Bold colour blocks' },
  { id: 4, name: 'Canvas', note: 'Soft, product-led' },
  { id: 5, name: 'Grid', note: 'Swiss, strict and quiet' },
  { id: 6, name: 'Folio', note: 'Canvas layout, Ledger identity' },
]

export const NAV = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#how' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Docs', href: '/docs' },
]

export const HERO = {
  eyebrow: 'Business payments, under your control',
  title: 'Pay your people. Stay in control.',
  subtitle:
    'Import your recipients, prepare payroll and vendor payments, and keep approvals and records in one place. Stablecoins handle settlement. Your team keeps control of the funds.',
  primaryCta: 'Try for free',
  secondaryCta: 'See how it works',
  trust: 'Settlement powered by Safe and stablecoins',
  trustLogos: ['Safe', 'USDC', 'Ethereum', 'Base', 'Polygon'],
}

export const PILLARS = [
  {
    title: 'Your funds stay yours',
    body: 'Your organization controls its account and signing keys. Disburse never takes custody.',
  },
  {
    title: 'Shared approvals',
    body: 'Owners review and sign payments in Disburse. Set the number of signatures your account requires.',
  },
  {
    title: 'Recipient screening',
    body: 'Review potential sanctions matches before approval. Choose whether matches warn or block.',
  },
  {
    title: 'Payment history',
    body: 'Track preparation, approvals and verified settlement, with records your team can export.',
  },
]

export const FEATURES = [
  { title: 'Pay on your schedule', body: 'Set a pay date and collect approvals in advance. Recurring instructions prepare a fresh draft each cycle.' },
  { title: 'One person or a whole team', body: 'Select saved recipients once. Compatible payouts travel together in a single batch.' },
  { title: 'Bring your recipient list', body: 'Import a CSV or spreadsheet export, map columns, and review duplicates before saving.' },
  { title: 'Reusable recipient groups', body: 'Group employees, contractors and vendors so the next payment starts with the right people.' },
  { title: 'Team roles and limits', body: 'Separate preparation from approval. Grant members an allowance for delegated payments.' },
  { title: 'Reconcile and export', body: 'Review incoming funds, outgoing payments and fees by currency. Export exact amounts and references.' },
  { title: 'Saved payout instructions', body: 'Each recipient keeps their currency, network and address. No repeated copy and paste.' },
  { title: 'Fees in the same workflow', body: 'Review a separate stablecoin fee before signing. Managed execution on supported networks.' },
]

export const STEPS = [
  { n: '01', title: 'Connect your funding account', body: 'Link an existing Safe account. Its owners and approval threshold remain in control.' },
  { n: '02', title: 'Import your recipients', body: 'Bring your employee or vendor export, map the columns and complete missing payout instructions.' },
  { n: '03', title: 'Review, approve and pay', body: 'Prepare one payment or a batch, review recipients and fees, then collect the required signatures.' },
]

export const STATS = [
  { value: '0', label: 'custody of your funds' },
  { value: '1', label: 'workflow for payroll and vendors' },
  { value: '30d', label: 'free trial, no auto-renew' },
  { value: '3', label: 'networks supported' },
]

export const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    period: 'forever',
    blurb: 'For a single operator',
    highlight: false,
    features: [`${PLAN_LIMITS.starter.maxUsers} team member`, `${PLAN_LIMITS.starter.maxBeneficiaries} saved recipients`, 'Individual and batch payments', 'Approvals and payment limits', 'Audit records and exports'],
  },
  {
    key: 'team',
    name: 'Team',
    price: PLAN_LIMITS.team.price,
    period: '30 days',
    blurb: 'For small teams',
    highlight: true,
    features: [`${PLAN_LIMITS.team.maxUsers} team members`, `${PLAN_LIMITS.team.maxBeneficiaries} saved recipients`, 'Separate business accounts', 'Scheduled and recurring payments', 'Approvals and payment limits', 'Audit records and exports'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: PLAN_LIMITS.pro.price,
    period: '30 days',
    blurb: 'For growing teams',
    highlight: false,
    features: ['No plan limit on members', 'No plan limit on recipients', 'Separate business accounts', 'Scheduled and recurring payments', 'Approvals and payment limits', 'Audit records and exports'],
  },
]

export const PRICING_NOTE =
  'Core payments remain available without a subscription. You pay all network and provider fees. No automatic subscription charges.'

export const CTA = {
  eyebrow: '30-day free trial',
  title: 'Make your next pay run easier',
  body: 'Start with your existing recipient list. Review the workflow with your team before moving funds.',
  button: 'Try for free',
  note: '30-day trial · No automatic renewal',
}

export const FOOTER = {
  tagline: 'Business payments and treasury, with stablecoin settlement.',
  columns: [
    { title: 'Product', links: [{ label: 'Features', href: '#product' }, { label: 'Pricing', href: '#pricing' }, { label: 'Documentation', href: '/docs' }] },
    { title: 'Company', links: [{ label: 'About', href: '/about' }, { label: 'Blog', href: '/blog' }, { label: 'Contact', href: '/contact' }] },
    { title: 'Legal', links: [{ label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' }] },
  ],
}

// Sample rows for product mock-ups. Purely illustrative.
export const SAMPLE_BATCH = {
  name: 'September contractor payroll',
  total: '48,250.00',
  currency: 'USDC',
  network: 'Base',
  approvals: { have: 1, need: 2 },
  rows: [
    { name: 'Ana Lima', role: 'Design', amount: '6,500.00', status: 'Ready' },
    { name: 'Tomás Reyes', role: 'Engineering', amount: '9,200.00', status: 'Ready' },
    { name: 'Priya Nair', role: 'Engineering', amount: '9,200.00', status: 'Ready' },
    { name: 'Northwind Studio', role: 'Vendor', amount: '12,350.00', status: 'Screened' },
    { name: 'Kenji Sato', role: 'Ops', amount: '5,800.00', status: 'Ready' },
    { name: 'Marta Kowalski', role: 'Finance', amount: '5,200.00', status: 'Ready' },
  ],
}
