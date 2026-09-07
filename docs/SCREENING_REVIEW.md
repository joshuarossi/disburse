# Screening and recipient assurance

Updated September 6, 2026. The customer controls its funds and authorizes payments. Disburse supplies checks, evidence and review controls inside the finance workflow. This can be useful as an integrated service whether Disburse maintains the source data or contracts with another provider.

## Implemented screening

The direct OFAC adapter checks recipient names, aliases and published digital-currency identifiers against a versioned SDN snapshot. It does not establish address ownership, identify every sanctioned address, apply beneficial-ownership rules, or analyze transaction exposure. Payout verification remains a separate control. A poisoned address can have no sanctions match.

The importer downloads the [official SDN XML](https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml) through OFAC's [Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service). It validates XML integrity, publication metadata, unique identities and record counts before activation. Snapshots have the raw-file SHA-256, publication date and matching-engine version. Imports use resumable, idempotent chunks; an incomplete replacement never removes the active snapshot. Replaced search contents and import journals expire after seven days through bounded cleanup. Publication metadata, screening evidence and review decisions remain available.

The September 4 publication parsed during QA contains 19,329 records, 24,543 aliases and 1,007 published currency identifiers. The alias-aware index has 55,046 posting parts, about 7.3 MB of JSON. Parsing and building it locally took about 1.9 seconds. This is a compiler benchmark, not production end-to-end latency.

Name matching uses Unicode normalization and an 85% edit-similarity threshold. Candidate retrieval includes unrelated aliases, weak aliases and non-Latin text. A bounded candidate search must complete before a no-match result can be saved. Broad names, incomplete indices and errors return an unavailable result. Weak aliases are identified in the evidence; OFAC explains that they can produce many false hits and need context. [OFAC weak-alias explanation](https://ofac.treasury.gov/recent-actions/20110121).

Address comparisons are exact. EVM addresses compare their full 20-byte identity. Source currency labels are preserved. An ETH-labelled identifier on a Base recipient is shown as evidence from another network, rather than asserted to be a Base listing. Ambiguous labels such as USDT do not imply a chain. Test-network addresses are excluded from production address-identifier matching. Non-EVM identifiers are preserved in the dataset; Disburse's current payout flow screens EVM recipients. [OFAC exact-address search](https://ofac.treasury.gov/faqs/594), [currency identifiers](https://ofac.treasury.gov/faqs/563).

## Decisions and payment policy

Saved checks have immutable inputs, an input fingerprint, source and engine versions, a match fingerprint and timestamp. They bind the saved name, email, type, address, requested currency/network and payout version. A recipient attempt number prevents an older success or failure from overwriting a newer check. Concurrent recipient edits also reject the old result.

Administrators and approvers can record a reasoned decision for seven or thirty days. The evidence key must still match the displayed check. Missing, stale, unavailable or changed evidence cannot be dismissed. An exact address listed for the requested network cannot be dismissed with the name false-positive control. Decisions have durable history. A subsequent list version retains an unexpired decision only when the engine, recipient fingerprint and complete match evidence are unchanged; changed programs, aliases or matches reopen review.

| Setting | Payment behavior |
| --- | --- |
| Off | No screening hold or acknowledgement. Checks and history remain available. |
| Warn | The payment UI requires acknowledgement of current warnings; changed evidence resets that acknowledgement. |
| Block | The shared server gate refuses missing, stale, changed, unavailable, expired or unresolved results during preparation, approval and execution, including scheduled and delegated paths. |

Freshness limits are 24 hours, three days or seven days; default 24 hours. Both source verification and the recipient result must be fresh. Successfully downloading an unchanged source renews its freshness without rebuilding. Source checks run every six hours. Recipient jobs claim twenty due records per minute and continue with browsers closed. New snapshots queue active recipients in bounded pages. Manual bulk screening reports **queued**, not completed.

These are Disburse controls. Owners can act through Safe directly, and already signed transactions retain their on-chain authority. Screening cannot revoke those signatures. Warn-mode UI acknowledgement is not an on-chain restriction.

The recipient view shows details checked, match type, programs, source publication/checksum, network differences, decision expiry and history. Payment warnings include each affected recipient's actual reason. Settings shows coverage, freshness, refresh errors and update progress.

## Optional provider comparison

Primary documentation checked September 6, 2026. Vendor coverage and performance statements below are vendor claims; no paid provider was benchmarked or enabled. No recipient information was sent to these providers.

| Provider / product | Evidence and workflow | Integration and monitoring | Pricing / terms found |
| --- | --- | --- | --- |
| Direct OFAC SDN | Published names, aliases, programs and exact address identifiers; explicit, narrow coverage | Implemented local refresh and rescreening | Public download; Disburse pays its own compute, storage and maintenance. |
| Chainalysis Address Screening | Direct/indirect exposure, counterparties, time windows and configurable risk. Exposure is described as network agnostic | API and UI. UI monitoring alerts; API integrations must call again to rescreen | FAQ says API rescreens incur no extra charges. No initial-screen tariff published on the reviewed page. Confirm minimums, OEM rights and chain semantics. [Product and FAQ](https://www.chainalysis.com/product/address-screening/). |
| TRM Wallet Screening | Ownership, counterparty and indirect risk; attribution source/confidence and review history | Claims 184+ blockchains and response under 400 ms. Transaction Monitoring is complementary | Demo-led sales; no unit price on the reviewed page. Confirm monitoring costs, evidence exports and partner rights. [Wallet Screening](https://www.trmlabs.com/blockchain-intelligence-platform/wallet-screening). |
| Elliptic AML API / Lens | Wallet exposure, individual screening IDs and retrievable analysis | Batch/synchronous API, automatic and error rescreening, signed webhook alerts and retries | No unit price found in reviewed documentation. Confirm rescreening entitlement and redistribution. Strong public integration detail. [API](https://developers.elliptic.co/docs/aml-api-introduction), [rescreening and alerts](https://developers.elliptic.co/docs/rescreening-and-alerting). |
| OpenSanctions Screening API | Entity sanctions, PEP and enforcement data; complements wallet exposure checks | Use the matching endpoint for screening; Disburse owns review and monitoring orchestration | Published €0.10 per logical matching query; batches still charge per entity. OEM/reseller use needs an appropriate agreement. [Pricing](https://www.opensanctions.org/api/), [metering](https://www.opensanctions.org/docs/api/faq/), [commercial FAQ](https://www.opensanctions.org/docs/commercial/faq/). |

Narrow sanctions products differ from enriched analytics. The [Chainalysis oracle](https://go.chainalysis.com/chainalysis-oracle-docs.html) checks sanctioned addresses and disclaims guaranteed data accuracy/timeliness. The [TRM Sanctions API](https://docs.sanctions.trmlabs.com/) documents rate limits and retries. Neither should be described as its vendor's complete paid exposure or monitoring product.

## Recommendation

Keep direct OFAC evidence as the baseline. For broader entity coverage, OpenSanctions has the clearest published unit pricing. For wallet exposure, shortlist Elliptic and TRM for API evidence quality and compare Chainalysis's rescreen economics. This recommendation comes from public documentation; no commercial partnership is established.

At the published OpenSanctions rate, 1,000 recipients screened daily for thirty days would cost €3,000 before tax, negotiated discounts or support. That arithmetic argues against silently including unlimited enriched screening in an inexpensive subscription. Measure recipients, changes, monitoring frequency and exceptions before setting an optional service price. Reuse evidence only within the customer's freshness policy and provider terms.

An integration must preserve provider/product, chain/address, input, rules version, evidence ID, timestamps, coverage, errors and decisions. Signed webhook events need deduplication and monotonic version handling. Unsupported coverage is unavailable, never clear. Scores must not become an unsupported universal “safe” label. Outages stay visible under the customer's policy.

Commercial diligence must establish embedded display rights, customer consent, retention/deletion, per-query versus unique-address billing, monitoring minimums, rate limits, retries, SLA and original-evidence access. No price or service fee is enabled by this comparison. Convenience can be the paid service without Disburse holding funds or running the analytics network.

## Acceptance evidence

Regression coverage includes source interruption/resume, concurrent refreshes, exact chunk retries, publication rollback, alias/Unicode retrieval, address/network identity, stale/missing/outage policies, review expiry, changed recipients, old-attempt rejection and bounded retention. Browser stories cover desktop/light and mobile/dark evidence review, exact-address override refusal, stale evidence, refresh errors and accessibility.

These checks do not establish complete sanctions coverage or legal compliance. Larger histories, external provider service acceptance and independent review remain in [TODOS.md](../TODOS.md). Live deployment evidence is in [the fix pass](READINESS_FIX_PASS_2026-09-06.md).
