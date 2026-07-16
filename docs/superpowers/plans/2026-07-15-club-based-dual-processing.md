# Club-Based Dual Processing (Knekt vs Stvg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect which club ("Knekt Kortklubb" or "Stvg Kortklubb") an uploaded context file belongs to, and route processing accordingly: Stvg drops the `Name` column and any name lookup, and syncs its player-stacks roster to a separate Google Sheet via its own Apps Script Web App.

**Architecture:** A new `detectClub` function reads a fixed cell in the `Club Overview` sheet and returns `'knekt' | 'stvg'` (or throws for anything else). That value threads through the existing pipeline as a `club` parameter: `filterWorkbookByNicknames` branches on it to include/omit the `Name` column, `downloadExcelFile` is made club-agnostic by deriving its column count from the data instead of a hardcoded constant, and `syncPlayerStacks` picks between two env-var-configured URLs. `App.tsx` calls `detectClub` right after reading the file, stores the result in state, shows it to the user, and passes it through to every downstream call. A new Apps Script file (content-identical to the existing one) is added for the separate Stvg spreadsheet.

**Tech Stack:** React + TypeScript (Vite), `xlsx` (SheetJS) for parsing, `exceljs` for the download, Google Apps Script for the two "Player stacks" backends. No test runner is configured in this repo (`npm run build` type-checks via `tsc -b`; there is no `npm test`) — verification in this plan uses `npm run build`/`npm run lint` after each code task, plus a final manual browser run.

---

### Task 1: Add the `Club` type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the `Club` type**

Add this to `src/types/index.ts` (after the existing `NicknameWithLine` interface, before `PlayerStack`):

```ts
export type Club = 'knekt' | 'stvg';
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds with no errors (this is an additive, unused-so-far export — `tsc` won't complain about an unused exported type).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add Club type for club-based dual processing"
```

---

### Task 2: Add `detectClub` to `excelUtils.ts`

**Files:**
- Modify: `src/utils/excelUtils.ts`

- [ ] **Step 1: Add the import and function**

In `src/utils/excelUtils.ts`, change the type import line (currently `import type { NicknameWithLine, PlayerStack } from '../types';`) to:

```ts
import type { NicknameWithLine, PlayerStack, Club } from '../types';
```

Then add this new function directly after `readNameFile` (before the `filterWorkbookByNicknames` doc comment):

```ts
/**
 * Detect which club an uploaded context file belongs to, by reading a
 * fixed cell in the "Club Overview" sheet: row 6, column D, directly
 * under the "Club Name" sub-header (see images/sepparator.png for the
 * reference layout — same 5-row header block pattern as "Club Member
 * Balance").
 */
export const detectClub = (workbook: XLSX.WorkBook): Club => {
  const sheetName = 'Club Overview';

  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in the uploaded file.`);
  }

  const worksheet = workbook.Sheets[sheetName];
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  const raw = data[5]?.[3];
  const name = String(raw ?? '').trim().toLowerCase();

  if (name === 'knekt kortklubb') return 'knekt';
  if (name === 'stvg kortklubb') return 'stvg';

  throw new Error(`Unrecognized club "${String(raw ?? '')}" in Club Overview sheet.`);
};
```

- [ ] **Step 2: Type-check and lint**

Run: `npm run build`
Expected: succeeds with no errors.

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/excelUtils.ts
git commit -m "Add detectClub for reading club name from Club Overview sheet"
```

---

### Task 3: Branch `filterWorkbookByNicknames` on `club`

**Files:**
- Modify: `src/utils/excelUtils.ts`

- [ ] **Step 1: Replace the function**

Replace the entire existing `filterWorkbookByNicknames` function (from its doc comment through its closing `};`) with:

```ts
/**
 * Filter Excel workbook based on nicknames
 * - Only processes the "Club Member Balance" sheet
 * - Removes first 3 rows
 * - Keeps only columns K and L
 * - Filters rows where column K starts with any of the provided nicknames (case-insensitive prefix match)
 * - For club 'knekt': adds "Name" column with real name from nameMapping
 * - For club 'stvg': omits the "Name" column entirely and never looks up nameMapping
 * - Adds "Has Line" column (Yes/No)
 * - Adds "Profit/Loss" column (L - line if line exists, otherwise just L)
 */
export const filterWorkbookByNicknames = (
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[],
  nameMapping: Map<string, string>,
  club: Club
): XLSX.WorkBook => {
  const newWorkbook = XLSX.utils.book_new();
  const targetSheetName = 'Club Member Balance';

  // Check if the target sheet exists
  if (!workbook.SheetNames.includes(targetSheetName)) {
    throw new Error(`Sheet "${targetSheetName}" not found in the uploaded file.`);
  }

  const worksheet = workbook.Sheets[targetSheetName];

  // Convert sheet to JSON for easier processing
  const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: ''
  });

  // If no nicknames provided, return empty workbook
  if (nicknames.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(newWorkbook, emptySheet, targetSheetName);
    return newWorkbook;
  }

  // Remove first 3 rows
  const dataWithoutFirstThreeRows = jsonData.slice(3);

  // Filter and keep only columns K (index 10) and L (index 11), plus add new columns
  const positiveData: any[][] = [];
  const negativeData: any[][] = [];

  // Profit/Loss lives one column earlier for Stvg since the Name column is omitted.
  const profitLossIndex = club === 'stvg' ? 4 : 5;

  dataWithoutFirstThreeRows.forEach((row) => {
    const columnK = row[10] ? String(row[10]).toLowerCase() : '';
    const columnL = row[11] !== undefined ? row[11] : 0;

    // Check if any nickname matches the start of column K (case-insensitive)
    const matchingNickname = nicknames.find(nicknameObj =>
      columnK.startsWith(nicknameObj.nickname.toLowerCase())
    );

    if (matchingNickname) {
      const hasLine = matchingNickname.line !== undefined;
      const hasLineValue = hasLine ? 'Yes' : 'No';
      const lineAmount = matchingNickname.line !== undefined ? matchingNickname.line : '';

      // Calculate profit/loss
      let profitLoss: number;
      if (hasLine && matchingNickname.line !== undefined) {
        profitLoss = Number(columnL) - matchingNickname.line;
      } else {
        profitLoss = Number(columnL);
      }

      // Round down to integer (floor for positive, ceil for negative to round towards zero)
      profitLoss = profitLoss >= 0 ? Math.floor(profitLoss) : Math.ceil(profitLoss);

      let rowData: any[];
      if (club === 'stvg') {
        rowData = [row[10], lineAmount, columnL, hasLineValue, profitLoss, '', '', '', '', ''];
      } else {
        // The actual nickname from the Excel file (column K)
        const actualNickname = String(row[10]);

        // Get real name from mapping (case-insensitive lookup)
        // Try both the actual nickname from Excel and the user-entered nickname
        const realName = nameMapping.get(actualNickname.toLowerCase()) ||
                         nameMapping.get(matchingNickname.nickname.toLowerCase()) || '';

        rowData = [row[10], realName, lineAmount, columnL, hasLineValue, profitLoss, '', '', '', '', ''];
      }

      // Split into positive and negative arrays
      if (profitLoss >= 0) {
        positiveData.push(rowData);
      } else {
        negativeData.push(rowData);
      }
    }
  });

  // Sort both arrays by profit/loss (highest first)
  positiveData.sort((a, b) => b[profitLossIndex] - a[profitLossIndex]);
  negativeData.sort((a, b) => b[profitLossIndex] - a[profitLossIndex]);

  // Add headers for main tables
  const positiveHeaders = club === 'stvg'
    ? ['Nickname', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Claima chips', 'satt opp']
    : ['Nickname', 'Name', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Claima chips', 'satt opp'];
  const negativeHeaders = club === 'stvg'
    ? ['Nickname', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Gitt chips', 'satt opp']
    : ['Nickname', 'Name', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Gitt chips', 'satt opp'];

  // Create the transfer table headers and empty rows
  const transferTableHeaders = ['Avsender', 'sum', 'Mottaker', 'bekreftet', 'purra'];
  const emptyTransferRows = Array(10).fill(['', '', '', '', '']); // 10 empty rows for user input

  // Create horizontal arrangement of 3 transfer tables with 3 empty cells between each
  const transferTableHeader = [
    ...transferTableHeaders,
    '', '', '', // 3 empty cells
    ...transferTableHeaders,
    '', '', '', // 3 empty cells
    ...transferTableHeaders
  ];

  const transferTableRows = emptyTransferRows.map(() => [
    '', '', '', '', '', // First table columns
    '', '', '', // 3 empty cells
    '', '', '', '', '', // Second table columns
    '', '', '', // 3 empty cells
    '', '', '', '', ''  // Third table columns
  ]);

  // Combine data with headers and spacing - 10 empty rows before transfer table
  const combinedData = [
    positiveHeaders,
    ...positiveData,
    [], // Empty row for spacing
    [], // Empty row for spacing
    negativeHeaders,
    ...negativeData,
    [], // Empty row 1
    [], // Empty row 2
    [], // Empty row 3
    [], // Empty row 4
    [], // Empty row 5
    [], // Empty row 6
    [], // Empty row 7
    [], // Empty row 8
    [], // Empty row 9
    [], // Empty row 10
    transferTableHeader,
    ...transferTableRows
  ];

  // Create new worksheet from filtered data
  const newWorksheet = XLSX.utils.aoa_to_sheet(combinedData);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, targetSheetName);

  return newWorkbook;
};
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: fails at this point with an error in `src/App.tsx` — the existing call site `filterWorkbookByNicknames(workbook, nicknames, nameMapping)` is now missing the required `club` argument. This is expected; Task 6 fixes the call site. Confirm the error specifically names `filterWorkbookByNicknames` and `club` — if the error is about anything else in `excelUtils.ts`, stop and re-check the pasted code against the original file.

- [ ] **Step 3: Commit**

```bash
git add src/utils/excelUtils.ts
git commit -m "Branch filterWorkbookByNicknames on club to drop Name column for Stvg"
```

(A red build between commits is fine here — Task 6 lands in the same work session and fixes it. If you're pausing work between tasks, skip ahead to Task 6 before leaving the branch in a broken state.)

---

### Task 4: Make `downloadExcelFile` take `club` and compute column count from it

> **Revised during implementation:** the original plan for this task derived `mainTableColumnCount` from `data[0]?.length`, assuming that would naturally be 11 or 10 depending on club. That assumption is wrong: `XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })` pads every row out to the sheet's overall column range, which is always 21 (driven by the transfer table header that's present regardless of club) — confirmed empirically with a standalone script reproducing the exact worksheet construction. `data[0].length` is therefore always 21 for both clubs, never 10 or 11, so the original approach silently produced wrong border/styling behavior for both clubs instead of differentiating them. The corrected approach below passes `club` into `downloadExcelFile` explicitly instead.

**Files:**
- Modify: `src/utils/excelUtils.ts`

- [ ] **Step 1: Change the function signature and compute column count from `club`**

Change the `downloadExcelFile` signature from:

```ts
export const downloadExcelFile = async (workbook: XLSX.WorkBook, filename: string): Promise<void> => {
```

to:

```ts
export const downloadExcelFile = async (workbook: XLSX.WorkBook, filename: string, club: Club): Promise<void> => {
```

Then find this line (inside the `data.forEach((row, rowIndex) => { ... })` callback):

```ts
    // Main table has 11 columns, transfer table has 5 columns per table (3 tables with 3 empty cells between = 23 columns total)
    const mainTableColumnCount = 11;
```

Delete it from inside the callback, and instead add this once, above the `data.forEach((row, rowIndex) => {` line (it's loop-invariant — no need to recompute it per row):

```ts
  // Main table column count varies by club (11 for Knekt with Name, 10 for Stvg without).
  // Can't be derived from the sheet data itself: sheet_to_json pads every row out to the
  // sheet's overall column range (21, from the always-present transfer table header), so
  // data[0].length is always 21 regardless of club — the actual count must come from the
  // caller, which already knows it (filterWorkbookByNicknames branches on the same club).
  const mainTableColumnCount = club === 'stvg' ? 10 : 11;
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: two errors now — the same pre-existing `club` argument error from Task 3's call site (`filterWorkbookByNicknames`), plus a new one for `downloadExcelFile`'s call site in `App.tsx` (`handleDownload`) now missing its 3rd argument. Confirm both errors are exactly these two missing-argument cases in `App.tsx`, nothing else. Task 6 fixes both call sites.

- [ ] **Step 3: Commit**

```bash
git add src/utils/excelUtils.ts
git commit -m "Pass club into downloadExcelFile to compute main table column count"
```

---

### Task 5: Route `syncPlayerStacks` by club

**Files:**
- Modify: `src/utils/excelUtils.ts`

- [ ] **Step 1: Update the function**

Replace the existing `syncPlayerStacks` function with:

```ts
/**
 * Fire-and-forget sync of the latest player roster to the external
 * "Player stacks" Google Sheet via an Apps Script Web App endpoint.
 * Knekt and Stvg sync to two separate spreadsheets/deployments, selected
 * by `club`. Silent by design: no UI feedback is shown on success or
 * failure, per the approved player-stacks-sync design doc.
 */
export const syncPlayerStacks = async (players: PlayerStack[], club: Club): Promise<void> => {
  const envVarName = club === 'stvg' ? 'VITE_PLAYER_STACKS_URL_STVG' : 'VITE_PLAYER_STACKS_URL';
  const url = club === 'stvg'
    ? (import.meta.env.VITE_PLAYER_STACKS_URL_STVG as string | undefined)
    : (import.meta.env.VITE_PLAYER_STACKS_URL as string | undefined);

  if (!url) {
    console.warn(`${envVarName} is not set; skipping player stacks sync.`);
    return;
  }

  try {
    // no-cors: Apps Script Web App responses don't send an
    // Access-Control-Allow-Origin header, so a normal cross-origin fetch()
    // gets blocked even though the request executes successfully server-side.
    // We never read the response (silent sync by design), so an opaque
    // no-cors response is fine. text/plain avoids a CORS preflight OPTIONS
    // request; the body is still JSON, which Apps Script parses from
    // e.postData.contents regardless of the declared content type.
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ players })
    });
  } catch (error) {
    console.error('Error syncing player stacks:', error);
  }
};
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: same pre-existing `club` argument errors from `App.tsx` (now also for `syncPlayerStacks`'s missing second argument) — no new *categories* of error.

- [ ] **Step 3: Commit**

```bash
git add src/utils/excelUtils.ts
git commit -m "Route syncPlayerStacks to a club-specific Player Stacks URL"
```

---

### Task 6: Wire `club` through `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

Change:

```ts
import { readExcelFile, readNameFile, filterWorkbookByNicknames, downloadExcelFile, extractPlayerStacks, syncPlayerStacks } from './utils/excelUtils'
import type { NicknameWithLine } from './types'
```

to:

```ts
import { readExcelFile, readNameFile, filterWorkbookByNicknames, downloadExcelFile, extractPlayerStacks, syncPlayerStacks, detectClub } from './utils/excelUtils'
import type { NicknameWithLine, Club } from './types'
```

- [ ] **Step 2: Add `club` state**

After the existing `const [nicknames, setNicknames] = useState<NicknameWithLine[]>([])` line, add:

```ts
  const [club, setClub] = useState<Club | null>(null)
```

- [ ] **Step 3: Update `handleFileUpload`**

Replace the entire `handleFileUpload` function with:

```ts
  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)
    setClub(null)

    try {
      const wb = await readExcelFile(uploadedFile)
      const detectedClub = detectClub(wb)
      setWorkbook(wb)
      setClub(detectedClub)

      // Silent, best-effort sync — must never block the upload flow above.
      try {
        const players = extractPlayerStacks(wb)
        syncPlayerStacks(players, detectedClub)
      } catch (error) {
        console.error('Error extracting player stacks:', error)
      }
    } catch (error) {
      console.error('Error reading file:', error)
      alert(error instanceof Error ? error.message : 'Error reading Excel file. Please make sure it is a valid Excel file.')
    }
  }
```

- [ ] **Step 4: Update `handleFilter`**

Replace:

```ts
  const handleFilter = () => {
    if (!workbook) return
    
    setIsProcessing(true)
    
    try {
      // Apply filtering logic with name mapping
      const filtered = filterWorkbookByNicknames(workbook, nicknames, nameMapping)
      setFilteredWorkbook(filtered)
      setIsFiltered(true)
    } catch (error) {
      console.error('Error filtering file:', error)
      alert('Error filtering file. Please check the file format.')
    } finally {
      setIsProcessing(false)
    }
  }
```

with:

```ts
  const handleFilter = () => {
    if (!workbook || !club) return
    
    setIsProcessing(true)
    
    try {
      // Apply filtering logic with name mapping
      const filtered = filterWorkbookByNicknames(workbook, nicknames, nameMapping, club)
      setFilteredWorkbook(filtered)
      setIsFiltered(true)
    } catch (error) {
      console.error('Error filtering file:', error)
      alert('Error filtering file. Please check the file format.')
    } finally {
      setIsProcessing(false)
    }
  }
```

- [ ] **Step 5: Update `handleDownload`**

Replace:

```ts
  const handleDownload = async () => {
    if (!filteredWorkbook) return
    
    const originalName = file?.name.replace(/\.xlsx?$/i, '') || 'filtered'
    await downloadExcelFile(filteredWorkbook, `${originalName}_filtered.xlsx`)
  }
```

with:

```ts
  const handleDownload = async () => {
    if (!filteredWorkbook || !club) return
    
    const originalName = file?.name.replace(/\.xlsx?$/i, '') || 'filtered'
    await downloadExcelFile(filteredWorkbook, `${originalName}_filtered.xlsx`, club)
  }
```

(This is needed because Task 4 changed `downloadExcelFile`'s signature to require `club` as a 3rd argument, to correctly compute the main table's column count per club.)

- [ ] **Step 6: Add the detected-club label**

In the JSX, directly after the `<FileUpload ... />` block and before `{file && !isFiltered && (`, add:

```tsx
        {club && (
          <p className="info-message">
            Detected club: {club === 'stvg' ? 'Stvg Kortklubb' : 'Knekt Kortklubb'}
          </p>
        )}
```

So that section of the JSX reads:

```tsx
        <FileUpload 
          file={file} 
          onFileUpload={handleFileUpload} 
          label="Choose Context File"
          id="context-file"
        />

        {club && (
          <p className="info-message">
            Detected club: {club === 'stvg' ? 'Stvg Kortklubb' : 'Knekt Kortklubb'}
          </p>
        )}

        {file && !isFiltered && (
```

- [ ] **Step 7: Type-check and lint**

Run: `npm run build`
Expected: succeeds with no errors — this closes out the `club` argument errors from Tasks 3-5 (both `filterWorkbookByNicknames` and `downloadExcelFile`).

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "Detect club on upload and thread it through filter/download/sync"
```

---

### Task 7: Document the new env var

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create the file**

Create `.env.example` (repo root, alongside `package.json`) with:

```
# Google Apps Script Web App URL for the Knekt Kortklubb "Player stacks" sync.
VITE_PLAYER_STACKS_URL=

# Google Apps Script Web App URL for the Stvg Kortklubb "Player stacks" sync
# (a separate Google Sheet/deployment from the Knekt one above).
VITE_PLAYER_STACKS_URL_STVG=
```

- [ ] **Step 2: Verify it's not ignored**

Run: `git check-ignore -v .env.example`
Expected: no output (exit code 1) — confirms `.env.example` isn't caught by the repo's `.gitignore` (which excludes `*.local`, not this file).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "Document VITE_PLAYER_STACKS_URL_STVG in .env.example"
```

---

### Task 8: Add the Apps Script for the Stvg spreadsheet

**Files:**
- Create: `player_stacks_sync_stvg.gs`

- [ ] **Step 1: Create the file**

Create `player_stacks_sync_stvg.gs` (repo root, alongside the existing `player_stacks_sync.gs`) with:

```
/**
 * Syncs the "Player stacks" tab for Stvg Kortklubb, from uploads made in
 * the poker summarizer frontend (vite_summarizer) where the uploaded
 * file's Club Overview sheet identifies the club as "Stvg Kortklubb".
 * See docs/superpowers/specs/2026-07-15-club-based-dual-processing-design.md
 * in that repo for the full design.
 *
 * This must be installed in the SEPARATE Stvg "Player stacks" Google
 * Sheet (not the Knekt one that player_stacks_sync.gs is bound to) —
 * Apps Script projects are bound to a single spreadsheet.
 *
 * Install: In the Stvg Google Sheet, open Extensions → Apps Script →
 * File → New → Script, name it "player_stacks_sync_stvg" → paste this
 * in → Save (Ctrl+S).
 *
 * Deploy: Deploy → New deployment → gear icon → type "Web app" →
 * execute as "Me", who has access "Anyone" → Deploy. Copy the resulting
 * .../exec URL into VITE_PLAYER_STACKS_URL_STVG (see .env.example in
 * the vite_summarizer repo).
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = JSON.parse(e.postData.contents);
    const newPlayers = payload.players || [];

    const sheet = getOrCreatePlayerStacksSheet_();
    const oldSnapshot = readOldSnapshot_(sheet);
    const activePlayers = computeActivePlayers_(oldSnapshot, newPlayers);

    writeSnapshot_(sheet, newPlayers, activePlayers);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        total: newPlayers.length,
        active: activePlayers.length
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getOrCreatePlayerStacksSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Player stacks');

  if (!sheet) {
    sheet = ss.insertSheet('Player stacks');
    // Column C is a deliberate blank spacer between Chips and Active players.
    sheet.getRange(1, 1, 1, 4).setValues([['Nickname', 'Chips', '', 'Active players']]);
  }

  return sheet;
}

// Returns { [lowercasedNickname]: chips }
function readOldSnapshot_(sheet) {
  const lastRow = sheet.getLastRow();
  const snapshot = {};

  if (lastRow < 2) return snapshot;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  values.forEach((row) => {
    const nickname = String(row[0] || '').trim();
    const chips = Number(row[1]);
    if (nickname && !isNaN(chips)) {
      snapshot[nickname.toLowerCase()] = chips;
    }
  });

  return snapshot;
}

// A player is "active" if they're brand new or their chips changed by more
// than a tiny float-noise epsilon since the last sync.
function computeActivePlayers_(oldSnapshot, newPlayers) {
  const active = [];

  newPlayers.forEach((player) => {
    const key = String(player.nickname || '').trim().toLowerCase();
    if (!key) return;

    const oldChips = oldSnapshot[key];
    const newChips = Number(player.chips);

    if (oldChips === undefined || Math.abs(newChips - oldChips) > 0.005) {
      active.push(player.nickname);
    }
  });

  return active;
}

// Full replace: clears A2:D down to the old last row, then writes the new
// roster into A/B and the active list into D (column C stays blank as a
// spacer). Players missing from newPlayers are simply not written back,
// which is how they're "removed".
function writeSnapshot_(sheet, newPlayers, activePlayers) {
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }

  if (newPlayers.length > 0) {
    const rosterRows = newPlayers.map((p) => [p.nickname, Number(p.chips)]);
    sheet.getRange(2, 1, rosterRows.length, 2).setValues(rosterRows);
  }

  if (activePlayers.length > 0) {
    const activeRows = activePlayers.map((n) => [n]);
    sheet.getRange(2, 4, activeRows.length, 1).setValues(activeRows);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add player_stacks_sync_stvg.gs
git commit -m "Add Apps Script for the separate Stvg Player Stacks spreadsheet"
```

---

### Task 9: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check and lint**

Run: `npm run build`
Expected: succeeds with no errors (this also runs `tsc -b`, so it will catch any remaining type mismatch across all the files touched above).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Manual browser check — Knekt regression**

Run: `npm run dev`, open `http://localhost:5173`.

Upload a real Knekt Kortklubb context file (one with a `Club Overview` sheet whose row 6/column D reads "Knekt kortklubb", matching the reference screenshot). Confirm:
- The label "Detected club: Knekt Kortklubb" appears after upload.
- Entering nicknames and clicking Filter, then Download, produces a file whose main table still has all 11 columns including `Name`, populated the same as before this change.

- [ ] **Step 3: Manual browser check — unrecognized club**

With the dev server still running, upload a workbook whose `Club Overview` sheet has a club name other than the two recognized ones (or edit a copy of the test file to change that cell to something else, e.g. "Test Club"). Confirm:
- An alert appears with a message like `Unrecognized club "Test Club" in Club Overview sheet.`
- No "Players to Include" section or Filter button appears — the app does not proceed past the rejected upload.

- [ ] **Step 4: Manual browser check — Stvg path (once a real Stvg file is available)**

This step requires an actual Stvg Kortklubb export file, which may not exist yet — if none is available, note that as a follow-up and skip to Step 5.

Upload a real Stvg Kortklubb context file (row 6/column D reads "Stvg kortklubb"). Confirm:
- The label "Detected club: Stvg Kortklubb" appears.
- The downloaded file's main table has 10 columns with headers `Nickname, Line Amount, Chips, Has Line, Profit/Loss, Pm, uttak sum, ruller, Claima chips/Gitt chips, satt opp` — no `Name` column anywhere.
- Borders/bold header styling still render correctly on the narrower table (visually confirms `mainTableColumnCount` derivation from Task 4 works for 10 columns, not just 11).

- [ ] **Step 5: Deploy and verify the Stvg Apps Script (once the new Stvg spreadsheet exists)**

This step requires creating the separate Stvg Google Sheet, which is outside this repo — if it doesn't exist yet, note as a follow-up.

1. In the new Stvg spreadsheet, install `player_stacks_sync_stvg.gs` per its header comment, deploy as a Web App, and set `VITE_PLAYER_STACKS_URL_STVG` in `.env.local`.
2. Re-upload the Stvg test file from Step 4 with the dev server running.
3. Confirm the Stvg spreadsheet's `Player stacks` tab is created/updated with the roster and active players, and that the original Knekt `Player stacks` sheet is untouched by this upload.

- [ ] **Step 6: Final commit (if any follow-up notes were added)**

If Steps 4-5 were skipped due to missing test files/spreadsheet, no code changes are needed — this plan's implementation is complete regardless, since those steps only verify infrastructure that depends on assets outside this repo. No commit needed unless verification uncovered a bug requiring a fix (in which case, fix, re-verify, and commit the fix with a message describing what was wrong).
