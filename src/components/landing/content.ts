// Copy and sample data for the public landing page. Every visible string goes
// through tx() so the workspace catalog carries the translations.
import { tx, useWorkspaceLanguage, workspaceLocale } from '@/lib/workspaceI18n'

export const BRAND = 'Disburse'

export const money = (n: number) =>
  n.toLocaleString(workspaceLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** One source of truth for the two product mock-ups, so every number agrees. */
export function useSampleBatch() {
  useWorkspaceLanguage()
  const payDate = new Date(2026, 8, 25)
  return {
    name: tx('September contractor payroll'),
    org: 'Northwind Studio',
    currency: 'USDC',
    network: 'Base',
    payDate,
    payDateLabel: payDate.toLocaleDateString(workspaceLocale(), { weekday: 'short', day: 'numeric', month: 'short' }),
    payDay: 25,
    subtotal: 48250,
    fee: 4.8,
    approvers: [
      { name: 'Dana Whitfield', initials: 'DW', signed: true },
      { name: 'Rafael Costa', initials: 'RC', signed: false },
    ],
    rows: [
      { name: 'Ana Lima', role: tx('Design'), amount: 6500, screened: false },
      { name: 'Tomás Reyes', role: tx('Engineering'), amount: 9200, screened: false },
      { name: 'Priya Nair', role: tx('Engineering'), amount: 9200, screened: false },
      { name: 'Harbor Print Co.', role: tx('Vendor'), amount: 12350, screened: true },
      { name: 'Kenji Sato', role: tx('Operations'), amount: 5800, screened: false },
      { name: 'Marta Kowalski', role: tx('Finance'), amount: 5200, screened: false },
    ],
  }
}

export function useLandingContent() {
  useWorkspaceLanguage()
  return {
    nav: [
      { label: tx('Product'), hash: '#product' },
      { label: tx('How it works'), hash: '#how' },
      { label: tx('Pricing'), hash: '#pricing' },
      { label: tx('Docs'), to: '/docs' },
    ],
    hero: {
      eyebrow: tx('Business payments, under your control'),
      line1: tx('Pay your people.'),
      line2Before: tx('Stay in'),
      line2Em: tx('control'),
      subtitle: tx(
        'Import your recipients, prepare payroll and vendor payments, and keep approvals and records in one place. Stablecoins handle settlement. Your team keeps control of the funds.',
      ),
      primary: tx('Try for free'),
      secondary: tx('See how it works'),
      note: tx('30-day trial · No automatic renewal · Non-custodial by design'),
      trustA: tx('Settles in USDC on Ethereum, Base and Polygon'),
      trustB: tx('Signing through Safe smart accounts'),
    },
    product: {
      label: tx('In the product'),
      title: tx('What the reviewer checks before signing.'),
      lede: tx('The approver sees exactly what the preparer saw: every recipient, the screening result, the fee, and the signatures still needed.'),
      checks: [
        { n: '1', title: tx('Every recipient screened'), body: tx('Potential sanctions matches are flagged before anyone signs. Screening does not replace your compliance process.') },
        { n: '2', title: tx('The fee, before you sign'), body: tx('The stablecoin execution fee is shown as its own line, so the total is the total.') },
        { n: '3', title: tx('Your threshold, not ours'), body: tx('Signatures are collected against your Safe account’s own threshold. Disburse cannot sign for you.') },
        { n: '4', title: tx('Exact amounts, exportable'), body: tx('Every batch keeps the amounts and transaction references your accountant will ask for.') },
      ],
    },
    principles: {
      label: tx('Principles'),
      title: tx('Built so nobody has to trust a middleman.'),
      lede: tx('Disburse organises the work around your own Safe account. It never holds the money.'),
      items: [
        { title: tx('Your funds stay yours'), body: tx('Your organization controls its account and signing keys. Disburse never takes custody.') },
        { title: tx('Shared approvals'), body: tx('Owners review and sign payments in Disburse. Set the number of signatures your account requires.') },
        { title: tx('Recipient screening'), body: tx('Review potential sanctions matches before approval. Choose whether matches warn or block.') },
        { title: tx('Payment history'), body: tx('Track preparation, approvals and verified settlement, with records your team can export.') },
      ],
    },
    practice: {
      label: tx('In practice'),
      title: tx('Everything a pay run needs, and nothing it doesn’t.'),
      spotlights: [
        {
          mock: 'schedule' as const,
          title: tx('Pay on your schedule'),
          body: tx('Set a pay date and collect approvals in advance. Recurring instructions prepare a fresh draft each cycle.'),
          extras: [
            { title: tx('One person or a whole team'), body: tx('Select saved recipients once. Compatible payouts travel together in a single batch.') },
            { title: tx('Saved payout instructions'), body: tx('Each recipient keeps their currency, network and address. No repeated copy and paste.') },
          ],
        },
        {
          mock: 'import' as const,
          title: tx('Bring your recipient list'),
          body: tx('Import a CSV or spreadsheet export, map columns, and review duplicates before saving.'),
          extras: [
            { title: tx('Reusable recipient groups'), body: tx('Group employees, contractors and vendors so the next payment starts with the right people.') },
            { title: tx('Team roles and limits'), body: tx('Separate preparation from approval. Grant members an allowance for delegated payments.') },
          ],
        },
        {
          mock: 'reconcile' as const,
          title: tx('Reconcile and export'),
          body: tx('Review incoming funds, outgoing payments and fees by currency. Export exact amounts and references.'),
          extras: [
            { title: tx('Fees in the same workflow'), body: tx('Review a separate stablecoin fee before signing. Managed execution on supported networks.') },
          ],
        },
      ],
    },
    how: {
      label: tx('How it works'),
      title: tx('Up and running in an afternoon.'),
      lede: tx('No new wallet, no migration. Start from the account and the spreadsheet you already have.'),
      steps: [
        { n: '01', title: tx('Connect your funding account'), body: tx('Link an existing Safe account. Its owners and approval threshold remain in control.') },
        { n: '02', title: tx('Import your recipients'), body: tx('Bring your employee or vendor export, map the columns and complete missing payout instructions.') },
        { n: '03', title: tx('Review, approve and pay'), body: tx('Prepare one payment or a batch, review recipients and fees, then collect the required signatures.') },
      ],
    },
    compare: {
      label: tx('Compared'),
      title: tx('Where the control actually sits.'),
      lede: tx('Three ways to pay a team in stablecoins, and who holds what at each step.'),
      question: tx('Question'),
      columns: [tx('Sending from a wallet'), tx('Payroll provider'), BRAND],
      rows: [
        { label: tx('Who holds the funds'), cells: [tx('Whoever holds the key'), tx('The provider, while processing'), tx('Your Safe account')] },
        { label: tx('Approvals'), cells: [tx('One key signs alone'), tx('Provider login roles'), tx('Your account’s signature threshold')] },
        { label: tx('Recipient screening'), cells: [tx('None'), tx('Provider’s own checks'), tx('Sanctions screening before approval')] },
        { label: tx('Fees'), cells: [tx('Gas, guessed at'), tx('Bundled into pricing'), tx('Shown as a line item before signing')] },
        { label: tx('Records'), cells: [tx('Block explorer'), tx('Provider statements'), tx('Batch history with exports')] },
        { label: tx('Settlement'), cells: [tx('Minutes, by hand'), tx('Business days'), tx('Stablecoin settlement, minutes')] },
      ],
    },
    stats: [
      { value: '0', label: tx('funds held by Disburse') },
      { value: '1', label: tx('workflow for payroll and vendors') },
      { value: '30d', label: tx('free trial, no auto-renew') },
      { value: '3', label: tx('networks supported') },
    ],
    idea: {
      label: tx('The idea in one line'),
      text: tx('The batch, the approvals and the record are the same document.'),
      sub: tx('Prepared once. Signed by the people your account requires. Exported exactly as it settled.'),
    },
    pricing: {
      label: tx('Pricing'),
      title: tx('Simple plans. No auto-renewal.'),
      lede: tx('Core payments remain available without a subscription. You pay all network and provider fees. No automatic subscription charges.'),
      recommended: tx('Recommended'),
      forever: tx('forever'),
      per30: tx('per 30 days · charged once'),
      startFree: tx('Start free'),
      note: tx('Every new organization starts with a 30-day Team trial. It does not renew unless you choose a plan.'),
    },
    faq: {
      label: tx('Questions'),
      title: tx('The things finance teams ask first.'),
      items: [
        { q: tx('Does Disburse hold my funds?'), a: tx('No. Payments are prepared in Disburse and signed by your organization’s Safe account. Disburse never has custody and cannot move funds on its own.') },
        { q: tx('What do I need to get started?'), a: tx('A Safe account, or a few minutes to create one, plus your recipient list. Import a CSV or spreadsheet export and map the columns.') },
        { q: tx('Which currencies and networks are supported?'), a: tx('USDC on Ethereum, Base and Polygon. Each recipient keeps their preferred currency, network and address on their record.') },
        { q: tx('Does screening replace our compliance process?'), a: tx('No. Screening surfaces potential sanctions matches for your review before approval. You choose whether matches warn or block, and your own compliance process still applies.') },
        { q: tx('What happens after the 30-day trial?'), a: tx('Nothing automatic. There are no subscription charges unless you choose a plan, and core payments remain available without one.') },
        { q: tx('How are fees handled?'), a: tx('You pay network and provider fees. Where managed execution is available, the stablecoin fee is shown as a separate line before you sign.') },
      ],
    },
    cta: {
      eyebrow: tx('30-day free trial'),
      titleBefore: tx('Make your next pay run'),
      titleEm: tx('easier'),
      body: tx('Start with your existing recipient list. Review the workflow with your team before moving funds.'),
      button: tx('Try for free'),
      note: tx('30-day trial · No automatic renewal'),
    },
    footer: {
      tagline: tx('Business payments and treasury, with stablecoin settlement.'),
      columns: [
        { title: tx('Product'), links: [{ label: tx('Features'), hash: '#product' }, { label: tx('Pricing'), hash: '#pricing' }, { label: tx('Documentation'), to: '/docs' }] },
        { title: tx('Company'), links: [{ label: tx('About'), to: '/about' }, { label: tx('Blog'), to: '/blog' }, { label: tx('Contact'), to: '/contact' }] },
        { title: tx('Legal'), links: [{ label: tx('Privacy'), to: '/privacy' }, { label: tx('Terms'), to: '/terms' }] },
      ],
      legal: tx('© {{year}} Disburse. Non-custodial. Your keys, your funds.', { year: new Date().getFullYear() }),
      settlement: tx('Settlement on Ethereum, Base and Polygon'),
    },
  }
}

export type LandingContent = ReturnType<typeof useLandingContent>
export type SampleBatch = ReturnType<typeof useSampleBatch>
