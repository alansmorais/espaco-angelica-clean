# Calendar-first duration synchronization

## Authoritative flow

1. Google Calendar is authoritative for whether an appointment exists and for its actual date and start time.
2. Each eligible Calendar appointment is matched to an Agendamentos row or imported there once.
3. The synchronizer reads the main service and every additional service from the official service catalogue tabs (Serviços, Servicos, Depilação, Depilacao).
4. Durations are read only from column F. The main service and all add-ons are summed.
5. The synchronizer calculates end = Calendar start + total duration and patches only the existing Calendar event's end field. Its start, title, description and other fields are not rewritten.

There is no Sheet-to-Calendar event creation path in this module.

## Recurring appointments

This implementation uses the Apps Script Advanced Google Calendar service (Calendar API v3), not CalendarApp.

The event list request sets singleEvents = true, so the API returns individual recurring instances. Each instance has its own event ID, recurringEventId for the parent series, and immutable originalStartTime. Column T stores the individual instance ID; column U stores originalStartTime. The original start key allows a moved occurrence to remain linked to the same occurrence instead of being confused with a neighbouring date.

Official references:
- https://developers.google.com/workspace/calendar/api/guides/recurringevents
- https://developers.google.com/workspace/calendar/api/v3/reference/events
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list

## Fail-closed protections

- All-day events, non-standard event types, personal blocks, holidays, vacations, lunch, meetings, admin events and test events are excluded.
- Unlinked events are imported only when the title contains a client segment and exact service titles found in the official catalogue. Approximate aliases are not guessed.
- An unknown, duplicate or invalid service/add-on duration is reported for review; no end time is changed.
- If a proposed duration overlaps another Calendar event, the event is left unchanged and reported.
- An appointment whose duration would cross midnight is left unchanged and reported.
- A recurring event is matched by its unique instance ID and original start. Legacy rows containing the parent series ID are migrated only when the original occurrence date/time matches uniquely.
- A cancelled Calendar instance is marked cancelado in Sheets only when its event/occurrence can be matched uniquely. Rows are not deleted.
- A cancelled or human-review row is never re-imported as a new booking.
- Known appointment exceptions and pending-review IDs remain protected.
- The module never creates, deletes, moves, renames or changes the start of a Calendar event.

## Activation prerequisites

The module is deliberately disabled by default. Do not activate it until the owner has reviewed the dry-run report.

1. Add CalendarFirstDurationSync.gs to the existing Espaço Angélica Apps Script project.
2. Enable the Advanced Google service Google Calendar API v3 for that Apps Script project (the service symbol must be Calendar).
3. Confirm Script Properties:
   - SPREADSHEET_ID exactly matches TARGET_SPREADSHEET_ID in Code.gs.
   - GOOGLE_CALENDAR_ID is the shared studio calendar ID.
   - Keep CALENDAR_FIRST_SYNC_ENABLED unset or false while auditing.
4. Run auditCalendarFirstSyncConfig(); it is read-only.
5. Run runCalendarFirstSyncDryRun({ daysAhead: 365 }); it is read-only. Inspect every needsAdminReview and durationResults entry before enabling writes.
6. Review the trigger list returned by auditCalendarFirstSyncConfig(). If legacy handlers are present (syncCalendarBookingsToSheet, syncCalendarChangesToSheet, handleSpreadsheetEditForCalendarSync), do not install the new triggers. The audit blocks activation while those old handlers or the legacy CALENDAR_DURATION_SYNC_ENABLED=true flag remain active.
7. If an old trigger is listed, inspect its owner, purpose and current behavior manually. Do not delete it as part of this change. Disable an old trigger only after a separate explicit decision and only once the new sync has passed its dry-run.
8. Only after the old-trigger audit is clean and a separate explicit approval, set CALENDAR_FIRST_SYNC_ENABLED=true and manually run installCalendarFirstSyncTriggers(). The installer refuses to proceed if it detects legacy or duplicate handlers. It only adds missing new Calendar/Sheet triggers and never deletes existing triggers.

syncCalendarBookingsAndDurations() defaults to dry-run. Calling it with dryRun:false still stays read-only unless the Script Property is exactly true.

## Public website booking flow is intentionally unchanged

The existing public website booking path currently writes a booking through createBooking to Google Sheets. This module does not change that public flow and does not create Calendar events from those rows. Converting public web bookings to Calendar-first is a separate product decision and must not be inferred from this synchronization change.

## Validation scope

The accompanying unit tests validate duration parsing, strict service/add-on resolution, title classification, recurrence instance identity, cancelled rows, conflict detection, write-disable defaults and the absence of Calendar create/delete/title/description mutations. They do not replace the Apps Script dry-run against the live project, nor do they authorize production activation.


## Calendar titles and approved aliases

The parser uses known full names from the existing Agendamentos and Clientes sheets. It supports a limited list of legacy service labels already used by the previous sync implementation (for example, mão, pé, pé e mão, manutenção e pé). Each alias maps to explicit service IDs, and every mapped ID must exist exactly once in the current official catalogue before the appointment can be imported or its duration calculated. If an ID is missing/duplicated, the event is sent to human review without a Calendar update. Course/training/workshop/holiday/blocking events are protected and are never treated as customer bookings.
