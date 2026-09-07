# Team invitations

Implemented September 6, 2026. Email is the default invitation method. An administrator supplies a work email, name and workspace role; a known sign-in wallet can be required when appropriate. The recipient follows a private seven-day link, proves control of their wallet through the existing SIWE sign-in, reviews the role and accepts explicitly. Membership becomes active only after acceptance.

## Delivery and recovery

Creation atomically saves the invitation and its delivery job. The invite token has 256 bits of randomness; its digest is stored in the invitation. The email payload is encrypted with AES-256-GCM, bound to the organization/request ID as authenticated data. Only the server delivery worker can decrypt it. The browser receives an invitation ID, never the administrator's copy of an email-verification link.

The outbox sends through Resend. A retry retains the exact payload and idempotency key, including a response lost after submission. A bounded recovery queue runs each minute, claims at most ten messages, uses leases, and rejects stale worker updates. Retry attempts stop after five tries or before the provider's 24-hour idempotency window. Replacing an invitation creates a new link and invalidates the old one. Encrypted payloads are cleared after confirmed submission, terminal failure, revocation or acceptance.

The UI distinguishes queued, sending, accepted by the email service, delivered to the mail server, bounced, failed and unconfirmed delivery from invitation acceptance. Delivery does not mean the message was read. Webhooks verify the unmodified request body using the Resend SDK and configured signing secret. Duplicate and out-of-order events cannot erase newer outcomes. Events received before their provider ID is saved return a retryable response. [Resend sending and idempotency](https://resend.com/docs/api-reference/emails/send-email), [idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys), [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [delivery event meanings](https://resend.com/docs/webhooks/event-types).

## Access boundaries

Both invitation methods reserve seats on the current plan; acceptance checks capacity again. Expired reservations are released. Removed or demoted inviters cannot grant access through their old links. Email acceptance binds the email to the authenticated wallet, honors an optional required wallet, rejects cross-wallet token replay and records an audit event. Retrying acceptance from the same member returns the existing membership. Editing a verified email removes its verification status.

Wallet-specific invitations remain available. They expire after seven days and require the named wallet to accept. The UI supplies a sign-in link for sharing and explicitly says no email was sent. Historical invitations without expiry metadata retain their existing behavior; newly created and renewed wallet invitations have expiry and inviter-authority checks.

Membership changes never change Safe owners, thresholds or contract allowances. Revoking an unaccepted invitation cannot remove an already active member; that requires the member access flow. Removing workspace access does not revoke on-chain authority.

## Configuration

Server environment variables:

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Sending key, kept on the backend. |
| `EMAIL_FROM` | Verified sender identity. |
| `PUBLIC_APP_URL` | Canonical application origin for invitation links. HTTPS required outside localhost; query strings, credentials and paths are rejected. |
| `EMAIL_OUTBOX_KEY` | Independent 32-byte key encoded as 64 hexadecimal characters. |
| `EMAIL_OUTBOX_PREVIOUS_KEY` | Optional previous key during rotation while outstanding deliveries finish. |
| `RESEND_WEBHOOK_SECRET` | Signing secret for `POST /webhooks/email` on the Convex HTTP deployment. |

No fallback sender or production hostname is guessed. Missing delivery configuration prevents creation of an email invitation and says no message was sent. Link creation does not introduce new subscription prices or send a customer email as part of deployment.

## Verification

Eleven backend stories pass: encrypted/idempotent creation, signed wallet binding, replacement/revocation, expiry and inviter authority, organization/wallet boundaries, seat reservations, lost send response, stale delivery worker, webhook signatures/replay, configuration validation and key rotation. Six browser stories cover email-first creation, wallet fallback, role review, explicit acceptance, delivery/bounce states, revocation failure, expired links and the wrong wallet. Desktop/light and mobile/dark screens were inspected, including automated accessibility checks.

The full code suite passed 505 tests across 63 files and the full browser suite passed 183 checks. Transport tests mock Resend and use signed webhook fixtures; no actual customer invitation email was sent. Live mail-server delivery remains a provider acceptance check when the sending domain and service configuration are enabled. The backend and built app are deployed to the development workspace for interface review.
