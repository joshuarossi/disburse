# Team invitations

Updated September 7, 2026. Administrators create a private seven-day invitation link, then copy it or open a draft in their own email application. Disburse does not send an email or call a paid delivery provider. The UI says this explicitly. A known sign-in wallet can be invited directly instead.

## Creation and sharing

The administrator supplies the person's name, work email and workspace role. A specific wallet can be required. Creation reserves a seat and atomically saves the invitation plus an encrypted copy of its sharing URL. A retry returns the original link rather than generating a second invitation. An administrator can retrieve an outstanding link from the Invitations tab. Replacement invalidates the previous link; revocation removes its unaccepted access.

The token has 256 bits of randomness. The invitation stores its digest. The sharing payload uses AES-256-GCM, bound to the organization and request ID, and is available only to current workspace administrators. Copy failure leaves a selectable, read-only link and manual-copy instructions. Opening an email draft uses a `mailto:` link; the administrator chooses whether to send it in their own application.

## Acceptance and authority

The invitee follows the link, signs in with their wallet, reviews the organization and proposed role, and explicitly accepts. Membership becomes active only after acceptance. Acceptance checks expiry, revocation, available seats, the original inviter's current authority and any required wallet. Cross-wallet replay is rejected. Retrying an accepted invitation with the same wallet returns the existing membership.

Possession of a privately shared link **does not verify an email inbox**. Newly accepted links do not set `emailVerifiedAt` or an email-verification badge. The email is an administrator-supplied contact record. Historical verification evidence is retained for invitations delivered by the earlier email implementation.

Both invitation methods reserve seats under the current plan and check capacity again at acceptance. Expired reservations are released. Membership changes do not change Safe owners, thresholds or contract allowances. Removing workspace access does not revoke on-chain authority.

## Configuration

| Server setting | Purpose |
| --- | --- |
| `PUBLIC_APP_URL` | Canonical application origin. HTTPS outside localhost; paths, credentials and query strings are rejected. |
| `EMAIL_OUTBOX_KEY` | Independent 32-byte key encoded as 64 hex characters for private invitation payloads. The name is retained for stored-payload compatibility. |
| `EMAIL_OUTBOX_PREVIOUS_KEY` | Optional previous key during rotation while outstanding private links remain available. |
| `RESEND_WEBHOOK_SECRET` | Optional verification of historical delivery callbacks only. |

`RESEND_API_KEY` and `EMAIL_FROM` are no longer used to send invitations. The outgoing adapter fails before any network request, even if an old key remains configured. Historical outbox jobs cannot restart sending. Existing delivery evidence and signature-verified historical callbacks remain readable; they do not enable a new delivery service.

## Verification

Twelve backend tests cover access boundaries, expiry, seat reservations, explicit acceptance, original-link idempotency, encryption and rotation, historical webhook verification and refusal to send through a configured paid provider. Seven browser stories cover private-link creation, a denied clipboard, email draft preparation, wrong-wallet/expired-link states, acceptance and failed revocation. The mobile manual-copy fallback was visually inspected; no customer emails were sent.

See the [service requirements](PRODUCT_AND_SERVICE_REQUIREMENTS.md) and [current QA evidence](CUSTOMER_PAID_SERVICES_QA_2026-09-07.md).
