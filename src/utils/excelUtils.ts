import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { AgentInput, NicknameWithLine, OwnerAccountGroup } from '../types';
import { OWNER_ACCOUNT_GROUPS } from '../types';
import { findRealName } from './playerNames';

/**
 * Read an Excel file and return a workbook
 */
export const readExcelFile = (file: File): Promise<XLSX.WorkBook> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        resolve(wb);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsBinaryString(file);
  });
};

export const isZipFile = (file: File): boolean => /\.zip$/i.test(file.name);

/**
 * Find the context file inside a zip archive. When the zip holds several Excel files,
 * the first one with a "Club Member Balance" sheet wins.
 */
export const extractExcelFromZip = async (zipFile: File): Promise<File> => {
  const zip = await JSZip.loadAsync(zipFile);
  // Skip folders, macOS metadata and Excel lock files ("~$name.xlsx")
  const entries = Object.values(zip.files).filter(entry =>
    !entry.dir &&
    /\.xlsx?$/i.test(entry.name) &&
    !entry.name.startsWith('__MACOSX/') &&
    !entry.name.split('/').pop()!.startsWith('~$')
  );
  if (entries.length === 0) {
    throw new Error(`No Excel file (.xlsx/.xls) found in ${zipFile.name}.`);
  }

  const files = await Promise.all(entries.map(async entry =>
    new File([await entry.async('arraybuffer')], entry.name.split('/').pop()!)
  ));
  if (files.length === 1) return files[0];

  for (const file of files) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', bookSheets: true });
    if (wb.SheetNames.includes('Club Member Balance')) return file;
  }
  return files[0];
};

// Compare headers ignoring case and whitespace, so "Rake&Fee" matches "Rake & Fee"
const normalizeHeader = (value: unknown): string => String(value ?? '').replace(/\s+/g, '').toLowerCase();

/**
 * Parse a numeric cell. Handles real numbers as well as text with spaces as thousands
 * separators, "," as decimal separator or a unicode minus sign (e.g. "1 271,98").
 */
const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  const text = String(value ?? '')
    .replace(/\s/g, '') // also matches non-breaking and narrow no-break spaces
    .split(String.fromCharCode(0x2212)).join('-') // unicode minus sign
    .replace(',', '.');
  const parsed = parseFloat(text);
  return isNaN(parsed) ? 0 : parsed;
};

export interface MemberStatistic {
  nickname: string;
  rake: number;
  profitLoss: number; // Total player P&L
  agent: string; // Agent nickname, '' if the member has no agent
}

interface HeaderPosition {
  row: number;
  col: number;
}

/**
 * Wraps a sheet so columns can be located by their header names instead of fixed column letters.
 */
const createSheetReader = (workbook: XLSX.WorkBook, targetSheetName: string) => {
  const sheetName = workbook.SheetNames.find(name => normalizeHeader(name) === normalizeHeader(targetSheetName));
  if (!sheetName) {
    throw new Error(`Sheet "${targetSheetName}" not found in the uploaded file.`);
  }

  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
  const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', range });
  // sheet_to_json indexes from the start of the range, so translate back to sheet coordinates
  const cellAt = (r: number, c: number) => rows[r - range.s.r]?.[c - range.s.c];
  const mergeAt = (r: number, c: number) => (worksheet['!merges'] ?? []).find(m =>
    m.s.r <= r && r <= m.e.r && m.s.c <= c && c <= m.e.c
  );

  /**
   * Find the first header cell with the given name, scanning top to bottom.
   * Header cells can be merged vertically, so the returned row is the lowest row of the merge.
   */
  const findHeader = (header: string): HeaderPosition => {
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (normalizeHeader(cellAt(r, c)) === normalizeHeader(header)) {
          const merge = mergeAt(r, c);
          return { row: merge ? merge.e.r : r, col: c };
        }
      }
    }
    throw new Error(`Could not find the "${header}" column in the "${targetSheetName}" sheet.`);
  };

  /**
   * Find a group header (e.g. "Member") and a sub-header beneath it (e.g. "Nickname").
   * Returns the sub-header's row and column.
   */
  const findSubHeader = (groupHeader: string, subHeader: string): HeaderPosition => {
    const group = findHeader(groupHeader);

    // Determine which columns belong to the group: use its merge range, otherwise
    // extend right until the next non-empty header in the same row
    const merge = mergeAt(group.row, group.col);
    let groupEndCol = merge ? merge.e.c : group.col;
    if (!merge) {
      while (groupEndCol + 1 <= range.e.c && normalizeHeader(cellAt(group.row, groupEndCol + 1)) === '') {
        groupEndCol++;
      }
    }

    const firstSubRow = group.row + 1;
    for (let r = firstSubRow; r <= Math.min(firstSubRow + 4, range.e.r); r++) {
      for (let c = group.col; c <= groupEndCol; c++) {
        if (normalizeHeader(cellAt(r, c)) === normalizeHeader(subHeader)) {
          const subMerge = mergeAt(r, c);
          return { row: subMerge ? subMerge.e.r : r, col: c };
        }
      }
    }
    throw new Error(`Could not find the "${subHeader}" column under "${groupHeader}" in the "${targetSheetName}" sheet.`);
  };

  /**
   * Row numbers below the given headers, up to (not including) the "TOTAL" row
   */
  const dataRows = (...headers: HeaderPosition[]): number[] => {
    const result: number[] = [];
    const firstDataRow = Math.max(...headers.map(h => h.row)) + 1;
    for (let r = firstDataRow; r <= range.e.r; r++) {
      const row = rows[r - range.s.r] ?? [];
      if (row.some(cell => normalizeHeader(cell) === 'total')) break;
      result.push(r);
    }
    return result;
  };

  return { cellAt, findHeader, findSubHeader, dataRows };
};

// Look up an optional column, returning undefined instead of throwing when it is missing
const tryFindHeader = (find: () => HeaderPosition): HeaderPosition | undefined => {
  try {
    return find();
  } catch {
    return undefined;
  }
};

/**
 * Read every member with their total rake, total P&L and agent from the "Member Statistics" sheet.
 * - Locates the "Member" header (usually merged across Country/Role/ID/Nickname) and
 *   the "Nickname" sub-header underneath it
 * - Locates the "Rake&Fee" header and the "Total" sub-header underneath it
 * - Locates the "Player P&L" → "Total" and "Agent" → "Nickname" columns (optional, 0 / '' if missing)
 * - Reads every row below that until the "TOTAL" row. Members with 0 total rake are included;
 *   use isActiveMember to keep only the players that played in the period.
 */
export const extractMemberStatistics = (workbook: XLSX.WorkBook): MemberStatistic[] => {
  const sheet = createSheetReader(workbook, 'Member Statistics');
  const nicknameHeader = sheet.findSubHeader('Member', 'Nickname');
  const rakeHeader = sheet.findSubHeader('Rake&Fee', 'Total');
  const profitLossHeader = tryFindHeader(() => sheet.findSubHeader('Player P&L', 'Total'));
  const agentHeader = tryFindHeader(() => sheet.findSubHeader('Agent', 'Nickname'));

  const players: MemberStatistic[] = [];
  const seen = new Set<string>();
  sheet.dataRows(nicknameHeader, rakeHeader).forEach(r => {
    const nickname = String(sheet.cellAt(r, nicknameHeader.col) ?? '').trim();
    if (!nickname || nickname === '-') return;

    const rake = parseNumber(sheet.cellAt(r, rakeHeader.col));
    const profitLoss = profitLossHeader ? parseNumber(sheet.cellAt(r, profitLossHeader.col)) : 0;
    const agentCell = agentHeader ? String(sheet.cellAt(r, agentHeader.col) ?? '').trim() : '';
    const agent = agentCell === '-' ? '' : agentCell;

    const key = nickname.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      players.push({ nickname, rake, profitLoss, agent });
    }
  });

  return players;
};

// Players without any rake did not play in the period, so they are not active
export const isActiveMember = (member: MemberStatistic): boolean => member.rake !== 0;

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Members in "Member Statistics" that belong to the agent: the agent himself and every member
 * whose "Agent" → "Nickname" matches the agent name (case-insensitive)
 */
export const findAgentMembers = (memberStatistics: MemberStatistic[], agentName: string): MemberStatistic[] =>
  memberStatistics.filter(m => sameName(m.nickname, agentName) || sameName(m.agent, agentName));

// Number of columns in the main (positive/negative) tables
const MAIN_TABLE_COLUMN_COUNT = 12;
// The owners table sits to the right of the main table, with one empty column in between
const OWNERS_TABLE_COLUMN_INDEX = MAIN_TABLE_COLUMN_COUNT + 1;
const OWNERS_TABLE_HEADERS = ['Nickname', 'Navn', 'Line', 'Chips', 'Rake', 'Profit/Loss', 'Rake share', 'Rb+rake', 'Ny Saldo', 'uttak sum', 'ruller', 'claima chips', 'satt opp'];
// The stats table sits to the right of the owners table, with one empty column in between
const STATS_TABLE_COLUMN_INDEX = OWNERS_TABLE_COLUMN_INDEX + OWNERS_TABLE_HEADERS.length + 1;
const STATS_TABLE_ROW_COUNT = 2; // Header + values
const STATS_TABLE_HEADERS = ['Brutto Rake', 'Netto Rake', 'Ekstra utgifter', 'Total RB', 'Total agent RB'];
// Agent tables sit to the right of the stats table, side by side with one empty column in between.
// Each table has the agent name above it, then the headers, one row per player, a total row, a rake share row,
// a "Saldo fra før" row and a "Ny Saldo" row.
const AGENT_TABLES_COLUMN_INDEX = STATS_TABLE_COLUMN_INDEX + STATS_TABLE_HEADERS.length + 1;
const AGENT_TABLE_HEADERS = ['Nickname', 'Chips', 'Rake', 'Profit/Loss'];
const AGENT_TABLE_STRIDE = AGENT_TABLE_HEADERS.length + 1;
const AGENT_TABLE_SUMMARY_ROW_COUNT = 4; // Total, rake share, saldo fra før and ny saldo
// Number of empty rows in each transfer table, below its header
const TRANSFER_TABLE_ROW_COUNT = 25;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const BALANCE_SHEET_NAME = 'Club Member Balance';

interface BalanceRow {
  nickname: string;
  chips: number;
}

/**
 * Read nickname and chips for every member in the "Club Member Balance" sheet.
 * - Nickname: the "Nickname" sub-header under the "Member" header
 * - Chips: the "Chips" header
 */
const getBalanceRows = (workbook: XLSX.WorkBook): BalanceRow[] => {
  const sheet = createSheetReader(workbook, BALANCE_SHEET_NAME);
  const nicknameHeader = sheet.findSubHeader('Member', 'Nickname');
  const chipsHeader = sheet.findHeader('Chips');

  return sheet.dataRows(nicknameHeader, chipsHeader)
    .map(r => ({
      nickname: String(sheet.cellAt(r, nicknameHeader.col) ?? '').trim(),
      chips: parseNumber(sheet.cellAt(r, chipsHeader.col)),
    }))
    .filter(row => row.nickname && row.nickname !== '-');
};

/**
 * Match every "Club Member Balance" row to an entered nickname (case-insensitive):
 * - An exact match always wins
 * - Otherwise the member's nickname must start with the entered nickname, and the longest such
 *   entered nickname wins (so "Ola123" goes to "Ola123", not "Ola", when both are entered)
 * - An entered nickname that matches a row exactly does not also claim other rows by prefix
 *   (so entering "Ola" does not pull in an unentered "Ola123" with Ola's line and rakeback)
 * Rows without a match are left out of the map.
 */
const matchBalanceRows = (rows: BalanceRow[], nicknames: NicknameWithLine[]): Map<BalanceRow, NicknameWithLine> => {
  const exactlyMatched = new Set<NicknameWithLine>();
  const exactMatches = new Map<BalanceRow, NicknameWithLine>();
  rows.forEach(row => {
    const exact = nicknames.find(n => sameName(n.nickname, row.nickname));
    if (exact) {
      exactMatches.set(row, exact);
      exactlyMatched.add(exact);
    }
  });

  const matches = new Map<BalanceRow, NicknameWithLine>();
  rows.forEach(row => {
    const exact = exactMatches.get(row);
    if (exact) {
      matches.set(row, exact);
      return;
    }
    const memberNickname = row.nickname.toLowerCase();
    const prefixMatch = nicknames
      .filter(n => !exactlyMatched.has(n) && memberNickname.startsWith(n.nickname.toLowerCase()))
      .reduce<NicknameWithLine | undefined>((longest, n) =>
        !longest || n.nickname.length > longest.nickname.length ? n : longest, undefined);
    if (prefixMatch) matches.set(row, prefixMatch);
  });
  return matches;
};

/**
 * Find the entered nicknames that have no row in the "Club Member Balance" sheet.
 * These players are added to the generated document with 0 chips.
 */
export const findPlayersMissingFromBalance = (
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[]
): NicknameWithLine[] => {
  const matched = new Set(matchBalanceRows(getBalanceRows(workbook), nicknames).values());
  return nicknames.filter(n => !matched.has(n));
};

/**
 * Filter Excel workbook based on nicknames
 * - Only processes the "Club Member Balance" sheet
 * - Reads the member nickname and chips columns (located by their headers)
 * - Filters rows matching the provided nicknames: exact match first, otherwise the longest prefix (see matchBalanceRows)
 * - Players without a "Club Member Balance" row are added with 0 chips, shown as "Left Club?"
 * - Adds "Navn" column (real name from the Google Sheet, blank if the nickname is not found)
 * - Adds "Rake" column (total rake from the "Member Statistics" sheet)
 * - Adds "Rakeback" column (rake * rakeback %)
 * - Adds "Profit/Loss" column (chips - line if line exists, otherwise just chips, plus rakeback)
 * - Owners are left out of the main table and put in an owners table to the right of it
 *   ("Rake share" = Netto Rake / number of owners, "Rb+rake" = Rake + Rake share, "Ny Saldo" = Profit/Loss + Rake share).
 *   An owner with several accounts (OWNER_ACCOUNT_GROUPS) counts as one owner: his rake share is split between
 *   his accounts, and a total row (Rake, Profit/Loss, Rake share, Rb+rake) is added below them.
 * - Agents and players whose agent (in "Member Statistics") is one of the entered agents are left out
 *   of the main and owners tables and put in a table per agent to the right of the stats table.
 *   Their Profit/Loss is the total player P&L from "Member Statistics" (line and rakeback are ignored).
 *   The agent is included even if he is not an active player, as long as he is in "Member Statistics".
 *   "Rake share" = total rake of the agent table * the agent's rake %
 *   "Saldo fra før" = the agent's entered balance from before (0 if not entered),
 *   "Ny Saldo" = total Profit/Loss of the agent table + Rake share + Saldo fra før
 * - Adds a stats table to the right of the owners table ("Brutto Rake" = sum of all players' rake,
 *   "Netto Rake" = Brutto Rake - sum of all players' rakeback - extra expenses - total agent rake share,
 *   both including owners and agent tables, "Ekstra utgifter" = other club expenses entered by the user,
 *   "Total RB" = sum of all players' rakeback including owners but not agent tables,
 *   "Total agent RB" = sum of all agents' rake share)
 */
export const filterWorkbookByNicknames = (
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[],
  memberStatistics: MemberStatistic[] = [],
  extraExpenses = 0,
  realNames: Map<string, string> = new Map(),
  agents: AgentInput[] = []
): XLSX.WorkBook => {
  const newWorkbook = XLSX.utils.book_new();
  const targetSheetName = BALANCE_SHEET_NAME;

  const balanceRows = getBalanceRows(workbook);

  // If no nicknames provided, return empty workbook
  if (nicknames.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(newWorkbook, emptySheet, targetSheetName);
    return newWorkbook;
  }

  const positiveData: any[][] = [];
  const negativeData: any[][] = [];
  const ownerData: unknown[][] = [];
  // Owner rows that are one of several accounts of the same owner
  const ownerRowGroups = new Map<unknown[], OwnerAccountGroup>();
  let bruttoRake = 0;
  let totalRakeback = 0;

  const profitLossIndex = 6;

  const statByNickname = new Map(memberStatistics.map(m => [m.nickname.toLowerCase(), m]));
  // Entered nicknames normally match exactly, but fall back to prefix matching like the chips lookup does
  // (preferring active players, since inactive members are in the statistics as well)
  const findStat = (nickname: string): MemberStatistic | undefined => {
    const key = nickname.toLowerCase();
    const exact = statByNickname.get(key);
    if (exact !== undefined) return exact;
    const matchesPrefix = (m: MemberStatistic) => m.nickname.toLowerCase().startsWith(key);
    return memberStatistics.find(m => matchesPrefix(m) && isActiveMember(m)) ?? memberStatistics.find(matchesPrefix);
  };

  interface AgentTableRow {
    nickname: string;
    chips: unknown;
    rake: number;
    profitLoss: number;
    isAgent: boolean;
  }
  const findAgent = (name: string) => agents.find(agent => sameName(agent.name, name));
  const agentRows = new Map<AgentInput, AgentTableRow[]>(agents.map(agent => [agent, []]));

  /**
   * Put the player in his agent's table if he is one of the entered agents or one of their players.
   * Returns false if the player does not belong to any agent.
   */
  const addAgentTableRow = (displayName: string, chipsDisplay: unknown, stat: MemberStatistic | undefined, enteredNickname: string): boolean => {
    const ownAgent = findAgent(displayName) ?? findAgent(enteredNickname) ?? (stat && findAgent(stat.nickname));
    const agent = ownAgent ?? (stat?.agent ? findAgent(stat.agent) : undefined);
    if (!agent) return false;

    const rake = stat?.rake ?? 0;
    bruttoRake += rake;
    agentRows.get(agent)!.push({ nickname: displayName, chips: chipsDisplay, rake, profitLoss: stat?.profitLoss ?? 0, isAgent: !!ownAgent });
    return true;
  };

  const addPlayerRow = (displayName: string, chips: number, matchingNickname: NicknameWithLine, chipsDisplay: unknown = chips) => {
    const stat = findStat(matchingNickname.nickname);
    if (addAgentTableRow(displayName, chipsDisplay, stat, matchingNickname.nickname)) return;

    const hasLine = matchingNickname.line !== undefined;
    const lineAmount = matchingNickname.line !== undefined ? matchingNickname.line : '';

    const realName = findRealName(realNames, displayName, matchingNickname.nickname);
    const rake = stat?.rake ?? 0;
    const rakeback = matchingNickname.rakeback !== undefined
      ? Math.round(rake * matchingNickname.rakeback) / 100
      : '';

    // Calculate profit/loss
    let profitLoss: number;
    if (hasLine && matchingNickname.line !== undefined) {
      profitLoss = chips - matchingNickname.line;
    } else {
      profitLoss = chips;
    }
    // Rakeback is paid out to the player, so it adds to their profit
    profitLoss += Number(rakeback || 0);

    // Round down to integer (floor for positive, ceil for negative to round towards zero)
    profitLoss = profitLoss >= 0 ? Math.floor(profitLoss) : Math.ceil(profitLoss);

    bruttoRake += rake;
    totalRakeback += Number(rakeback || 0);

    if (matchingNickname.owner) {
      // Rake share, Rb+rake and Ny Saldo are filled in once the netto rake is known
      const ownerRow = [displayName, realName, lineAmount, chipsDisplay, rake, profitLoss, '', '', '', '', '', '', ''];
      ownerData.push(ownerRow);
      const group = OWNER_ACCOUNT_GROUPS.find(g =>
        g.accounts.some(account => sameName(account, matchingNickname.nickname) || sameName(account, displayName))
      );
      if (group) ownerRowGroups.set(ownerRow, group);
      return;
    }

    const rowData = [displayName, realName, lineAmount, chipsDisplay, rake, rakeback, profitLoss, '', '', '', '', ''];

    // Split into positive and negative arrays
    if (profitLoss >= 0) {
      positiveData.push(rowData);
    } else {
      negativeData.push(rowData);
    }
  };

  matchBalanceRows(balanceRows, nicknames).forEach((matchingNickname, row) => {
    addPlayerRow(row.nickname, row.chips, matchingNickname);
  });

  // Players without a "Club Member Balance" row still need to settle their line and rakeback
  findPlayersMissingFromBalance(workbook, nicknames).forEach(missing => {
    addPlayerRow(missing.nickname, 0, missing, 'Left Club?');
  });

  // Agents that are not active players are still included, as long as they are in "Member Statistics"
  agentRows.forEach((rows, agent) => {
    if (rows.some(row => row.isAgent)) return;
    const stat = memberStatistics.find(m => sameName(m.nickname, agent.name));
    if (!stat) return;
    const balanceRow = balanceRows.find(row => sameName(row.nickname, stat.nickname))
      ?? balanceRows.find(row => row.nickname.toLowerCase().startsWith(stat.nickname.toLowerCase()));
    addAgentTableRow(balanceRow?.nickname ?? stat.nickname, balanceRow ? balanceRow.chips : 'Left Club?', stat, stat.nickname);
  });

  // Sort both arrays by profit/loss (highest first)
  positiveData.sort((a, b) => b[profitLossIndex] - a[profitLossIndex]);
  negativeData.sort((a, b) => b[profitLossIndex] - a[profitLossIndex]);
  const ownerProfitLossIndex = 5;
  ownerData.sort((a, b) => Number(b[ownerProfitLossIndex]) - Number(a[ownerProfitLossIndex]));

  // Add headers for main tables
  const positiveHeaders = ['Nickname', 'Navn', 'Linje', 'Chips', 'Rake', 'Rakeback', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Claima chips', 'satt opp'];
  const negativeHeaders = ['Nickname', 'Navn', 'Linje', 'Chips', 'Rake', 'Rakeback', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Gitt chips', 'satt opp'];

  // Create the transfer table headers and empty rows
  const transferTableHeaders = ['Avsender', 'sum', 'Mottaker', 'bekreftet', 'purra'];
  const emptyTransferRows = Array(TRANSFER_TABLE_ROW_COUNT).fill(['', '', '', '', '']); // Empty rows for user input
  
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
  const combinedData: unknown[][] = [
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

  // Place a table at the top of the sheet, starting at the given column
  const placeTable = (table: unknown[][], columnIndex: number) => {
    table.forEach((tableRow, i) => {
      while (combinedData.length <= i) combinedData.push([]);
      const row = combinedData[i];
      while (row.length < columnIndex) row.push('');
      row.push(...tableRow);
    });
  };

  // One table per agent: the agent first, then his players by profit/loss (highest first)
  let totalAgentRakeback = 0;
  const agentTables = agents.map(agent => {
    const rows = agentRows.get(agent)!;
    rows.sort((a, b) => Number(b.isAgent) - Number(a.isAgent) || b.profitLoss - a.profitLoss);
    const totalRake = rows.reduce((sum, row) => sum + row.rake, 0);
    const totalProfitLoss = rows.reduce((sum, row) => sum + row.profitLoss, 0);
    const agentRakeShare = round2(totalRake * agent.rakeShare / 100);
    totalAgentRakeback += agentRakeShare;
    const newBalance = round2(totalProfitLoss + agentRakeShare + agent.previousBalance);
    return [
      [agent.name, '', '', ''],
      AGENT_TABLE_HEADERS,
      ...rows.map(row => [row.nickname, row.chips, round2(row.rake), round2(row.profitLoss)]),
      ['Total', '', round2(totalRake), round2(totalProfitLoss)],
      [`Rake share (${agent.rakeShare}%)`, '', agentRakeShare, ''],
      ['Saldo fra før', '', '', round2(agent.previousBalance)],
      ['Ny Saldo', '', '', newBalance],
    ];
  });

  const nettoRake = bruttoRake - totalRakeback - extraExpenses - totalAgentRakeback;

  // Owners table to the right of the main table: the netto rake is split evenly between the owners,
  // where an owner with several accounts counts once and his share is split between his accounts
  const accountsByGroup = new Map<OwnerAccountGroup, unknown[][]>();
  ownerData.forEach(row => {
    const group = ownerRowGroups.get(row);
    if (group) accountsByGroup.set(group, [...(accountsByGroup.get(group) ?? []), row]);
  });
  const ownerCount = ownerData.length - ownerRowGroups.size + accountsByGroup.size;
  const rakeShare = ownerCount > 0 ? round2(nettoRake / ownerCount) : 0;
  const ownerRakeIndex = 4;
  ownerData.forEach(row => {
    const group = ownerRowGroups.get(row);
    const accountRakeShare = group ? round2(rakeShare / accountsByGroup.get(group)!.length) : rakeShare;
    row[6] = accountRakeShare;
    // Owners get all of their own rake back, on top of their share of the netto rake
    row[7] = round2(Number(row[ownerRakeIndex]) + accountRakeShare);
    row[8] = round2(Number(row[ownerProfitLossIndex]) + accountRakeShare);
  });

  // Accounts of the same owner are kept together, followed by a total row when more than one is present
  const ownerTableRows: unknown[][] = [];
  const placedGroups = new Set<OwnerAccountGroup>();
  ownerData.forEach(row => {
    const group = ownerRowGroups.get(row);
    if (!group) {
      ownerTableRows.push(row);
      return;
    }
    if (placedGroups.has(group)) return;
    placedGroups.add(group);
    const accounts = accountsByGroup.get(group)!;
    ownerTableRows.push(...accounts);
    if (accounts.length > 1) {
      const sum = (index: number) => round2(accounts.reduce((total, account) => total + Number(account[index]), 0));
      ownerTableRows.push([group.name, '', '', '', sum(ownerRakeIndex), sum(ownerProfitLossIndex), rakeShare, sum(7), '', '', '', '', '']);
    }
  });
  placeTable([OWNERS_TABLE_HEADERS, ...ownerTableRows], OWNERS_TABLE_COLUMN_INDEX);

  // Stats table to the right of the owners table
  placeTable([
    STATS_TABLE_HEADERS,
    [round2(bruttoRake), round2(nettoRake), round2(extraExpenses), round2(totalRakeback), round2(totalAgentRakeback)],
  ], STATS_TABLE_COLUMN_INDEX);

  // Agent tables to the right of the stats table
  agentTables.forEach((table, i) => placeTable(table, AGENT_TABLES_COLUMN_INDEX + i * AGENT_TABLE_STRIDE));

  // Create new worksheet from filtered data
  const newWorksheet = XLSX.utils.aoa_to_sheet(combinedData);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, targetSheetName);

  return newWorkbook;
};

/**
 * Generate and download Excel file with styling
 */
export const downloadExcelFile = async (workbook: XLSX.WorkBook, filename: string): Promise<void> => {
  // Create a new ExcelJS workbook
  const excelWorkbook = new ExcelJS.Workbook();
  
  // Get the first sheet from XLSX workbook
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  
  // Add worksheet to ExcelJS workbook
  const excelWorksheet = excelWorkbook.addWorksheet(sheetName);
  
  // Main table column count. Can't be derived from the sheet data itself: sheet_to_json
  // pads every row out to the sheet's overall column range (21, from the always-present
  // transfer table header), so data[0].length is always 21.
  const mainTableColumnCount = MAIN_TABLE_COLUMN_COUNT;
  const statsTableColumnNumber = STATS_TABLE_COLUMN_INDEX + 1; // ExcelJS columns are 1-based
  const ownersTableColumnNumber = OWNERS_TABLE_COLUMN_INDEX + 1;
  // Owners table: header + one row per owner, starting at the top
  let ownersTableRowCount = 0;
  while (ownersTableRowCount < data.length && data[ownersTableRowCount][OWNERS_TABLE_COLUMN_INDEX] !== '') {
    ownersTableRowCount++;
  }
  // Agent tables: agent name + header + player rows + total, rake share, saldo fra før and ny saldo,
  // all with a non-empty first column
  const cellText = (rowIndex: number, colIndex: number) => data[rowIndex]?.[colIndex] ?? '';
  const agentTables: { columnNumber: number; rowCount: number }[] = [];
  for (let col = AGENT_TABLES_COLUMN_INDEX; cellText(0, col) !== ''; col += AGENT_TABLE_STRIDE) {
    let rowCount = 0;
    while (rowCount < data.length && cellText(rowCount, col) !== '') rowCount++;
    agentTables.push({ columnNumber: col + 1, rowCount });
  }

  // Add data to worksheet
  data.forEach((row, rowIndex) => {
    const excelRow = excelWorksheet.addRow(row);
    
    // Style header rows (first row, rows with 'Nickname', and rows with 'Avsender')
    const isHeaderRow = rowIndex === 0 || 
                        (row.length > 0 && row[0] === 'Nickname') ||
                        (row.length > 0 && row[0] === 'Avsender');
    
    // Find all transfer table header rows
    const transferTableIndices: number[] = [];
    data.forEach((r, idx) => {
      if (r.length > 0 && r[0] === 'Avsender') {
        transferTableIndices.push(idx);
      }
    });
    
    // Check if this is part of any transfer table (row with 'Avsender' or the empty rows after it)
    let isTransferTableRow = false;
    transferTableIndices.forEach(startIdx => {
      if (rowIndex >= startIdx && rowIndex <= startIdx + TRANSFER_TABLE_ROW_COUNT) { // Header + data rows
        isTransferTableRow = true;
      }
    });
    
    // Check if this is a separator row (2 rows before first transfer table OR 2 empty rows between transfer tables)
    const firstTransferTableIndex = transferTableIndices.length > 0 ? transferTableIndices[0] : -1;
    let isSeparatorRow = firstTransferTableIndex !== -1 && 
                          rowIndex >= firstTransferTableIndex - 2 && 
                          rowIndex < firstTransferTableIndex;
    
    // Also check if it's between transfer tables (empty rows between them)
    transferTableIndices.forEach((startIdx, tableIdx) => {
      if (tableIdx < transferTableIndices.length - 1) {
        const currentTableEnd = startIdx + 1 + TRANSFER_TABLE_ROW_COUNT; // Header + data rows
        const nextTableStart = transferTableIndices[tableIdx + 1];
        if (rowIndex >= currentTableEnd && rowIndex < nextTableStart) {
          isSeparatorRow = true;
        }
      }
    });
    
    // Process all cells in the row
    for (let colNumber = 1; colNumber <= Math.max(excelRow.cellCount, 20); colNumber++) {
      const cell = excelRow.getCell(colNumber);

      // Agent tables to the right of the stats table. Checked first, since they can be
      // tall enough to reach the separator and transfer table rows.
      const agentTable = agentTables.find(t =>
        rowIndex < t.rowCount &&
        colNumber >= t.columnNumber &&
        colNumber < t.columnNumber + AGENT_TABLE_HEADERS.length
      );
      if (agentTable) {
        if (rowIndex === 0) {
          // Agent name above the table
          cell.border = {};
          cell.font = { bold: true, size: 14 };
          cell.alignment = { horizontal: 'center' };
          continue;
        }
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        if (rowIndex === 1) {
          cell.font = { bold: true, size: 12 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E7FF' }
          };
        } else if (rowIndex >= agentTable.rowCount - AGENT_TABLE_SUMMARY_ROW_COUNT) {
          // Total, rake share, saldo fra før and ny saldo rows
          cell.font = { bold: true };
        }
        continue;
      }

      // Remove borders and fill from the 2 separator rows before transfer table
      if (isSeparatorRow) {
        cell.border = {};
        (cell as any).fill = null;
      } 
      // For transfer table rows, add borders to the appropriate columns (5 cols, 3 empty, 5 cols, 3 empty, 5 cols)
      else if (isTransferTableRow && (
        (colNumber >= 1 && colNumber <= 5) ||    // First table
        (colNumber >= 9 && colNumber <= 13) ||   // Second table (after 3 empty cells)
        (colNumber >= 17 && colNumber <= 21)     // Third table (after 3 more empty cells)
      )) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        // Make headers bold for first 3 columns
        if (isHeaderRow) {
          cell.font = { bold: true, size: 12 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E7FF' }
          };
        }
      }
      // For transfer table rows in the spacing columns, remove borders and fill
      else if (isTransferTableRow && (
        (colNumber >= 6 && colNumber <= 8) ||    // Space between table 1 and 2
        (colNumber >= 14 && colNumber <= 16) ||  // Space between table 2 and 3
        colNumber > 21                            // After table 3
      )) {
        cell.border = {};
        (cell as any).fill = null;
      }
      // Owners table to the right of the main table
      else if (
        rowIndex < ownersTableRowCount &&
        colNumber >= ownersTableColumnNumber &&
        colNumber < ownersTableColumnNumber + OWNERS_TABLE_HEADERS.length
      ) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };

        if (rowIndex === 0) {
          cell.font = { bold: true, size: 12 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E7FF' }
          };
        } else if (OWNER_ACCOUNT_GROUPS.some(group => group.name === cellText(rowIndex, OWNERS_TABLE_COLUMN_INDEX))) {
          // Total row of an owner with several accounts
          cell.font = { bold: true };
        }
      }
      // Stats table to the right of the owners table
      else if (
        rowIndex < STATS_TABLE_ROW_COUNT &&
        colNumber >= statsTableColumnNumber &&
        colNumber < statsTableColumnNumber + STATS_TABLE_HEADERS.length
      ) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };

        if (rowIndex === 0) {
          cell.font = { bold: true, size: 12 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E7FF' }
          };
        }
      }
      // Add borders to main table rows (only for columns 1-12)
      else if (!isSeparatorRow && !isTransferTableRow && colNumber <= mainTableColumnCount) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        // Make headers bold
        if (isHeaderRow) {
          cell.font = { bold: true, size: 12 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E7FF' }
          };
        }
      }
      // Remove borders and fill for main table rows beyond the main table
      else if (!isSeparatorRow && !isTransferTableRow && colNumber > mainTableColumnCount) {
        cell.border = {};
        (cell as any).fill = null;
      }
    }
  });
  
  // Auto-fit columns based on content (the merged agent names are left out, they span several columns)
  excelWorksheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber === 1 && agentTables.some(t => Number(column.number) === t.columnNumber)) return;
      const columnLength = cell.value ? String(cell.value).length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
  });

  // Center each agent name over its table
  agentTables.forEach(t => {
    excelWorksheet.mergeCells(1, t.columnNumber, 1, t.columnNumber + AGENT_TABLE_HEADERS.length - 1);
  });
  
  // Generate Excel file
  const buffer = await excelWorkbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
