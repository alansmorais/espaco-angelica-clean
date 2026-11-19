# Google Calendar integration — shared calendar access

## Confirmed architecture

- Implement only on `feature/google-calendar-sync-preview`.
- The calendar has already been shared with the account that will operate the integration.
- Use the native Google Apps Script `CalendarApp` service under the Apps Script project's execution identity.
- The Apps Script execution account must be the account that received the calendar share, with **Make changes to events** permission.
- No Google Cloud project, OAuth client, OAuth consent screen, OAuth2 library, or separate Angélica consent flow is required for this shared-calendar model.
- Keep the existing Google Sheets workbook as the booking source of truth.
- Resolve service durations from column F of the official service catalogue.
- Do not modify the live Apps Script deployment, official spreadsheet, production website, or real Calendar events during development.

## Configuration

Set the Script Property `GOOGLE_CALENDAR_ID` in the Apps Script project to the exact ID of the shared calendar. Do not assume the owner's email address is the calendar ID; use the Calendar settings' calendar ID or the exact ID supplied by the owner.

The project must be authorized to use the Apps Script Calendar service by its execution account. If `CalendarApp.getCalendarById` returns null or permission errors, verify:
1. The Apps Script project/deployment executes as the account that received the share.
2. That account has **Make changes to events** permission.
3. `GOOGLE_CALENDAR_ID` is the exact shared calendar ID.
4. The Apps Script project has been authorized for Calendar access.

## Implemented development preview

The development copy of `apps-script/Code.gs` now contains:
- `getSharedCalendar_()`: resolves the shared calendar from `GOOGLE_CALENDAR_ID`.
- `getCalendarSyncPreview(data)`: reads events in a requested date range (defaults to 90 days back and 180 days forward), returning event IDs, titles, start/end times, all-day status, calendar name, and timezone.
- Protected POST action `getCalendarSyncPreview`.

This action is strictly read-only. It does not write to Sheets, create/update/delete Calendar events, or import historical appointments. It is not deployed to the live Apps Script web app.

## Next implementation stages

1. Verify the preview can read the shared calendar using the actual Apps Script execution account.
2. Build a reconciliation preview that compares Calendar events against Sheet rows without writing.
3. Confirm the real `Agendamentos` header layout and identify a safe dedicated Calendar Event ID field. Never repurpose an existing column.
4. After explicit approval, import only approved real bookings into rows after the existing data (currently expected to begin at row 25), with duplicate protection.
5. Resolve each procedure's duration from the official service catalogue column F.
6. Correct Calendar event end times only after a dry-run report has been reviewed and approved.
7. Make ongoing create/update/cancel synchronization idempotent and reconcile partial failures.

## Reconciliation rules

- Do not import all-day entries such as `Folga` as customer appointments.
- Do not import explicit test events.
- Match existing Sheet rows conservatively using event ID where available, otherwise a normalized combination of client, date, start time, and service; report ambiguous matches instead of guessing.
- Keep the Sheet as the authoritative source for procedure duration.
- Calculate event end as event start plus the official duration; never assume a one-hour default.
- Preserve event title, description, location, recurrence, and other Calendar metadata unless a specific change is approved.
- Never delete or cancel an event merely because it is absent from the Sheet.
- Do not change rows 1–24 or overwrite any existing booking.
- Treat cancelled Sheet bookings and Calendar cancellations explicitly; never silently infer deletion.

## Safety and acceptance

- Preview branch only; no production deployment or live writes without explicit approval.
- Read-only preview must show the shared calendar identity and the exact range checked.
- Dry-run reconciliation must report matched, calendar-only, sheet-only, skipped all-day, skipped test, and ambiguous records.
- A service's Calendar interval must equal the official duration from column F.
- A retry must not create duplicate Sheet rows or Calendar events.
- Edits must update only the linked event; cancellations must affect only the event linked to that booking.
- Production remains untouched until the owner explicitly approves deployment and synchronization.
