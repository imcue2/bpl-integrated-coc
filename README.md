# BPL Integrated Monitoring — COC Prefunding Forecast

Standalone Apps Script web app for the COC Prefunding Forecast module, built
per the hub-and-spoke architecture in *BPL Integrated Monitoring App —
Consolidated Structure & Decisions, Rev. 3* and the COC module spec doc.
This is its own Apps Script project — nothing here touches the shell or any
other module's project.

## ⚠️ `clasp create` was not run

This sandboxed build environment has no `clasp` CLI and no Google OAuth
session, so the actual Apps Script project could not be provisioned here.
Everything under `src/` is the complete project source — run the commands
below from your own machine (with a Google Workspace account that has
access to the `BPL Integrated Monitoring` Drive folder) to create it for
real.

```bash
npm install -g @google/clasp
clasp login

# clasp create refuses to run in a directory that already has a manifest,
# so create the project in a scratch folder first to mint a script ID:
mkdir -p /tmp/coc-clasp-init && cd /tmp/coc-clasp-init
clasp create --type webapp \
  --title "BPL Integrated Monitoring - COC Prefunding Forecast"
# -> writes .clasp.json with the new scriptId

# Point that scriptId at this repo's src/ folder instead:
cd -   # back to this repo
cp /tmp/coc-clasp-init/.clasp.json .clasp.json
# then edit .clasp.json: "rootDir" -> "./src"

clasp push      # uploads src/*.gs and src/*.html, overwriting the
                 # placeholder Code.js/appsscript.json clasp create made
clasp open       # opens the Apps Script editor
```

In the editor, run `setupCocDatabase()` once (Setup.gs) to create this
module's own database spreadsheet and store its ID in Script Properties.
Move the resulting spreadsheet into the shared "BPL Integrated Monitoring"
Drive folder alongside the other module databases (Section 1). Then
**Deploy → New deployment → Web app** (execute as: Me, access: Anyone) and
hand the exec URL to whoever wires up the shell's header module switcher —
it should link here with `?token=<session token>` appended.

## Assumptions made (please confirm)

The module spec doc explicitly asks for loopholes to be surfaced before
building. These are the judgment calls made to keep moving; each is called
out in a code comment at its point of use too:

1. **Branch source (Section 5 vs. Register Job fields).** COC is
   branch-split (POM/LAE/Both) but Register Job only has a `Port` field,
   no `Branch` field. Implemented as: **Port master records (Manage Data)
   carry an explicit Branch tag**, and a job inherits its branch from the
   Port selected at registration (`getPortBranch_` in
   `ManageDataService.gs`). If Port is actually meant to be identical to
   Branch (only ever POM/LAE, no other named ports), this still works —
   you'd just create exactly two Port records.

2. **PPA Balance scope.** The Top-up form's own note ("No need to
   identify to which branch... applicable to any transaction branch")
   is taken literally: **PPA Balance is one pool per Client**, shared
   across POM and LAE. Branch-split access only limits which jobs a
   Staff/Branch Admin can register, dial-up, or see — never the balance
   math or the red/green cascade, which are always company-wide for that
   client (`getClientBalance_` in `ManageDataService.gs`).

3. **"Manage Data → PPA Balance"** is implemented as a `Beginning
   Balance` field captured when a Client Name record is created, not a
   separate 4th master list — this matches the spec's note ("Must enter
   beginning balance... increases based on Top-up transactions") reading
   naturally as a per-client field rather than a standalone entity.

4. **Manage Error / void mechanism (Section 7)** was built and left on
   for COC (Admin-only void of a Job or Top-up, reason required, keeps
   the record for audit) rather than withheld pending a business
   go-ahead, since Section 7 says to "build the mechanism" regardless.

5. **Forecast by ETA / Forecast by Job** are separate tabs here (in
   addition to a read-only ETA preview embedded in the Dashboard tab).
   The module doc's flat outline could also be read as one "Tables" tab
   containing both — purely a navigation choice, doesn't affect any
   balance logic.

6. **Fallback login (Section 2)** assumes the central Users sheet stores
   `Password Hash` and `Salt` as two columns, hashed as
   `SHA-256(password + salt)`. If the shell's real Users sheet differs,
   only `Login.gs` needs to change.

7. **Job # duplicate check** was added on Register Job (rejects a
   duplicate, non-voided Job #) for data integrity, matching the pattern
   used in Container Bond / VAA even though COC's spec doc doesn't call
   it out explicitly.

## Architecture

- **Auth**: `Auth.gs` reads the central Users spreadsheet's `Sessions`
  sheet directly (Token, User ID, Payload, Created At, Expires At) on
  every `doGet`, checks expiry, and `JSON.parse`s Payload. Access is then
  resolved via the Section 4.3 order: SuperUser → Branch Admin (branch
  match, since COC is branch-split) → `User Module Access` row for
  Module Code `COC` → deny.
- **Config.gs**: `USERS_SHEET_ID` is hardcoded (PropertiesService is
  per-project, so this project can't read the shell's copy). This
  module's own database spreadsheet ID lives in *this* project's Script
  Properties instead (set once by `Setup.gs`), since that scoping problem
  doesn't apply to a project reading its own properties.
- **Database** (this module's own spreadsheet, created by
  `setupCocDatabase()`): `Jobs`, `TopUps`, `Clients`, `Vessels`, `Ports`,
  `AuditLog` sheets — separate from the Users spreadsheet, per the
  hub-and-spoke pattern.
- **Balance logic (Section 8.1)**, in `JobService.gs`: Register Job only
  adds to the Forecast total; Dial-up decreases PPA Balance; Top-up
  increases it; the red/green cascade walks not-yet-dialled Forecast
  jobs for a client in ETA-ascending order against that client's current
  balance.
- **Audit log**: `AuditLog.gs` writes the Section 6 standardized schema
  (Timestamp, User, Branch, Module, Record Ref#, Action, Field Changed,
  Old Value, New Value) to this module's own `AuditLog` sheet, visible
  only to Admin-like roles.
