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
