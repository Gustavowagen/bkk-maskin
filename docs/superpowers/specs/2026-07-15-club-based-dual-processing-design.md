# Club-Based Dual Processing (Knekt vs Stvg) — Design

## Problem

The app currently assumes every uploaded context file belongs to one club ("Knekt kortklubb") and always: looks up real names via the static `Knekt overview.xlsx` mapping, includes a `Name` column in the filtered/downloaded table, and syncs the roster to a single "Player stacks" Google Sheet.

A second club, "Stvg Kortklubb", now uploads files through the same app. Its process must differ in two ways:
1. No `Name` column in the filtered/downloaded table, and no name-lookup attempted at all (nicknames are never matched against any name file).
2. Its player-stacks roster/active-players sync goes to a **separate** Google Sheet document (its own spreadsheet, own Apps Script Web App deployment, own URL) — not a tab in the existing sheet.

Everything else (positive/negative Profit/Loss tables, transfer-table scaffold, styling, download flow) stays identical between the two clubs.

## Non-goals

- No manual override UI for club selection — detection is fully automatic from the uploaded file.
- No support for clubs beyond these two — any other/unrecognized club name is a hard error.
- No changes to the existing Knekt Player Stacks sheet/Apps Script beyond adding a `club` parameter to shared functions.
- No change to how the static `Knekt overview.xlsx` name file is loaded on mount — it's simply not *used* for Stvg uploads.

## Club detection

New function in `excelUtils.ts`:

```ts
export type Club = 'knekt' | 'stvg';

export const detectClub = (workbook: XLSX.WorkBook): Club => {
  const sheetName = 'Club Overview';
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in the uploaded file.`);
  }
  const data: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
  const raw = data[5]?.[3]; // row 6, column D
  const name = String(raw ?? '').trim().toLowerCase();

  if (name === 'knekt kortklubb') return 'knekt';
  if (name === 'stvg kortklubb') return 'stvg';
  throw new Error(`Unrecognized club "${String(raw ?? '')}" in Club Overview sheet.`);
};
```

- Fixed cell: row 6 (index 5), column D (index 3) of `Club Overview` — matches the reference layout (`images/sepparator.png`), same 5-row header block pattern as `Club Member Balance`.
- Comparison is trimmed + case-insensitive.
- Any other value (typo, blank, different club) throws — caller must block processing on this error.

## Frontend integration (`App.tsx`)

`handleFileUpload`:
1. `readExcelFile` → `wb`.
2. `detectClub(wb)` — wrapped in the existing try/catch. On throw: `alert(error.message)`, do not set `workbook`/`club` state (upload is rejected, same as today's "invalid Excel file" path).
3. On success: `setClub(result)` (new `club: Club | null` state, reset to `null` on new upload alongside `file`/`workbook`/`isFiltered`).
4. Render a small label near the upload once `club` is set: `Detected club: Knekt Kortklubb` / `Detected club: Stvg Kortklubb`.
5. Player-stacks extraction/sync (unchanged trigger point) now calls `syncPlayerStacks(players, club)`.

`handleFilter`: passes `club` through to `filterWorkbookByNicknames(workbook, nicknames, nameMapping, club)`. Guard: if `club` is null (shouldn't happen once a file is loaded), bail out same as the existing `if (!workbook) return`.

## Table changes (`filterWorkbookByNicknames`)

Signature becomes:

```ts
filterWorkbookByNicknames(
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[],
  nameMapping: Map<string, string>,
  club: Club
): XLSX.WorkBook
```

Inside the per-row loop, branch on `club`:

- **`knekt`** (current behavior, unchanged): look up `realName` via `nameMapping`, build the 11-column `rowData` `[nickname, realName, lineAmount, chips, hasLine, profitLoss, '', '', '', '', '']`, headers include `Name`.
- **`stvg`**: skip `nameMapping.get(...)` entirely (no lookup attempted, matching the requirement to not search any document for names), build the 10-column `rowData` `[nickname, lineAmount, chips, hasLine, profitLoss, '', '', '', '', '']`, headers omit `Name`:
  - Positive: `['Nickname', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Claima chips', 'satt opp']`
  - Negative: same with `'Gitt chips'` in place of `'Claima chips'`
- Sort key index shifts from `a[5]`/`b[5]` (knekt) to `a[4]`/`b[4]` (stvg) since `profitLoss` moves one column left.

The transfer-table scaffold (headers, empty rows, 3-table horizontal layout) is appended identically regardless of `club` — it lives on separate rows below the main table and doesn't reference the main table's column count.

## Download styling (`downloadExcelFile`)

Currently hardcodes `const mainTableColumnCount = 11;`. Change to derive it from the actual data instead of a constant:

```ts
const mainTableColumnCount = data[0]?.length ?? 11;
```

`data[0]` is the first row of the sheet being rendered (the positive-table header row), which is naturally 11 columns for Knekt and 10 for Stvg. This keeps `downloadExcelFile` club-agnostic — no `club` parameter needed there at all. Border/bold/fill logic for the main table and the "beyond main table" cleanup both key off this same derived value, so both column widths are handled correctly with no other changes to this function.

## Player stacks sync routing

`syncPlayerStacks(players: PlayerStack[], club: Club): Promise<void>`:

```ts
const url = club === 'stvg'
  ? (import.meta.env.VITE_PLAYER_STACKS_URL_STVG as string | undefined)
  : (import.meta.env.VITE_PLAYER_STACKS_URL as string | undefined);
```

- Same silent fire-and-forget behavior (console warning if unset, `console.error` on failure, never throws).
- `.env.example` gets a new line: `VITE_PLAYER_STACKS_URL_STVG=`.
- Existing `VITE_PLAYER_STACKS_URL` (Knekt) is untouched — no migration needed for the current `.env.local`.

`extractPlayerStacks` is unchanged — it already only extracts nickname+chips, never Name, so it's naturally club-agnostic.

## New Apps Script for the Stvg spreadsheet

New file `player_stacks_sync_stvg.gs`, content-identical to `player_stacks_sync.gs` (same `doPost`, `getOrCreatePlayerStacksSheet_`, `readOldSnapshot_`, `computeActivePlayers_`, `writeSnapshot_`, same `Player stacks` tab name and A/B/C(blank)/D layout) — it must physically live in the new, separate Google Sheet's own Apps Script project since Apps Script is spreadsheet-bound. Only the top-of-file install comment changes to reference the Stvg sheet instead of the Knekt one.

Setup steps (for the user, not the app):
1. Create the new Stvg Google Sheet.
2. Extensions → Apps Script → paste `player_stacks_sync_stvg.gs`.
3. Deploy → New deployment → Web app → execute as "Me", access "Anyone".
4. Copy the `/exec` URL into `VITE_PLAYER_STACKS_URL_STVG` in `.env.local`.
5. Optionally also install `sheets_script.gs` (onEdit Profit/Loss recalc) in the new sheet if the same auto-recalc convenience is wanted there — unmodified, since it's generic over header names, not required by the app itself.

## Error handling summary

| Failure | Behavior |
|---|---|
| `Club Overview` sheet missing | `detectClub` throws; upload rejected via `alert()`, same pattern as existing file-read errors |
| Club name unrecognized (typo/blank/other club) | `detectClub` throws with the offending value in the message; upload rejected |
| `VITE_PLAYER_STACKS_URL_STVG` unset (Stvg upload) | Console warning, no-op — matches existing Knekt behavior for its own unset var |
| Network error / Apps Script down (either club) | Caught, `console.error`'d, no UI change |
| `Player stacks` tab missing in new Stvg sheet | Apps Script creates it with headers on first write (same as Knekt) |

## Testing approach

No automated test suite exists in this repo. Manual verification:
1. Upload a Knekt file — confirm `Detected club: Knekt Kortklubb` label, filtered table still has the `Name` column populated correctly, existing `VITE_PLAYER_STACKS_URL` sheet still updates as before.
2. Upload a Stvg file — confirm `Detected club: Stvg Kortklubb` label, filtered/downloaded table has no `Name` column (10 columns, correct headers/borders/bold), and no name-lookup was attempted (spot-check by temporarily breaking the name mapping and confirming Stvg output is unaffected).
3. Deploy `player_stacks_sync_stvg.gs` to a new spreadsheet, set `VITE_PLAYER_STACKS_URL_STVG`, confirm the Stvg roster/active-players land there and the Knekt sheet is untouched by a Stvg upload (and vice versa).
4. Upload a file with an unrecognized/blank club name — confirm the app blocks with an error and does not proceed to nickname entry/filtering.
