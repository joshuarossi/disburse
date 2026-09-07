# Payment deadlines and reminders

Schedules show the next draft time, exact approval deadline in UTC, coordinator and current account owners with workspace approval access. Each generated payment has its own deadline; changing a recurring schedule does not rewrite an existing payment. A late occurrence links to that original payment.

The header bell lists reminders assigned to the signed-in member, with an option to see all workspace reminders. Business and test activity remain separate. These are **in-app reminders**, stored by a background worker even when browsers are closed. This feature does not send email, push notifications or chat messages.

| Payment state | Reminder |
| --- | --- |
| Draft, pending or proposed; three days before pay time | Ready for review |
| Still awaiting scheduling; 24 hours before pay time | Approval deadline approaching |
| Still awaiting scheduling at pay time | Approval deadline missed |
| Scheduled but not submitted five minutes after pay time | Scheduled payment needs attention |
| Awaiting confirmation ten minutes after pay time | Confirmation delayed; inspect original submission |
| Failed scheduled payment | Review the original failure |
| Recurring preparation failed | Schedule needs attention; reason and original series |

The payment coordinator, active account owners with a payment-writing workspace role, and administrators are assigned payment reminders. Failed account verification leaves a visible error and routes the reminder to the coordinator and administrators; owners are never guessed from remembered database values. Ownership is checked at a pinned block, with Safe identity verification, and refreshed hourly. Failed checks retry after 15 minutes. Workspace permission removal takes effect on the next query immediately.

Late payment reminders become unread again once per UTC day. Changes to responsible members, verification availability or deadline phase also create a new revision. Reading is personal to the member and revision. It does not approve, send, cancel or resolve the payment. Cancelled or confirmed payments disappear immediately; resolved recurring preparation alerts disappear when the schedule is edited or resumed. A manually paused schedule does not create a failure alert. Preparation failures remain actionable until resolved rather than generating daily duplicate records.

The worker leases at most 20 payments per minute and backfills 50 historical records per tick using indexed continuations. Retry attempts reject stale workers. Payment edits, account changes and deadline boundaries are checked again after the RPC response. Rescheduling and payment status changes wake the reminder check. Bounded, cursor-based pages contain at most 50 reminder records; filtered empty pages do not imply there are no older reminders.

No reminder can authorize an automatic catch-up payment. Resuming a schedule skips missed periods and prepares the next future occurrence. Previously prepared payments remain separately reviewable. Existing payment reconciliation and contract approval requirements still govern settlement.

## Verification — September 6, 2026

- Ten backend tests cover timeline boundaries, pinned ownership, no payment/email writes, leases, stale workers, a deadline crossed during a check, RPC recovery, personal/read revision semantics, activity and organization isolation, role removal, historical backfill and missed recurring preparation.
- Seven browser stories cover desktop/light, mobile/dark, real schedule and payment deep links, unavailable owners, read failures, pagination and reminder-service failure with navigation retained. Accessibility checks pass.
- Full code checks: 521 tests in 64 files, typecheck and lint pass. The full 198-story browser run found one 320-pixel header overflow; after correction, all 16 affected reminder, activity and recovery stories pass. The other 197 stories passed in the full run.
- The built app and development backend were updated. The existing workspace's February 3 failed scheduled payment appeared automatically in the new reminder list, verified through the actual browser. Its payment state and read receipt were left unchanged.
- Screenshots in `.local/qa/payment-reminders-{light,dark}.png`, `schedule-details-{light,dark}.png` and `schedule-approvers-{light,dark}.png` were visually inspected. The mobile check also exposed bright error panels in dark mode, now corrected with theme-specific error and success colors.

Live managed settlement, a complete real second-approver cycle and external notification delivery are separate acceptance evidence; these reminder tests do not establish them.
