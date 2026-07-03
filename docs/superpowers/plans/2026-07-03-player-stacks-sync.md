# Player Stacks Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every time a user uploads a context file, silently extract every player's nickname + chip count from the "Club Member Balance" sheet and sync it to a "Player stacks" tab in an external Google Sheet, flagging players whose chips changed (or who are new) in an "Active players" column.

**Architecture:** A new pure-parsing function (`extractPlayerStacks`) reads every data row of "Club Member Balance" (skipping the fixed 5-row header block). A new fire-and-forget network function (`syncPlayerStacks`) POSTs that roster as JSON to a Google Apps Script Web App URL. The Apps Script `doPost` handler does the actual diffing server-side (old roster vs. new roster, under a lock) and rewrites the "Player stacks" sheet. Both frontend functions are wired into `App.tsx`'s existing `handleFileUpload`.

**Tech Stack:** React + TypeScript + Vite (frontend, existing), `xlsx`/SheetJS (existing, parsing only), Google Apps Script (`doPost` web app, new), plain `fetch`.

**Spec:** `docs/superpowers/specs/2026-07-03-player-stacks-sync-design.md` — read this first for the full rationale; this plan implements it task-by-task.

**No automated test suite exists in this repo** (confirmed: no test runner in `package.json`, no `npm test` script). Per the approved design doc, verification here is `npm run build` (TypeScript type-checking) for every code change, plus manual browser/Google Sheets verification at the points where automated checking isn't possible. Do not introduce a test framework as part of this plan — that would be out of scope.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/types/index.ts` | Modify | Add `PlayerStack` interface |
| `src/utils/excelUtils.ts` | Modify | Add `extractPlayerStacks` (parsing) and `syncPlayerStacks` (network) |
| `src/App.tsx` | Modify | Call both after a successful upload |
| `.env.example` | Create | Documents `VITE_PLAYER_STACKS_URL` |
| `player_stacks_sync.gs` | Create | Apps Script `doPost` handler — source of truth for the script pasted into the Google Sheet's Apps Script editor (this repo doesn't execute it; it's committed so it's version-controlled like `sheets_script.gs` already is) |

---

### Task 1: Add the `PlayerStack` type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the interface**

Open `src/types/index.ts` and add this interface (keep the existing `NicknameWithLine` and `AppState` interfaces as they are):

```ts
export interface PlayerStack {
  nickname: string;
  chips: number;
}
```

The full file should read:

```ts
export interface NicknameWithLine {
  nickname: string;
  line?: number; // Optional line value
}

export interface PlayerStack {
  nickname: string;
  chips: number;
}

export interface AppState {
  file: File | null;
  workbook: any | null; // XLSX.WorkBook
  isProcessing: boolean;
  isFiltered: boolean;
  nicknames: NicknameWithLine[];
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: Completes with no TypeScript errors (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add PlayerStack type for player stacks sync"
```

---

### Task 2: Implement `extractPlayerStacks`

**Files:**
- Modify: `src/utils/excelUtils.ts`

- [ ] **Step 1: Update the type import at the top of the file**

Find this line near the top of `src/utils/excelUtils.ts`:

```ts
import type { NicknameWithLine } from '../types';
```

Replace it with:

```ts
import type { NicknameWithLine, PlayerStack } from '../types';
```

- [ ] **Step 2: Add the `extractPlayerStacks` function**

Add this function after `filterWorkbookByNicknames` and before `downloadExcelFile`:

```ts
/**
 * Extract every player's nickname + chips from the "Club Member Balance" sheet.
 * Unlike filterWorkbookByNicknames (which only keeps rows matching user-entered
 * nicknames), this captures every data row regardless of Role, for syncing a
 * full roster snapshot to the external Player stacks database.
 */
export const extractPlayerStacks = (workbook: XLSX.WorkBook): PlayerStack[] => {
  const targetSheetName = 'Club Member Balance';

  if (!workbook.SheetNames.includes(targetSheetName)) {
    throw new Error(`Sheet "${targetSheetName}" not found in the uploaded file.`);
  }

  const worksheet = workbook.Sheets[targetSheetName];

  const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: ''
  });

  // Fixed 5-row header block: Union Name, Union ID, Period, merged category
  // headers, sub-headers. Real data starts at row 6 (index 5).
  const dataRows = jsonData.slice(5);

  const players: PlayerStack[] = [];

  dataRows.forEach((row) => {
    const nickname = row[10] !== undefined ? String(row[10]).trim() : '';
    const chips = row[11] !== undefined ? Number(row[11]) : NaN;

    // Defensive guard against empty rows or header-like drift in the export format.
    if (!nickname || nickname === '-' || nickname === 'Nickname') return;
    if (Number.isNaN(chips)) return;

    players.push({ nickname, chips });
  });

  return players;
};
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: Completes with no TypeScript errors (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add src/utils/excelUtils.ts
git commit -m "Add extractPlayerStacks to parse full roster from Club Member Balance"
```

---

### Task 3: Implement `syncPlayerStacks`

**Files:**
- Modify: `src/utils/excelUtils.ts`

- [ ] **Step 1: Add the `syncPlayerStacks` function**

Add this function directly after `extractPlayerStacks` (still before `downloadExcelFile`):

```ts
/**
 * Fire-and-forget sync of the latest player roster to the external
 * "Player stacks" Google Sheet via an Apps Script Web App endpoint.
 * Silent by design: no UI feedback is shown on success or failure,
 * per the approved player-stacks-sync design doc.
 */
export const syncPlayerStacks = async (players: PlayerStack[]): Promise<void> => {
  const url = import.meta.env.VITE_PLAYER_STACKS_URL as string | undefined;

  if (!url) {
    console.warn('VITE_PLAYER_STACKS_URL is not set; skipping player stacks sync.');
    return;
  }

  try {
    // text/plain avoids a CORS preflight OPTIONS request, which Apps Script
    // Web Apps don't handle. The body is still JSON; Apps Script parses it
    // from e.postData.contents regardless of the declared content type.
    await fetch(url, {
      method: 'POST',
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
Expected: Completes with no TypeScript errors (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add src/utils/excelUtils.ts
git commit -m "Add syncPlayerStacks to POST roster to Apps Script Web App"
```

---

### Task 4: Wire both functions into `App.tsx`

**Files:**
- Modify: `src/App.tsx:1-59`

- [ ] **Step 1: Update the import**

Find:

```tsx
import { readExcelFile, readNameFile, filterWorkbookByNicknames, downloadExcelFile } from './utils/excelUtils'
```

Replace with:

```tsx
import { readExcelFile, readNameFile, filterWorkbookByNicknames, downloadExcelFile, extractPlayerStacks, syncPlayerStacks } from './utils/excelUtils'
```

- [ ] **Step 2: Call the sync after a successful read**

Find `handleFileUpload`:

```tsx
  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)
    
    try {
      const wb = await readExcelFile(uploadedFile)
      setWorkbook(wb)
    } catch (error) {
      console.error('Error reading file:', error)
      alert('Error reading Excel file. Please make sure it is a valid Excel file.')
    }
  }
```

Replace with:

```tsx
  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)
    
    try {
      const wb = await readExcelFile(uploadedFile)
      setWorkbook(wb)

      // Silent, best-effort sync — must never block the upload flow above.
      try {
        const players = extractPlayerStacks(wb)
        syncPlayerStacks(players)
      } catch (error) {
        console.error('Error extracting player stacks:', error)
      }
    } catch (error) {
      console.error('Error reading file:', error)
      alert('Error reading Excel file. Please make sure it is a valid Excel file.')
    }
  }
```

The inner `try/catch` is intentionally separate from the outer one: if `extractPlayerStacks` throws (e.g. a context file with no "Club Member Balance" sheet), it must not trigger the "Error reading Excel file" alert or stop `setWorkbook` from having already succeeded — sync failures are silent per the design doc, real file-read failures are not.

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: Completes with no TypeScript errors (exit code 0).

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
Then in the browser:
1. Open DevTools → Console tab.
2. Upload any valid context `.xlsx` file that has a "Club Member Balance" sheet (use a real one if available).
3. Expected: console shows `VITE_PLAYER_STACKS_URL is not set; skipping player stacks sync.` (the env var doesn't exist yet at this point in the plan) and the app otherwise behaves exactly as before (nickname input / Filter button still appear, no alert, no crash).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "Wire player stacks extraction and sync into file upload"
```

---

### Task 5: Add `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create the file**

```
# URL of the deployed Google Apps Script Web App that syncs the "Player stacks"
# sheet. See player_stacks_sync.gs for the script, and
# docs/superpowers/specs/2026-07-03-player-stacks-sync-design.md for setup.
# Copy this file to .env.local (gitignored via the repo's `*.local` pattern)
# and fill in the real deployed URL.
VITE_PLAYER_STACKS_URL=
```

- [ ] **Step 2: Verify it's tracked, and that a real `.env.local` would be ignored**

Run: `git check-ignore -v .env.local || echo "not ignored"`
Expected: prints a match against the `*.local` line in `.gitignore` (confirms `.env.local` is ignored so a real deployment URL never gets committed). If it prints `not ignored`, stop and re-check `.gitignore` before continuing — do not commit a real URL into a tracked file.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "Document VITE_PLAYER_STACKS_URL in .env.example"
```

---

### Task 6: Write the Apps Script `doPost` handler

**Files:**
- Create: `player_stacks_sync.gs`

- [ ] **Step 1: Create the file**

```js
/**
 * Syncs the "Player stacks" tab from uploads made in the poker summarizer
 * frontend (vite_summarizer). See docs/superpowers/specs/2026-07-03-player-
 * stacks-sync-design.md in that repo for the full design.
 *
 * Install: In the same Google Sheet as sheets_script.gs, open
 * Extensions → Apps Script → File → New → Script, name it
 * "player_stacks_sync" → paste this in → Save (Ctrl+S).
 *
 * Deploy: Deploy → New deployment → gear icon → type "Web app" →
 * execute as "Me", who has access "Anyone" → Deploy. Copy the resulting
 * .../exec URL into VITE_PLAYER_STACKS_URL (see .env.example in the
 * vite_summarizer repo).
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
    sheet.getRange(1, 1, 1, 3).setValues([['Nickname', 'Chips', 'Active players']]);
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

// Full replace: clears A2:C down to the old last row, then writes the new
// roster into A/B and the active list into C. Players missing from
// newPlayers are simply not written back, which is how they're "removed".
function writeSnapshot_(sheet, newPlayers, activePlayers) {
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  }

  if (newPlayers.length > 0) {
    const rosterRows = newPlayers.map((p) => [p.nickname, Number(p.chips)]);
    sheet.getRange(2, 1, rosterRows.length, 2).setValues(rosterRows);
  }

  if (activePlayers.length > 0) {
    const activeRows = activePlayers.map((n) => [n]);
    sheet.getRange(2, 3, activeRows.length, 1).setValues(activeRows);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add player_stacks_sync.gs
git commit -m "Add Apps Script doPost handler for player stacks sync"
```

This script cannot be executed or type-checked in this repo — it only runs inside the Google Sheet's Apps Script project. Task 7 covers deploying and verifying it for real.

---

### Task 7: Deploy and verify end-to-end

This task is done by a human with access to the Google Sheet (the AI executor cannot log into Google or click through the Apps Script UI).

**Files:** none (verification only)

- [ ] **Step 1: Paste and deploy the script**

1. Open the Google Sheet that `sheets_script.gs` is already bound to.
2. Extensions → Apps Script.
3. Add a new script file named `player_stacks_sync`, paste in the full contents of `player_stacks_sync.gs` from this repo, save.
4. Deploy → New deployment → gear icon → "Web app" → execute as "Me" → who has access "Anyone" → Deploy.
5. Authorize the requested permissions (it needs access to the spreadsheet).
6. Copy the deployment's `.../exec` URL.

- [ ] **Step 2: Configure the frontend**

In the `vite_summarizer` repo root:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set:

```
VITE_PLAYER_STACKS_URL=<the /exec URL from Step 1>
```

- [ ] **Step 3: First upload — verify roster creation**

Run: `npm run dev`

In the browser:
1. Open DevTools → Network tab.
2. Upload a real context file (one with a "Club Member Balance" sheet and multiple player rows, including at least one row where the player also appears as an Agent/Manager/Super Agent, e.g. "Benjy10" or "Didrik Dromme" in the reference screenshot at `images/2026-07-03 20_54_15-583314_20260105145850 - Google Regneark.png`).
3. Find the POST request to the `.../exec` URL. Confirm the response body is `{"success":true,"total":<N>,"active":<N>}` where `total` matches the number of player rows in the source file.
4. Open the Google Sheet's "Player stacks" tab. Confirm column A/B now list every player's nickname and chip count matching the source file, and column C ("Active players") lists every nickname (since this is the first sync, every player is new).

- [ ] **Step 4: Second upload — verify diffing**

1. In the source `.xlsx` file (or a copy), change the Chips value for 2-3 players, and remove one player's row entirely.
2. Upload this modified file through the same flow.
3. Confirm in the Network tab the response `active` count equals the number of players you changed (removed players don't count).
4. In the Google Sheet, confirm:
   - Column A/B no longer contains the removed player.
   - Column A/B chip values reflect the new numbers for the changed players.
   - Column C now lists exactly the 2-3 changed nicknames (and nothing else — it was cleared and rewritten, not appended to).

- [ ] **Step 5: Confirm silence in the UI**

Re-confirm that throughout Steps 3-4, the app's visible UI never showed any sync-related message, loading state, or alert — the only observable evidence was in the Network tab and the Google Sheet itself, per the "silent background sync" decision.

No commit for this task (verification only). If any check in Steps 3-5 fails, treat it as a bug in Task 2, 3, 4, or 6 — fix the relevant task's code, re-run `npm run build`, and repeat this task's verification from Step 3.
