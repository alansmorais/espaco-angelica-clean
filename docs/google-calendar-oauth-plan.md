# Google Calendar integration plan — Espaço Angélica

## Confirmed decisions
- Implement on `feature/google-calendar-sync-preview` only.
- Keep the existing Google Sheets workbook as the booking source of truth.
- Keep service durations sourced from column F of the official service catalogue.
- Angélica authorizes the app directly with `angelikm19@gmail.com`; do not ask her to share the calendar with Alan's personal Google account.
- Do not modify the live Apps Script deployment, live spreadsheet, production website, or create real calendar events during development.
- WhatsApp/Meta Business Agent integration is a later phase.

## Identity and OAuth architecture
The existing Apps Script web app is deployed to execute as its owner. Calls made with that execution identity do not automatically act as Angélica. Calendar access must therefore use a separate OAuth 2.0 authorization grant from Angélica.

Use an OAuth 2.0 web-server authorization-code flow:
1. Admin opens a protected "Conectar Google Calendar" screen.
2. Backend generates a one-time state value and redirects Angélica to Google's consent page.
3. Google redirects to the registered Apps Script callback.
4. Backend validates state, exchanges the authorization code, and securely stores the refresh token.
5. Backend refreshes access tokens as needed and calls Calendar API server-side only.
6. UI shows connection status and the authorized account email; never expose refresh/access tokens to the browser.

Use the Apps Script OAuth2 library (official Apps Script external-service guide documents the library approach). Store OAuth client secret and refresh token only in Script Properties or another server-side secret store. Never commit credentials or return them in JSON responses/logs.

## Candidate minimum Calendar scopes
- `https://www.googleapis.com/auth/calendar.events.owned` — create, view, update, and delete events on calendars Angélica owns.
- `https://www.googleapis.com/auth/calendar.events.freebusy` — query availability for calendars she can access.

Confirm the exact API method compatibility and consent-screen requirements during implementation. Do not request full `calendar` scope unless a required operation cannot be performed with narrower scopes.

## Calendar behavior
- Query Google Calendar busy intervals before offering a slot.
- Resolve primary and additional service durations from the official service catalogue (column F); do not accept duration supplied by the browser or a future WhatsApp agent.
- Check the entire requested interval, including overlap with existing Sheets bookings and Google Calendar busy intervals.
- On confirmed booking, persist the booking in Sheets and create one Calendar event covering the complete duration. Do not create a second "block" event.
- Store the resulting Google Calendar event ID against the booking record in a dedicated, explicitly approved field/column after reviewing the real sheet schema. Do not repurpose an existing column without confirmation.
- On edit, update the matching Calendar event. On cancellation/deletion, cancel/delete only the event linked to that booking ID.
- Make create/update/cancel operations idempotent and reconcile partial failures (e.g. sheet write succeeds but Calendar API fails) without silently reporting success.
- Use the studio's configured timezone consistently; verify it from the official settings before coding.

## Preview and test safety
- Preview must remain read-only and disconnected from production mutations.
- Do not call known side-effecting availability/schedule reads against production from preview.
- Use a dedicated test calendar and isolated test spreadsheet/backend for integration tests.
- Never import historical appointments or create real events without explicit owner approval.
- Do not replace the deployed Apps Script with this repository copy. The repository's `apps-script/Code.gs` is a development copy only.

## OAuth publishing caveat
For an External OAuth consent screen left in Testing, Google documents that refresh tokens expire after 7 days (except basic identity-only scopes). Before relying on long-lived authorization, configure the app's publishing/verification state appropriately and confirm the impact of Calendar scopes. Add Angélica as a test user during development if the consent screen is External/Testing.

## Setup required before live authorization
- Google Cloud project selected/created and Google Calendar API enabled.
- OAuth consent screen configured with app name, support contact, privacy policy and authorized domains as required.
- OAuth client ID/secret for a Web application.
- Exact Apps Script callback URL registered as an authorized redirect URI.
- Angélica's account added as a test user if applicable.
- OAuth client secret and library configuration stored server-side.
- Dedicated test calendar and isolated test backend available.

## Acceptance tests
1. OAuth connects specifically as `angelikm19@gmail.com`.
2. Backend reports connected/disconnected state without leaking credentials.
3. Busy time blocks a candidate slot.
4. A 3-hour service at 13:00 creates exactly one event from 13:00 to 16:00.
5. Sheets duration remains authoritative even if a client submits a different duration.
6. Existing Sheets bookings and Calendar busy events both prevent overlap.
7. Editing a booking updates the same event ID.
8. Cancellation removes/cancels only the linked event.
9. Retry after partial failure does not create duplicate events.
10. Production remains untouched until explicit approval.
