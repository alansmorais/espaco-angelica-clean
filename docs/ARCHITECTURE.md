# Architecture and production gates

## Allowed services
- GitHub Pages: static frontend only.
- Existing Google Apps Script Web App: application logic and validation.
- Existing Google Sheets: source of truth.
- Google Drive: website media.
- Google Photos: only through supported Google sharing/access flows.

No Cloud Run, Firebase, Node/Express production backend, third-party database, or extra hosting/backend service.

## Parallel-only rule
This repository must not deploy to the existing production CNAME. Keep the current site online until this rebuild passes acceptance testing and the owner explicitly approves the cutover.

## Data integrity
Do not create, clear, rename, reorder, or seed existing Sheets tabs or rows. Do not use mock/default service data, appointments, hours, customer records, prices, payment keys, or sample gallery images. Missing or unreadable official data must be reported clearly.

## Required validation before activating writes
1. Verify the deployed Apps Script URL and current spreadsheet ID against the actual Apps Script project.
2. Document actual request actions, response shapes, sheet names, and header mapping.
3. Verify public read actions without exposing personal data.
4. Verify admin authentication and session expiry.
5. Test service writes, schedule saves/blocks, booking conflicts/duplicates, payment amount calculations, Drive uploads, client profiles, email, and WhatsApp using a safe test workflow.
6. Confirm no requests are made to Cloud Run/Firebase/other backends.
7. Test on mobile and confirm the preview uses no production CNAME.
8. Obtain explicit owner approval before production cutover.
