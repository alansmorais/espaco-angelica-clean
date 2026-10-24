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

Do not assume the deployment currently serves the latest code. Verify Apps Script actions and response shapes read-only before implementing data flows. Avoid printing or exposing personal customer data during diagnostics.

## Acceptance stages
1. Static preview and repository workflow; no production CNAME.
2. Match existing visual design and migrate assets.
3. Verify read-only Apps Script calls and actual sheet schema.
4. Implement reads, then authenticated writes.
5. Test scheduling, overlap prevention, price/deposit rules, photos, CRM, email and WhatsApp.
6. Test isolated GitHub Pages preview on mobile.
7. Production cutover only after explicit approval.

Current status: starter skeleton only; not production-ready.
