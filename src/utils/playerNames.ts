/**
 * Real names and rakeback settings of the players, looked up from the "navn + nick" sheet in Google Sheets.
 * The sheet is exposed as JSON by a Google Apps Script web app (see docs/google-apps-script.gs),
 * whose URL is configured in the VITE_PLAYER_NAMES_URL environment variable.
 */
const PLAYER_NAMES_URL = import.meta.env.VITE_PLAYER_NAMES_URL as string | undefined;
const FETCH_TIMEOUT_MS = 15000;

interface PlayerSheetEntry {
  name: string;
  nickname: string;
  rb?: string; // Column C: blank, a rakeback percentage (e.g. "25%") or "owner"
}

/**
 * What the "rb" column says about a player: either an owner, or a rakeback in percent (25 = 25%)
 */
export type PlayerRbSetting = { owner: true } | { owner: false; rakeback: number };

export interface PlayerSheetData {
  realNames: Map<string, string>;
  rbSettings: Map<string, PlayerRbSetting>;
}

const normalizeNickname = (nickname: string): string => nickname.trim().toLowerCase();

/**
 * Parse the "rb" column. Blank or unrecognised values give undefined (nothing is filled in).
 * Accepts "owner" (any case) and percentages like "25%", "25", "27,5 %".
 */
const parseRb = (value: string): PlayerRbSetting | undefined => {
  const text = value.trim().toLowerCase();
  if (text === '') return undefined;
  if (text === 'owner') return { owner: true };
  const match = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(text);
  if (!match) return undefined;
  return { owner: false, rakeback: Number(match[1].replace(',', '.')) };
};

/**
 * Fetch the real names and rb settings, both keyed by nickname (case-insensitive)
 */
export const fetchPlayerSheet = async (): Promise<PlayerSheetData> => {
  if (!PLAYER_NAMES_URL) {
    throw new Error('VITE_PLAYER_NAMES_URL is not set, so real names could not be looked up.');
  }

  // Without a timeout a hanging request (e.g. blocked by a browser extension) would stall filtering forever
  let response: Response;
  try {
    response = await fetch(PLAYER_NAMES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`Google Sheets did not respond within ${FETCH_TIMEOUT_MS / 1000} seconds.`);
    }
    throw new Error('Could not reach Google Sheets (check your connection or browser extensions blocking script.google.com).');
  }
  if (!response.ok) {
    throw new Error(`Could not fetch real names (HTTP ${response.status}).`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message ? `Could not fetch real names: ${message}` : 'Unexpected response when fetching real names.');
  }

  const entries = data as PlayerSheetEntry[];
  const realNames = new Map<string, string>();
  const rbSettings = new Map<string, PlayerRbSetting>();
  entries.forEach(({ name, nickname, rb }) => {
    const key = normalizeNickname(String(nickname ?? ''));
    if (!key) return;
    const realName = String(name ?? '').trim();
    if (realName && !realNames.has(key)) realNames.set(key, realName);
    const rbSetting = parseRb(String(rb ?? ''));
    if (rbSetting && !rbSettings.has(key)) rbSettings.set(key, rbSetting);
  });
  return { realNames, rbSettings };
};

/**
 * Real name for a player, or '' if the nickname is not in the sheet.
 * Tries each given nickname in order (e.g. the full club nickname, then the entered one).
 */
export const findRealName = (names: Map<string, string>, ...nicknames: string[]): string => {
  for (const nickname of nicknames) {
    const realName = names.get(normalizeNickname(nickname));
    if (realName) return realName;
  }
  return '';
};

/**
 * The "rb" column setting for a player, or undefined if it is blank or the nickname is not in the sheet
 */
export const findRbSetting = (settings: Map<string, PlayerRbSetting>, nickname: string): PlayerRbSetting | undefined =>
  settings.get(normalizeNickname(nickname));
