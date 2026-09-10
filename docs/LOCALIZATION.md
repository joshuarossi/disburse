# Application languages

English, Spanish and Brazilian Portuguese are available throughout the workspace. Change language in Settings → General → Workspace language, or open your profile preferences in the navigation. Onboarding, sign-in, invitations and public invoice/recipient forms also provide a selector.

The browser retains the choice. Signed-in users also save it to their account. If that save fails, the local choice remains and a visible retry action appears. There is one i18next instance for public and authenticated routes. Components subscribe to language changes without being remounted, so open drafts retain their names, recipients, payout currencies, amounts and dates. RainbowKit uses the selected language; MetaMask's own extension screens follow its settings.

## What changes with the language

Authored labels, navigation, statuses, accessible descriptions, confirmation dialogs, known validation/recovery messages and email drafts use the selected language. Complete count phrases handle plural forms. Shared server-authored notices resolve against known message templates locally; unknown provider wording uses the flow's own translated recovery message. Error sanitization still removes RPC diagnostics and calldata.

Displayed dates and exact decimal amounts follow the locale. Scheduling remains UTC. Money inputs retain the documented decimal-point notation used by the payment parser. Financial amounts never pass through floating-point conversion for localization. Recipient and account names, customer-entered descriptions, network names, token symbols and addresses retain their original values. CSV column identifiers and numeric values remain stable for reconciliation; audit timestamps export in ISO UTC.

Translations ship with the frontend. No customer data or runtime text is sent to a translation service. Switching language does not sign, submit or alter a payment.

## Maintaining translations

The existing public/settings catalog uses semantic keys in `src/locales/*/translation.json`. Finance workflow copy uses complete English messages in `src/locales/*/workspace.json`. Pass application-authored copy to `tx`; interpolate customer values rather than using them as keys. Subscribe with `useWorkspaceLanguage` in components that use this namespace. Translate display text at render time where possible, and keep API identifiers and export serialization separate.

Add every new message to all three catalogs. Use a complete message with `count` and `_one`/`_other` entries for plurals, with an explicit `_zero` form for empty counts. Tests check key/interpolation parity, untranslated authored JSX and accessible attributes, exact amounts, shared validation, preference saving and retry, and form state across language changes. The browser suite exercises localized page layouts, mixed-currency payment review, bills, recipient forms, public invoice errors and language persistence.

## Release verification

The localization checks cover all ten workspace pages in Spanish and Portuguese at desktop/light and mobile/dark sizes, plus payment review, bill and recipient forms, import failures, wallet cancellation, account-preference retry and reload, and public invoice errors. The payment story retains Maya's USDC and Arjun's USDT after changing batch defaults, including six-decimal amounts. A real draft remains intact when the language changes. Transaction exports in both languages are compared byte for byte with English, including raw amounts and UTC timestamps.

The unit checks require catalog/interpolation parity, named translation keys, authored JSX and accessible labels. They also check money precision above `Number.MAX_SAFE_INTEGER`, shared validation with literal recipient details, and account-preference save failures. Existing contract, accounting and payment regression checks remain part of CI. Browser payment tests for this frontend change use the QA fixtures; deployment verification checks real sign-in and preference persistence without sending funds.

## General Translation assessment, 8 September 2026

General Translation is a suitable candidate for maintaining these catalogs. Its [React/Vite integration](https://generaltranslation.com/en-US) and [JSON tooling](https://generaltranslation.com/llms.txt) support our stack. Its [GitHub action](https://github.com/generaltranslation/translate) can propose translation changes for review. The current runtime does not need replacement just to adopt a translation generation workflow.

Recommended integration: send only authored source messages with placeholders, generate translations in a development/CI job, review them in a PR, run the localization/browser checks, and bundle the approved files. Configure a finance glossary distinguishing bills payable, invoices receivable, transaction fees, approvals and spending allowances. Keep runtime customer records out of the translation job. GT supports [local translation loading](https://generaltranslation.com/en-US/docs/react/concepts/environments), so app availability need not depend on a translation API.

The [Starter platform fee is $0](https://generaltranslation.com/en-US/pricing), with usage charges. Its [published JSON rate](https://generaltranslation.com/en-US/pricing/usage) is $1 per 1,000 input tokens, plus context charges; agent and live translation have separate rates. This would be a development expense for Disburse. It does not participate in customer payments or their transaction fees. No GT account, credentials, paid job or runtime dependency was added in this change.
