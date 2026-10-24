# Espaço Angélica do Carmo — clean rebuild

This repository is an isolated parallel rebuild. The existing production site and repository must remain untouched until the rebuild passes validation and the owner explicitly approves cutover.

## Production architecture (strict)
- Static frontend: GitHub Pages.
- Application logic/API: existing Google Apps Script Web App.
- Source of truth: existing Google Sheets spreadsheet. Do not recreate, rename, clear, reorder, or seed existing tabs/rows.
- Media: Google Drive for owned images; Google Photos only where supported access/sharing permits it.
- Source control and deployment: GitHub + GitHub Actions.

Do not use Firebase, Cloud Run, Node/Express as a production backend, another database, or another hosting/backend service.

## Safety requirements
1. Never deploy this repository to the current production domain.
2. Begin with read-only integration checks; no writes to the live spreadsheet during discovery.
3. Do not show fake/sample service records, appointments, customers, opening hours, prices, Pix details, or photos as fallbacks.
4. Missing data must show a clear empty/error state.
5. Administrative writes must be authenticated and validated in Apps Script, never trusted to frontend validation alone.
6. Never commit passwords, long-lived admin tokens, Meta WhatsApp secrets, or other credentials.
7. Preserve existing visual identity and workflows, but do not carry over legacy Cloud Run/Firebase authentication.
8. Do not activate public booking or administrative writes until the deployed Apps Script contract, payment settings, and conflict validation are confirmed.
9. Cutover only after owner approval.

## Existing integration (must verify)
Apps Script Web App URL previously provided:
`https://script.google.com/macros/s/AKfycbysNBMLthA_GvAZJR1irBGcS-3Lspbfz0NIsvz0P2ax6jzE4M01RwVJ0za6zFsq8bGojw/exec`

Spreadsheet ID found in the old repository:
`1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0`

The owner-provided deployed `Code.gs` text is the compatibility reference for this rebuild. Do not replace it with the repository's reviewed copy or deploy the repository copy to the live project. The deployed text contains read paths with side effects: `getOfficialSheet()` writes optional headers, and schedule-config reads may create the `Configuração da Agenda` tab. Therefore, do not call `getPublicAvailability` or `getScheduleConfig` from the preview until those paths are confirmed safe. Avoid printing or exposing personal customer data during diagnostics.

See [`docs/deployed-apps-script-compatibility.md`](docs/deployed-apps-script-compatibility.md) for the current action-by-action compatibility notes and the read paths intentionally blocked in preview.

## Acceptance stages
1. Static preview and repository workflow; no production CNAME.
2. Match existing visual design and migrate assets.
3. Verify read-only Apps Script calls and actual sheet schema.
4. Implement reads, then authenticated writes.
5. Test scheduling, overlap prevention, price/deposit rules, photos, CRM, email and WhatsApp.
6. Test isolated GitHub Pages preview on mobile.
7. Production cutover only after explicit approval.

## Current status (2026-10-24)
- React public site and admin UI are in the isolated repository and the static build passes in GitHub Actions.
- The preview remains read-only (`READ_ONLY_PREVIEW = true`); public booking and admin writes are not enabled. GitHub Pages does not fall back to the official Apps Script URL, ignores browser-local webhook overrides, and requires explicit build-time opt-in before any staging API endpoint can be used. Known side-effecting availability/schedule reads are skipped.
- Browser-local appointment archives have been removed from the app's source-of-truth flow.
- Contact links now read the studio WhatsApp number and Instagram URL from the official `WHATSAPP_CONFIG` app setting. Catalogue readers reject incomplete rows instead of inventing service values.
- The repository's `apps-script/Code.gs` and `src/data/codeGsTemplate.ts` are repository copies, not the live source of truth. The owner-provided deployed `Code.gs` text is the reference for frontend compatibility; do not copy or deploy the repository copy over it.
- GitHub Pages deployment remains intentionally skipped; the workflow only builds and uploads an artifact.
- The current repository is public. Never put passwords, API tokens, payment credentials, or customer data in commits.

## Outstanding validation before enabling booking or admin writes
1. Reconcile the owner-provided deployed Apps Script actions and response shapes without calling endpoints whose reads mutate Sheets. The preview now skips the known side-effecting availability and schedule-config reads.
2. Confirm the existing Drive folder ID and sharing permissions for gallery photos.
3. Confirm the official sheet's schedule and contact settings without creating or editing tabs during discovery.
4. Test price/deposit validation, scheduling conflicts, admin session expiry, and the customer contact/email flows in isolation.
5. Review the isolated GitHub Pages preview on mobile before any deployment decision.
6. Production cutover requires explicit owner approval.
