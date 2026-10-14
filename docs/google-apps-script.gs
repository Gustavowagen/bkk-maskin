/**
 * Google Apps Script that exposes the "navn + nick" sheet as JSON for bkk-maskin.
 *
 * Setup:
 * 1. Open the Google Sheet, then Extensions > Apps Script.
 * 2. Replace the contents of Code.gs with this file and save.
 * 3. Deploy > New deployment > type "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the web app URL (ends with /exec) and put it in .env.local in the project root:
 *      VITE_PLAYER_NAMES_URL=https://script.google.com/macros/s/XXXX/exec
 * 5. Restart `npm run dev` (and rebuild for production).
 *
 * After editing this script, use Deploy > Manage deployments > Edit > New version,
 * otherwise the old version keeps running. Changes to the sheet data are picked up immediately.
 *
 * Columns: A = real name, B = nickname, C = rb (blank, a rakeback like "25%", or "owner"); row 1 is the header.
 *
 * Response: [{ "name": "Tage Tveit", "nickname": "Finnfettfinger", "rb": "owner" }, ...]
 */

const SHEET_NAME = 'navn + nick';

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return json({ error: 'Sheet "' + SHEET_NAME + '" not found' });
  }

  // Column A = real name, column B = nickname, column C = rb; row 1 is the header.
  // Display values are used so a percentage cell comes through as "25%" rather than 0.25.
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues() : [];

  const players = rows
    .map(function (row) { return { name: row[0].trim(), nickname: row[1].trim(), rb: row[2].trim() }; })
    .filter(function (p) { return p.nickname && (p.name || p.rb); });

  return json(players);
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
