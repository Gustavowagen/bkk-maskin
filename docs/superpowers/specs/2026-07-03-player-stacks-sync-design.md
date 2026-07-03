# Player Stacks Sync — Design

## Problem

The app currently has no shared state between visitors — it's a purely client-side, static-hosted tool. We want a lightweight external "database" that every visitor's upload updates, so that:

1. A running snapshot of every player's current nickname + chip count is kept up to date automatically whenever anyone uploads a context file.
2. Players whose chip count changed (or who are brand new) since the last upload are surfaced as "active."

## Non-goals

- No UI is added to *display* the Player stacks data back to users — this is a write-only sync from the frontend's perspective. (If reading it back into the UI is wanted later, that's a separate feature.)
- No authentication/shared-secret protection on the write endpoint — acceptable since this tool is only ever shared within a trusted small group.
- No history/log of past syncs — each sync fully replaces the roster and the active-players list.

## Architecture

```
Browser (Vite app)                     Google Apps Script Web App        Google Sheet
─────────────────                     ──────────────────────────        ────────────
handleFileUpload()
  → readExcelFile()
  → extractPlayerStacks(workbook)
      scans "Club Member Balance"
  → syncPlayerStacks(players)  ──POST──▶  doPost(e)
       (fire-and-forget,                    LockService.getScriptLock()
        text/plain body,                    read old A:B (Nickname/Chips)
        silent on success/failure)          diff old vs new → active list
                                             clear A2:C<lastRow>
                                             write new A:B, new C
                                          ◀── JSON ack ──               "Player stacks" tab
```

The diff (old vs. new snapshot) happens **server-side in Apps Script**, not in the browser. The frontend only ever sends the *complete new snapshot* it just parsed; Apps Script reads whatever is currently in the sheet, computes the diff, and overwrites. This avoids a race where two people uploading around the same time could otherwise clobber each other's diff base — the `LockService` lock plus doing the read-diff-write inside one request makes each sync atomic relative to other syncs.

## Data model: "Player stacks" sheet

A new tab, `Player stacks`, added to the same Google Sheet that `sheets_script.gs` is already bound to (via Extensions → Apps Script in that same sheet, adding a new `.gs` file or appending to the existing one — the `onEdit` trigger in `sheets_script.gs` is unaffected since Web App endpoints and `onEdit` triggers are independent).

Header row 1, three columns:

| Column | Header | Contents |
|---|---|---|
| A | `Nickname` | Row-aligned with B. Full roster from the most recent upload — players missing from the latest upload are dropped; new ones are added. |
| B | `Chips` | Row-aligned with A. The chip count from the most recent upload. |
| C | `Active players` | **Not** row-aligned with A/B. An independent stacked list (starting row 2) of nicknames that were new or had a changed chip value on this sync. Cleared and fully rewritten every sync — reflects only the latest upload's changes, no accumulated history. |

If the `Player stacks` tab doesn't exist yet, `doPost` creates it (with headers) on first write.

**Matching / diff rules:**
- Nicknames are matched case-insensitively (trimmed) between old and new snapshots; the casing stored is whatever the source file had.
- A player counts as "changed" if `Math.abs(newChips - oldChips) > 0.005` (epsilon guards against float round-trip noise; the source data already carries 2 decimal places).
- A brand-new nickname (not present in the old snapshot at all) is always counted as active.
- A nickname present in the old snapshot but absent from the new upload is simply not carried forward into the new A/B roster, and is not evaluated for "active" (there's nothing to compare).

## Extracting players from the upload

`Club Member Balance` (see `images/2026-07-03 20_54_15-...png` for the reference layout) has a fixed 5-row header block before data starts:

1. `Union Name : ...`
2. `Union ID : ...`
3. `Period : ...`
4. Merged category headers (Club / Super Agent / Agent / Member / Chips / Credits)
5. Sub-headers (ID / Club Name / ID / Nickname / ID / Nickname / Country / Role / ID / Nickname)
6. First real data row onward — one row per user.

Column K (index 10, zero-based) is the **Member** nickname; column L (index 11) is **Chips**. These are the same columns `filterWorkbookByNicknames` already reads, but that function only skips 3 rows and relies on user-typed nicknames never matching the literal header text "Nickname" via its `startsWith` prefix match — that trick doesn't generalize to "capture every row," so the new extractor skips the header block explicitly instead.

New function `extractPlayerStacks(workbook: XLSX.WorkBook): { nickname: string; chips: number }[]` in `excelUtils.ts`:
- Looks up the `Club Member Balance` sheet (same existence check/error as `filterWorkbookByNicknames`).
- `jsonData.slice(5)` to drop the header block.
- For each remaining row, reads column K (nickname) and L (chips).
- Skips a row if the nickname cell is empty, `-`, or literally `Nickname` (defensive guard against export-format drift).
- Every other row is included regardless of Role (Player/Agent/Manager/Super Agent all count — only the *Agent*/*Super Agent* columns are ignored, not agent-role member rows, per the source screenshot showing e.g. `Benjy10` and `Didrik Dromme` each having their own Member row).

## Frontend integration

- `syncPlayerStacks(players: {nickname: string; chips: number}[]): Promise<void>` in `excelUtils.ts`:
  - Reads the Web App URL from `import.meta.env.VITE_PLAYER_STACKS_URL`.
  - If unset, logs a console warning and no-ops (so the app still works without the env var configured, e.g. local dev).
  - POSTs `JSON.stringify({ players })` with `Content-Type: text/plain;charset=utf-8` (avoids a CORS preflight `OPTIONS` request, which Apps Script Web Apps don't handle).
  - Catches and `console.error`s any failure; never throws into the caller.
- `App.tsx` `handleFileUpload`: immediately after `readExcelFile` succeeds, calls `extractPlayerStacks(wb)` then fire-and-forget `syncPlayerStacks(...)`. Runs on every context-file upload, independent of the Filter/Download flow.
- The sync is entirely silent: no loading state, success message, or error message is shown in the UI, per explicit choice. Failures are visible only in the browser console.
- `.env.example` is added (committed) documenting `VITE_PLAYER_STACKS_URL`; the real value goes in `.env.local`, which this repo's `.gitignore` already excludes via its `*.local` pattern — no `.gitignore` change needed.

## Apps Script (`doPost`)

Added to the Google Sheet's Apps Script project (new file, e.g. `player_stacks_sync.gs`, alongside the existing `sheets_script.gs`):

- `doPost(e)`: parses `e.postData.contents` as `{ players: [{nickname, chips}, ...] }`.
- Acquires `LockService.getScriptLock()` (with a timeout) before reading/writing, releases in a `finally`.
- Gets or creates the `Player stacks` sheet; ensures header row.
- Reads existing A2:B<lastRow> into an old-snapshot map (lowercased nickname → chips).
- Computes new roster (as given) and active list per the diff rules above.
- Clears `A2:C<lastRow>` (old last row), then writes the new roster into A/B and the active list into C.
- Returns `ContentService.createTextOutput(JSON.stringify({ success: true, total: ..., active: ... })).setMimeType(ContentService.MimeType.JSON)`.
- Deployment: Deploy → New deployment → Web app, execute as "Me", access "Anyone" (no shared secret, per decision above). The resulting `/exec` URL is what goes into `VITE_PLAYER_STACKS_URL`.

## Error handling summary

| Failure | Behavior |
|---|---|
| `VITE_PLAYER_STACKS_URL` unset | Console warning, no-op — app works normally otherwise |
| Network error / Apps Script down | Caught, `console.error`'d, no UI change |
| `Club Member Balance` sheet missing on upload | Existing error path (already thrown by the extraction/filtering code) — unaffected by this feature |
| `Player stacks` tab missing | Apps Script creates it with headers on first write |
| Concurrent uploads from different users | Serialized via `LockService.getScriptLock()` in `doPost` |

## Testing approach

No automated test suite exists in this repo. Verification will be manual:
1. Deploy the Apps Script Web App, set `VITE_PLAYER_STACKS_URL` locally.
2. Upload a real Club Member Balance file; confirm `Player stacks` gets created with the correct full roster (spot-check a few nicknames/chip values against the source file, including at least one Agent/Manager/Super Agent-role row).
3. Manually edit a couple of chip values in the sheet (or upload a second file with different values) and re-upload; confirm `Active players` lists exactly the changed/new nicknames and the roster reflects the new full list (with any removed players gone).
