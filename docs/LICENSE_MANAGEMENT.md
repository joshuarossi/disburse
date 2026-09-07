# Company licenses and free access

Customers control their Safe and pay their own network and provider fees. A license changes their use of Disburse's tools. It never changes the Safe's owners, approval threshold, balances, or contract permissions. Disburse has no custody key and no subscription withdrawal lock.

The product currently keeps core money management, payments and account access available after a trial or paid term ends. Those operations still require valid account authority, approved recipient instructions, sufficient funds, and the customer's chosen fee. A paid tier is not a substitute for any of those checks.

## Two independent decisions

Classifying an operation by who performs it helps explain its cost and responsibilities. It does not decide whether the feature must be paid.

| Capability | What Disburse supplies | Current packaging |
| --- | --- | --- |
| View accounts, receive funds, authorize payments | Account interface and payment preparation; the customer controls execution authority | Core access continues on Free |
| Saved beneficiaries and imports | A reviewed directory and organized payout instructions | Saved-recipient limits apply; existing records and payment use remain available after a downgrade |
| Team members | Membership, invitations, app roles and coordination | Seat limits apply to adding members and reserving invitations; existing members retain their roles |
| Scheduled and recurring payments | Stored instructions, preparation and execution services | Included today, with customer-paid fees; no new automation gate has been introduced |
| Accounting exports and standard reports | Book mappings, reconciliation and organized records | Included today; a specialized reporting tier is an undecided product choice |
| Sanctions screening | Screening evidence, updates and customer-selected enforcement | No new plan gate; licensing does not relax a customer's payment safety policy |
| Invoicing, managed relay, yield, conversion or bridging services | Integration, monitoring or execution support from Disburse and external providers | Charges and future tier limits require their own decisions and reviewed consent; a free license does not subsidize execution |

Seats, beneficiaries and specialized reports can be paid conveniences while customers remain free to use Safe or another interface. Avoid describing every service as necessarily paid, every money operation as necessarily free forever in all future packaging, or the SaaS license as control of funds. The present product choice is to keep core payments free.

## Operator workflow

Open `/admin/licenses` with a signed-in wallet listed in `DISBURSE_LICENSE_OPERATORS`. The allowlist accepts comma- or whitespace-separated full EVM wallet addresses. It has no default operator. The workspace selector displays the license-management link only to an authorized operator. Organization administrators cannot give themselves a license grant or inspect other companies.

1. Choose a company and review its current access.
2. Select normal subscription/trial access, a dated trial, or complimentary access. A complimentary grant can have an end date or never expire.
3. Select the access tier and the permanent free fallback tier. Any built-in tier can be granted without a subscription charge. Custom free tiers have a name, member limit and recipient limit; a blank limit means unlimited.
4. Review the resulting access and provide an internal reason. Saving records an operator event and a company audit event. The private reason appears only in the operator console.

Every change carries a revision and idempotent request reference. A stale form cannot overwrite a newer license. A retry cannot create a second grant or extend a period again. Resolve an outstanding subscription checkout before changing a company's license.

The signup-program screen controls future organizations only. It can offer 30 days of Pro followed by lifetime Free, a different trial duration/tier, or immediate free access. A convenience button fills the 30-day Pro offer for review; only Save applies it. Changing this program does not rewrite existing companies. The default trial remains 30 days with five member seats and 100 recipients until an operator chooses different signup terms.

## Access and paid records

Access resolves from a current operator grant, otherwise a valid paid/trial period, otherwise the company's free fallback. The default fallback is Free with one member seat and 25 saved recipients. Missing or invalid dates never create perpetual premium access. Time is checked on the server and refreshed in the browser.

Free grants, trials and paid receipts are separate records. Giving Pro to a company for free does not fabricate revenue, extend its paid-through timestamp, or create monetary credit. An existing paid term stays in history. If a limited grant expires while a paid term is still current, that paid access resumes.

A later verified subscription payment replaces an operator grant, preserves the free fallback and consumes its receipt exactly once. Only unused paid time can become upgrade credit. Checkout explains the replacement before requesting payment. An expired paid Pro record must not prevent a Free customer from choosing Team.

New organizations no longer receive an automatically inserted Disburse beneficiary. Subscription checkout has its own verified destination and does not consume a customer directory slot or bypass recipient review.

Free's current limits cover the former Starter offer. New Starter checkout is disabled and the public offer is Free, Team and Pro. Historical Starter receipts and an already prepared checkout can still complete under their original terms. This avoids charging a new customer for limits already included in Free.

Tier snapshots are stored on new organizations, grants and signup programs. Custom tier definitions are immutable. Plan limits govern expansion; downgrading does not remove users, delete beneficiaries, or prevent payment to an existing approved recipient. Existing account ownership and contract policies are untouched.

## Verification

Backend stories cover operator authentication and denied self-grants, permanent access without payment records, concurrent revisions, retry identity, tier validation, directory enforcement, trial boundaries, invalid premium grants, future-only signup changes, checkout conflicts and paid-receipt redemption.

Browser stories cover creating and assigning a custom lifetime tier, trial extensions, the 30-day Pro signup preset, denied operator access, free/complimentary billing, customer-paid fees, and absence of false expiry warnings. Desktop light and mobile dark screenshots are inspected separately. The ordinary browser suite uses isolated fixtures. A separate normal-build acceptance also granted complimentary Pro to the isolated development QA company, verified its billing screen after reload, preserved its payment history, and restored its original access. Temporary operator authorization was removed and all QA sessions were revoked. No production company license or network transaction was involved.

Additional payment regressions verify ordinary and delegated execution after trial expiry. The real operator-console acceptance passed with `scripts/qa-license-management.mjs`. Live paid subscription settlement remains a separate acceptance item.
