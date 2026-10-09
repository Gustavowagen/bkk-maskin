/**
 * Real names of the players, looked up from the "navn + nick" sheet in Google Sheets.
 * The sheet is exposed as JSON by a Google Apps Script web app (see docs/google-apps-script.gs),
 * whose URL is configured in the VITE_PLAYER_NAMES_URL environment variable.
 */
const PLAYER_NAMES_URL = import.meta.env.VITE_PLAYER_NAMES_URL as string | undefined;
const FETCH_TIMEOUT_MS = 15000;

interface PlayerNameEntry {
  name: string;
  nickname: string;
}

const normalizeNickname = (nickname: string): string => nickname.trim().toLowerCase();

/**
 * Fetch the real names keyed by nickname (case-insensitive)
 */
export const fetchPlayerNames = async (): Promise<Map<string, string>> => {
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

  const entries = data as PlayerNameEntry[];
  const names = new Map<string, string>();
  entries.forEach(({ name, nickname }) => {
    const key = normalizeNickname(String(nickname ?? ''));
    const realName = String(name ?? '').trim();
    if (key && realName && !names.has(key)) names.set(key, realName);
  });
  return names;
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
