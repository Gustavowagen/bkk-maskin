import * as XLSX from 'xlsx';
import { createSheetReader, getBalanceRows, normalizeHeader, parseNumber, tryFindHeader } from './excelUtils';

/**
 * The parts of a ClubGG export that the statistics keep beyond the player totals: every ring game
 * table ("Ring Game Detail") with its players, and every tournament ("MTT Statistics" + "MTT Detail").
 * Times are stored as ISO timestamps with the export's own UTC offset (usually UTC -7:00).
 */

export interface SessionPlayerRecord {
  memberId: string;
  nickname: string;
  buyin: number;
  cashout: number;
  hands: number;
  rake: number;
  profitLoss: number;
}

export interface RingSessionRecord {
  tableName: string; // e.g. "5/10(2) NLH Straddle"
  game: string; // e.g. "NLH", "PLO5"
  blinds: string; // e.g. "5/10(2)"
  stake: string; // game + blinds without the straddle/ante, e.g. "PLO5 5/10"
  startedAt: string;
  endedAt: string;
  hands: number; // Summed per seat, the way ClubGG counts them
  buyin: number;
  rake: number;
  bbj: number; // Bad beat jackpot contribution
  players: SessionPlayerRecord[];
}

export interface TournamentResultRecord {
  memberId: string;
  nickname: string;
  hands: number;
  paid: number; // Buy-ins, re-entries and their fees
  prize: number;
  net: number; // "Winnings"
}

export interface TournamentRecord {
  title: string;
  game: string;
  reentry: string; // e.g. "Unlimited"
  startedAt: string;
  endedAt: string;
  entries: number;
  gtd: number;
  prizePaid: number;
  overlay: number;
  buyinTotal: number; // Buy-ins and re-entries, without fees
  feeTotal: number; // Buy-in and re-entry fees, kept by the club
  results: TournamentResultRecord[];
}

export interface ExportDetail {
  clubName: string;
  utcOffsetMinutes: number; // The export's clock, e.g. -420 for "UTC -7:00"
  memberCount: number; // Members in "Club Member Balance"
  sessions: RingSessionRecord[];
  tournaments: TournamentRecord[];
}

const MEMBER_ID = /^\d{4}-\d{4}$/;
const TIMESTAMP = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g;
const DEFAULT_UTC_OFFSET_MINUTES = -7 * 60;

const findSheet = (workbook: XLSX.WorkBook, name: string): unknown[][] | undefined => {
  const sheetName = workbook.SheetNames.find(n => normalizeHeader(n) === normalizeHeader(name));
  return sheetName ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) : undefined;
};

const text = (value: unknown): string => String(value ?? '').trim();

/** "(UTC -7:00)" → -420. Undefined if the text holds no offset. */
const parseUtcOffset = (value: string): number | undefined => {
  const match = /UTC\s*([+\-−])\s*(\d{1,2})(?::(\d{2}))?/i.exec(value);
  if (!match) return undefined;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '+' ? minutes : -minutes;
};

/** "2026-10-12 09:54:58" in the export's clock → "2026-10-12T09:54:58-07:00" */
const toIsoTimestamp = (value: string, offsetMinutes: number): string => {
  const abs = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${value.replace(' ', 'T')}${offset}`;
};

/** "Club Name : Crown Pokerklubb" and the "Period : ... (UTC -7:00)" offset from the top of "Member Statistics" */
const readHeaderInfo = (workbook: XLSX.WorkBook) => {
  let clubName = '';
  let utcOffsetMinutes: number | undefined;
  (findSheet(workbook, 'Member Statistics') ?? []).slice(0, 10).forEach(row => row.forEach(cell => {
    const value = text(cell);
    const club = /^club name\s*:\s*(.+)$/i.exec(value);
    if (club && !clubName) clubName = club[1].trim();
    if (/^period\s*:/i.test(value) && utcOffsetMinutes === undefined) utcOffsetMinutes = parseUtcOffset(value);
  }));
  return { clubName, utcOffsetMinutes: utcOffsetMinutes ?? DEFAULT_UTC_OFFSET_MINUTES };
};

/** Column of each header name in a header row, matched ignoring case and spaces */
const columnsOf = (row: unknown[]) => {
  const columns = new Map<string, number>();
  row.forEach((cell, i) => {
    const key = normalizeHeader(cell);
    if (key && !columns.has(key)) columns.set(key, i);
  });
  return (header: string) => columns.get(normalizeHeader(header));
};

/**
 * Every table in "Ring Game Detail". Each table is a block: a "Start/End Time" line, a "Table Name" line,
 * a "Table Information" line, two header rows, one row per player and a "Total" row.
 */
export const extractRingSessions = (workbook: XLSX.WorkBook, defaultOffset: number): RingSessionRecord[] => {
  const rows = findSheet(workbook, 'Ring Game Detail');
  if (!rows) return [];

  const sessions: RingSessionRecord[] = [];
  let current: RingSessionRecord | undefined;
  let column: (header: string) => number | undefined = () => undefined;
  const cell = (row: unknown[], header: string) => {
    const c = column(header);
    return c === undefined ? 0 : parseNumber(row[c]);
  };

  rows.forEach(row => {
    const first = text(row[0]);
    if (/^start\/end time/i.test(first)) {
      const [start, end] = first.match(TIMESTAMP) ?? [];
      if (!start || !end) {
        current = undefined;
        return;
      }
      const offset = parseUtcOffset(first) ?? defaultOffset;
      current = {
        tableName: '', game: '', blinds: '', stake: '',
        startedAt: toIsoTimestamp(start, offset), endedAt: toIsoTimestamp(end, offset),
        hands: 0, buyin: 0, rake: 0, bbj: 0, players: [],
      };
      sessions.push(current);
    } else if (!current) {
      return;
    } else if (/^table name/i.test(first)) {
      current.tableName = /table name\s*:\s*(.*?)\s*,\s*creator/i.exec(first)?.[1] ?? first.replace(/^table name\s*:/i, '').trim();
    } else if (/^table information/i.test(first)) {
      current.game = /game\s*:\s*([^\s,]+)/i.exec(first)?.[1] ?? '';
      current.blinds = /blinds\s*:\s*([^\s,]+)/i.exec(first)?.[1] ?? '';
      current.stake = `${current.game} ${current.blinds.split('(')[0]}`.trim();
    } else if (normalizeHeader(first) === 'player') {
      column = columnsOf(row);
    } else if (MEMBER_ID.test(first)) {
      current.players.push({
        memberId: first,
        nickname: text(row[1]) || first,
        buyin: cell(row, 'Buy-in'),
        cashout: cell(row, 'Cashout'),
        hands: cell(row, 'Hands'),
        rake: cell(row, 'Rake'),
        profitLoss: cell(row, 'P&L'),
      });
    } else if (normalizeHeader(first) === 'total') {
      current.buyin = cell(row, 'Buy-in');
      current.hands = cell(row, 'Hands');
      current.rake = cell(row, 'Rake');
      current.bbj = cell(row, 'Bad Beat Jackpot');
    }
  });

  // A table without a "Total" row still gets its totals from the players
  sessions.forEach(session => {
    if (session.hands === 0 && session.rake === 0) {
      session.players.forEach(p => {
        session.hands += p.hands;
        session.rake += p.rake;
        session.buyin += p.buyin;
      });
    }
  });
  return sessions.filter(s => s.players.length > 0 || s.rake !== 0);
};

/**
 * Every tournament in "MTT Statistics", with its players from the matching "MTT Detail" block.
 * "MTT Statistics" has three header rows; the money columns under "Total Buy-in" and "Total Re-Entry"
 * are Chips, Ticket, Fee chips, Fee ticket.
 */
export const extractTournaments = (workbook: XLSX.WorkBook, offset: number): TournamentRecord[] => {
  let sheet: ReturnType<typeof createSheetReader>;
  try {
    sheet = createSheetReader(workbook, 'MTT Statistics');
  } catch {
    return [];
  }
  const title = tryFindHeader(() => sheet.findHeader('Tournament Title'));
  const start = tryFindHeader(() => sheet.findSubHeader('Time', 'Start'));
  if (!title || !start) return [];
  const col = (header: string) => tryFindHeader(() => sheet.findHeader(header))?.col;
  const end = tryFindHeader(() => sheet.findSubHeader('Time', 'End'))?.col;
  const game = col('Game Type');
  const reentry = col('Re-Entry');
  const gtd = col('GTD Prize');
  const entries = col('Entries');
  const totalBuyin = col('Total Buy-in');
  const totalReentry = col('Total Re-Entry');
  const prize = col('Payout Prize');
  const overlay = col('Overlay');
  const num = (r: number, c: number | undefined) => (c === undefined ? 0 : parseNumber(sheet.cellAt(r, c)));
  const str = (r: number, c: number | undefined) => (c === undefined ? '' : text(sheet.cellAt(r, c)));

  const tournaments: TournamentRecord[] = sheet.dataRows(start)
    .filter(r => str(r, title.col) !== '')
    .map(r => ({
      title: str(r, title.col),
      game: str(r, game),
      reentry: str(r, reentry),
      startedAt: str(r, start.col) ? toIsoTimestamp(str(r, start.col), offset) : '',
      endedAt: str(r, end) ? toIsoTimestamp(str(r, end), offset) : '',
      entries: num(r, entries),
      gtd: num(r, gtd),
      prizePaid: num(r, prize),
      overlay: num(r, overlay),
      buyinTotal: num(r, totalBuyin) + num(r, totalReentry),
      feeTotal: num(r, totalBuyin === undefined ? undefined : totalBuyin + 2) + num(r, totalReentry === undefined ? undefined : totalReentry + 2),
      results: [],
    }));

  // MTT Detail: blocks with a "Start/End Time" line, a "Table Name : <title> , Creator" line, header rows and player rows
  const detail = findSheet(workbook, 'MTT Detail') ?? [];
  let current: TournamentRecord | undefined;
  let blockStart = '';
  let column: (header: string) => number | undefined = () => undefined;
  const at = (row: unknown[], c: number | undefined, plus = 0) => (c === undefined ? 0 : parseNumber(row[c + plus]));
  detail.forEach(row => {
    const first = text(row[0]);
    if (/^start\/end time/i.test(first)) {
      blockStart = first.match(TIMESTAMP)?.[0] ?? '';
      current = undefined;
    } else if (/^table name/i.test(first)) {
      const name = /table name\s*:\s*(.*?)\s*,\s*creator/i.exec(first)?.[1] ?? '';
      const startIso = blockStart ? toIsoTimestamp(blockStart, offset) : '';
      current = tournaments.find(t => t.title === name && t.startedAt === startIso)
        ?? tournaments.find(t => t.title === name && t.results.length === 0)
        ?? (tournaments.length === 1 ? tournaments[0] : undefined);
    } else if (normalizeHeader(first) === 'player') {
      column = columnsOf(row);
    } else if (current && MEMBER_ID.test(first)) {
      const buyin = column('Total Buy-in');
      const reentryCol = column('Total Re-Entry');
      const prizeCol = column('Prize');
      current.results.push({
        memberId: first,
        nickname: text(row[1]) || first,
        hands: at(row, column('Hands')),
        paid: at(row, buyin) + at(row, buyin, 2) + at(row, reentryCol) + at(row, reentryCol, 2),
        // "Prize" spans "Bounty Prize" and "Regular Prize"
        prize: at(row, prizeCol) + at(row, prizeCol, 1),
        net: at(row, column('Winnings')),
      });
    }
  });
  return tournaments;
};

/** Everything the statistics keep from the export besides the player totals */
export const extractExportDetail = (workbook: XLSX.WorkBook): ExportDetail => {
  const { clubName, utcOffsetMinutes } = readHeaderInfo(workbook);
  let memberCount = 0;
  try {
    memberCount = getBalanceRows(workbook).length;
  } catch {
    memberCount = 0;
  }
  return {
    clubName,
    utcOffsetMinutes,
    memberCount,
    sessions: extractRingSessions(workbook, utcOffsetMinutes),
    tournaments: extractTournaments(workbook, utcOffsetMinutes),
  };
};
