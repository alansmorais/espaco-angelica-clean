# Deployed Apps Script compatibility notes

This document tracks the frontend integration against the owner-provided deployed `Code.gs` text. That deployed text is the compatibility reference; the repository copy at `apps-script/Code.gs` is **not** a replacement for it.

## Current safe-preview behavior

- `READ_ONLY_PREVIEW` remains enabled. Booking, admin access, and all frontend write handlers remain disabled.
- GitHub Pages is treated as an isolated staging host: the client does not fall back to the official Apps Script URL and ignores browser-local webhook overrides. Staging API access requires both a build-time `VITE_NOTIFICATION_WEBHOOK_URL` and explicit `VITE_ALLOW_STAGING_APPS_SCRIPT_URL=true`; the official default endpoint is rejected in staging. Leave the opt-in unset for ordinary preview builds.
- The preview does **not** call `getPublicAvailability`: the supplied deployed implementation reaches `getOfficialSheet()`, which writes optional header cells as part of the read path.
- The preview does **not** call `getScheduleConfig`: the supplied implementation may create the `Configuração da Agenda` sheet while reading.
- The blocked-date poll is also disabled because it delegates to `getPublicAvailability`.
- No fake appointments, service rows, customer records, prices, Pix data, or schedule availability should be used to fill gaps.

## Frontend actions and remaining verification

| Action | Purpose | Current handling |
| --- | --- | --- |
| `getServices` | Official service catalogue | Read request only; confirm response shape against deployed endpoint before enabling dependent booking flow. |
| `getPublicStudioAddress` | Public studio address | Read request only; display only configured values. |
| `getPublicPaymentConfig` | Official Pix/payment configuration | Read request only; booking remains disabled until verified. |
| `getPublicAvailability` | Occupied slots and blocked dates | Disabled in preview because the deployed read path may write sheet headers. |
| `getScheduleConfig` | Weekly schedule and schedule blocks | Disabled in preview because the deployed read path may create a sheet. |
| `createAdminSession` and authenticated admin actions | Admin session and management | Admin remains disabled. The supplied deployed authorization check appears to validate the configured `APPS_SCRIPT_TOKEN`, while the frontend expects a temporary session token; do not expose a long-lived token in browser code to work around this. |
| Booking, appointment, service, schedule, client, settings, photo, and messaging writes | Mutations | Disabled in preview; do not test against the official spreadsheet. |

## Next verification steps

1. Compare the deployed action responses with the frontend parsers using only endpoints confirmed to be side-effect-free.
2. Confirm the exact authorization contract before enabling any admin route.
3. Verify that the deployed availability and schedule-config read paths can be made side-effect-free before restoring those calls.
4. Test booking/deposit calculations and scheduling conflicts only in an isolated test environment, never by running the repository's live-sheet E2E action against the official spreadsheet.
5. Keep GitHub Pages deployment disabled until the owner approves the preview and cutover.
