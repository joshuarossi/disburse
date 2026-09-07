# Source documents and reviewed invoice extraction

Bills now accepts a source invoice before the finance team enters its fields. The app reads digital PDFs and plain text on the user's device, offers explicit invoice-number, due-date, amount and payment-currency suggestions, and waits for **Use suggested fields** before filling them. A separate confirmation is required before saving a bill with a source. Editing a field resets that confirmation.

The saved recipient is always chosen from the organization's directory. Document addresses never become payment destinations. USD or EUR in a document does not silently select a stablecoin; the user must confirm the agreed payment currency. Conflicting totals, ambiguous dates and comma-only ambiguous amounts remain manual. Preparing, approving and settling the payment remains a separate existing workflow.

## Source storage and recovery

Uploads and downloads verify a current SIWE session and workspace membership. Administrators, approvers, payment preparers and clerks may upload; viewers may download sources attached to their workspace's bills. An unattached upload is private to its uploader. Download requests use an authorization header rather than placing a session in the URL. The app exposes no public storage URLs.

The backend checks file signatures, declared type, size and file names. It computes SHA-256 itself and records the checksum, uploader and source review in the audit trail. Attaching documents and recording the reviewed bill are atomic. A file can belong to only one bill. Saved sources remain available after settlement or voiding; they cannot be silently removed or replaced. Additional documents can be attached while an unpaid bill remains editable, up to five total.

Upload requests have stable identities and return the same receipt after a lost response. Repeated uploads discard their duplicate blobs. Bill creation also has a stable receipt; a lost response cannot create another bill or repeat source review. Changed retries are rejected, and edits check the bill version the reviewer opened. The source review does not bypass duplicate vendor/invoice-number checks or the lock on a bill with a pending/completed payment.

Unattached files expire after 24 hours; a bounded cleanup job removes them. Uploaders can have at most 20 staged documents at once. Upload and download responses are not cacheable. Downloads use attachment disposition, content-type enforcement and a restrictive content security policy.

The custom authenticated upload/download approach uses Convex's HTTP actions and storage API. Convex documents the difference between generated upload URLs and controlled HTTP upload flows, including their request limits. [Convex file uploads](https://docs.convex.dev/file-storage/upload-files), [serving stored files](https://docs.convex.dev/file-storage/serve-files).

## Reader limits

| Item | Current behavior |
| --- | --- |
| File types | PDF, PNG, JPEG, WebP and UTF-8 plain text |
| File size | At most 10 MB, enforced during upload streaming |
| Automatic reading | Digital PDFs and text; at most 30 PDF pages and 200,000 extracted characters |
| Preview | First PDF page rendered as an image; extracted text and original download available |
| Scans and images | May be attached; fields are entered manually. OCR is not offered by this reader. |
| Password-protected, oversized or unreadable PDFs | Keep the attachment and enter fields manually; no extracted values are claimed |
| Payment addresses | Never extracted into recipient or payment instructions |

PDF.js **6.3.289** is pinned and loaded only when needed, with its matching local worker. The app uses the display API for text and a rendered image, with XFA disabled and image/preview work bounded. It does not embed the scripting-enabled viewer or execute document actions, annotations or links. This version follows the fixed release identified in Mozilla's July 2026 advisory. [Mozilla current release](https://mozilla.github.io/pdf.js/getting_started/), [Mozilla advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j).

No document is sent to an external OCR or AI provider. This is conservative extraction, not a guarantee that a supplier's invoice is accurate. The original document and explicit human review remain part of the record.

## Verification — September 6, 2026

- Eight backend and four parser tests cover signatures, permissions, private downloads, checksums, repeat uploads, transaction rollback, source ownership, expiry, bill creation recovery, stale/unreviewed edits and retaining attached evidence.
- Five browser stories use a real PDF and cover light desktop, dark mobile, suggested-field review, retained input after upload failure, ambiguous values, oversized files and download failure. Accessibility checks pass; source preview screenshots were visually inspected.
- Full regression suite: **533 code tests in 66 files**, typecheck and lint pass; **207 browser stories pass**, including header visibility at 320, 390, 757, 900, 1024 and 1440 pixels. Build/typecheck passes with the reader separately loaded.
- `bun scripts/qa-invoice-source.mjs` passed against the actual development backend and the isolated Sepolia QA organization. It uploaded and recovered the same source, denied unauthenticated access, saved one reviewed bill, downloaded matching bytes and voided the QA bill. No payment was prepared or sent.

Evidence: `.local/qa/invoice-source-evidence.json`, `.local/qa/invoice-source-{light,dark}.png`, `/tmp/disburse-invoice-source-{check,e2e-all,live,build,deploy}.log`. The user-facing source flow and protected storage are implemented; broader accounting mappings, receivable attachments/credit notes and provider OCR remain separate work.
