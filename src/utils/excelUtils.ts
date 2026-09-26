import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type { NicknameWithLine } from '../types';

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
}

/**
 * Read the active players and their total rake from the "Member Statistics" sheet.
 * - Locates the "Member" header (usually merged across Country/Role/ID/Nickname) and
 *   the "Nickname" sub-header underneath it
 * - Locates the "Rake&Fee" header and the "Total" sub-header underneath it
 * - Reads every row below that until the "TOTAL" row
 */
export const extractMemberStatistics = (workbook: XLSX.WorkBook): MemberStatistic[] => {
  const targetSheetName = 'Member Statistics';
  const sheetName = workbook.SheetNames.find(name => normalizeHeader(name) === normalizeHeader(targetSheetName));
  if (!sheetName) {
    throw new Error(`Sheet "${targetSheetName}" not found in the uploaded file.`);
  }

  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
  const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', range });
  // sheet_to_json indexes from the start of the range, so translate back to sheet coordinates
  const cellAt = (r: number, c: number) => rows[r - range.s.r]?.[c - range.s.c];

  /**
   * Find a group header (e.g. "Member") and a sub-header beneath it (e.g. "Nickname").
   * Returns the sub-header's row and column.
   */
  const findSubHeader = (groupHeader: string, subHeader: string): { row: number; col: number } => {
    let groupRow = -1;
    let groupCol = -1;
    for (let r = range.s.r; r <= range.e.r && groupRow === -1; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (normalizeHeader(cellAt(r, c)) === normalizeHeader(groupHeader)) {
          groupRow = r;
          groupCol = c;
          break;
        }
      }
    }
    if (groupRow === -1) {
      throw new Error(`Could not find the "${groupHeader}" column in the "${targetSheetName}" sheet.`);
    }

    // Determine which columns belong to the group: use its merge range, otherwise
    // extend right until the next non-empty header in the same row
    const merge = (worksheet['!merges'] ?? []).find(m =>
      m.s.r <= groupRow && groupRow <= m.e.r && m.s.c <= groupCol && groupCol <= m.e.c
    );
    let groupEndCol = merge ? merge.e.c : groupCol;
    if (!merge) {
      while (groupEndCol + 1 <= range.e.c && normalizeHeader(cellAt(groupRow, groupEndCol + 1)) === '') {
        groupEndCol++;
      }
    }

    const firstSubRow = merge ? merge.e.r + 1 : groupRow + 1;
    for (let r = firstSubRow; r <= Math.min(firstSubRow + 4, range.e.r); r++) {
      for (let c = groupCol; c <= groupEndCol; c++) {
        if (normalizeHeader(cellAt(r, c)) === normalizeHeader(subHeader)) {
          return { row: r, col: c };
        }
      }
    }
    throw new Error(`Could not find the "${subHeader}" column under "${groupHeader}" in the "${targetSheetName}" sheet.`);
  };

  const nicknameHeader = findSubHeader('Member', 'Nickname');
  const rakeHeader = findSubHeader('Rake&Fee', 'Total');
  // Header cells can be merged vertically, so data starts below the lowest header row
  const firstDataRow = Math.max(nicknameHeader.row, rakeHeader.row) + 1;

  const players: MemberStatistic[] = [];
  const seen = new Set<string>();
  for (let r = firstDataRow; r <= range.e.r; r++) {
    const row = rows[r - range.s.r] ?? [];
    if (row.some(cell => normalizeHeader(cell) === 'total')) break;

    const nickname = String(cellAt(r, nicknameHeader.col) ?? '').trim();
    if (!nickname || nickname === '-') continue;

    const key = nickname.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      players.push({ nickname, rake: parseNumber(cellAt(r, rakeHeader.col)) });
    }
  }

  return players;
};

// Number of columns in the main (positive/negative) tables
const MAIN_TABLE_COLUMN_COUNT = 11;
// The owners table sits to the right of the main table, with one empty column in between
const OWNERS_TABLE_COLUMN_INDEX = MAIN_TABLE_COLUMN_COUNT + 1;
const OWNERS_TABLE_HEADERS = ['Nickname', 'Line', 'Chips', 'Rake', 'Profit/Loss', 'Rake share', 'Ny Saldo', 'uttak sum', 'ruller', 'claima chips', 'satt opp'];
// The stats table sits to the right of the owners table, with one empty column in between
const STATS_TABLE_COLUMN_INDEX = OWNERS_TABLE_COLUMN_INDEX + OWNERS_TABLE_HEADERS.length + 1;
const STATS_TABLE_ROW_COUNT = 2; // Header + values
const STATS_TABLE_COLUMN_COUNT = 3; // Brutto Rake, Netto Rake, Ekstra utgifter

const BALANCE_SHEET_NAME = 'Club Member Balance';

/**
 * Read the "Club Member Balance" rows, without the first 3 rows
 */
const getBalanceRows = (workbook: XLSX.WorkBook): unknown[][] => {
  if (!workbook.SheetNames.includes(BALANCE_SHEET_NAME)) {
    throw new Error(`Sheet "${BALANCE_SHEET_NAME}" not found in the uploaded file.`);
  }
  const jsonData: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[BALANCE_SHEET_NAME], {
    header: 1,
    defval: ''
  });
  return jsonData.slice(3);
};

/**
 * Find the entered nickname matching a "Club Member Balance" row: column K must start
 * with the nickname (case-insensitive prefix match)
 */
const findMatchingNickname = (row: unknown[], nicknames: NicknameWithLine[]): NicknameWithLine | undefined => {
  const columnK = row[10] ? String(row[10]).toLowerCase() : '';
  return nicknames.find(nicknameObj => columnK.startsWith(nicknameObj.nickname.toLowerCase()));
};

/**
 * Find the entered nicknames that have no row in the "Club Member Balance" sheet.
 * These players are added to the generated document with 0 chips.
 */
export const findPlayersMissingFromBalance = (
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[]
): NicknameWithLine[] => {
  const matched = new Set<NicknameWithLine>();
  getBalanceRows(workbook).forEach(row => {
    const match = findMatchingNickname(row, nicknames);
    if (match) matched.add(match);
  });
  return nicknames.filter(n => !matched.has(n));
};

/**
 * Filter Excel workbook based on nicknames
 * - Only processes the "Club Member Balance" sheet
 * - Removes first 3 rows
 * - Keeps only columns K and L
 * - Filters rows where column K starts with any of the provided nicknames (case-insensitive prefix match)
 * - Players without a "Club Member Balance" row are added with 0 chips, shown as "Left Club?"
 * - Adds "Rake" column (total rake from the "Member Statistics" sheet)
 * - Adds "Rakeback" column (rake * rakeback %)
 * - Adds "Profit/Loss" column (L - line if line exists, otherwise just L, plus rakeback)
 * - Owners are left out of the main table and put in an owners table to the right of it
 *   ("Rake share" = Netto Rake / number of owners, "Ny Saldo" = Profit/Loss + Rake share)
 * - Adds a stats table to the right of the owners table ("Brutto Rake" = sum of all players' rake,
 *   "Netto Rake" = Brutto Rake - sum of all players' rakeback - extra expenses, both including owners,
 *   "Ekstra utgifter" = other club expenses entered by the user)
 */
export const filterWorkbookByNicknames = (
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[],
  memberStatistics: MemberStatistic[] = [],
  extraExpenses = 0
): XLSX.WorkBook => {
  const newWorkbook = XLSX.utils.book_new();
  const targetSheetName = BALANCE_SHEET_NAME;

  const dataWithoutFirstThreeRows = getBalanceRows(workbook);

  // If no nicknames provided, return empty workbook
  if (nicknames.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(newWorkbook, emptySheet, targetSheetName);
    return newWorkbook;
  }

  // Filter and keep only columns K (index 10) and L (index 11), plus add new columns
  const positiveData: any[][] = [];
  const negativeData: any[][] = [];
  const ownerData: unknown[][] = [];
  let bruttoRake = 0;
  let totalRakeback = 0;

  const profitLossIndex = 5;

  const rakeByNickname = new Map(memberStatistics.map(m => [m.nickname.toLowerCase(), m.rake]));
  // Entered nicknames normally match exactly, but fall back to prefix matching like the chips lookup does
  const findRake = (nickname: string): number => {
    const key = nickname.toLowerCase();
    const exact = rakeByNickname.get(key);
    if (exact !== undefined) return exact;
    const prefixMatch = memberStatistics.find(m => m.nickname.toLowerCase().startsWith(key));
    return prefixMatch ? prefixMatch.rake : 0;
  };

  const addPlayerRow = (displayName: unknown, columnL: unknown, matchingNickname: NicknameWithLine, chipsDisplay: unknown = columnL) => {
    const hasLine = matchingNickname.line !== undefined;
    const lineAmount = matchingNickname.line !== undefined ? matchingNickname.line : '';

    const rake = findRake(matchingNickname.nickname);
    const rakeback = matchingNickname.rakeback !== undefined
      ? Math.round(rake * matchingNickname.rakeback) / 100
      : '';

    // Calculate profit/loss
    let profitLoss: number;
    if (hasLine && matchingNickname.line !== undefined) {
      profitLoss = Number(columnL) - matchingNickname.line;
    } else {
      profitLoss = Number(columnL);
    }
    // Rakeback is paid out to the player, so it adds to their profit
    profitLoss += Number(rakeback || 0);

    // Round down to integer (floor for positive, ceil for negative to round towards zero)
    profitLoss = profitLoss >= 0 ? Math.floor(profitLoss) : Math.ceil(profitLoss);

    bruttoRake += rake;
    totalRakeback += Number(rakeback || 0);

    if (matchingNickname.owner) {
      // Rake share and Ny Saldo are filled in once the netto rake is known
      ownerData.push([displayName, lineAmount, chipsDisplay, rake, profitLoss, '', '', '', '', '', '']);
      return;
    }

    const rowData = [displayName, lineAmount, chipsDisplay, rake, rakeback, profitLoss, '', '', '', '', ''];

    // Split into positive and negative arrays
    if (profitLoss >= 0) {
      positiveData.push(rowData);
    } else {
      negativeData.push(rowData);
    }
  };

  dataWithoutFirstThreeRows.forEach((row) => {
    const matchingNickname = findMatchingNickname(row, nicknames);
    if (matchingNickname) {
      addPlayerRow(row[10], row[11] !== undefined ? row[11] : 0, matchingNickname);
    }
  });

  // Players without a "Club Member Balance" row still need to settle their line and rakeback
  findPlayersMissingFromBalance(workbook, nicknames).forEach(missing => {
    addPlayerRow(missing.nickname, 0, missing, 'Left Club?');
  });

  // Sort both arrays by profit/loss (highest first)
  positiveData.sort((a, b) => b[profitLossIndex] - a[profitLossIndex]);
  negativeData.sort((a, b) => b[profitLossIndex] - a[profitLossIndex]);
  const ownerProfitLossIndex = 4;
  ownerData.sort((a, b) => Number(b[ownerProfitLossIndex]) - Number(a[ownerProfitLossIndex]));

  // Add headers for main tables
  const positiveHeaders = ['Nickname', 'Linje', 'Chips', 'Rake', 'Rakeback', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Claima chips', 'satt opp'];
  const negativeHeaders = ['Nickname', 'Linje', 'Chips', 'Rake', 'Rakeback', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Gitt chips', 'satt opp'];

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

  const nettoRake = bruttoRake - totalRakeback - extraExpenses;

  // Owners table to the right of the main table: the netto rake is split evenly between the owners
  const rakeShare = ownerData.length > 0 ? Math.round((nettoRake / ownerData.length) * 100) / 100 : 0;
  ownerData.forEach(row => {
    row[5] = rakeShare;
    row[6] = Math.round((Number(row[ownerProfitLossIndex]) + rakeShare) * 100) / 100;
  });
  [OWNERS_TABLE_HEADERS, ...ownerData].forEach((ownerRow, i) => {
    const row = combinedData[i];
    while (row.length < OWNERS_TABLE_COLUMN_INDEX) row.push('');
    row.push(...ownerRow);
  });

  // Stats table to the right of the owners table
  const statsTable = [
    ['Brutto Rake', 'Netto Rake', 'Ekstra utgifter'],
    [Math.round(bruttoRake * 100) / 100, Math.round(nettoRake * 100) / 100, Math.round(extraExpenses * 100) / 100],
  ];
  statsTable.forEach((statsRow, i) => {
    const row = combinedData[i];
    while (row.length < STATS_TABLE_COLUMN_INDEX) row.push('');
    row.push(...statsRow);
  });

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
    
    // Check if this is part of any transfer table (row with 'Avsender' or 10 rows after it)
    let isTransferTableRow = false;
    transferTableIndices.forEach(startIdx => {
      if (rowIndex >= startIdx && rowIndex < startIdx + 11) { // Header + 10 data rows
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
        const currentTableEnd = startIdx + 11; // Header + 10 rows
        const nextTableStart = transferTableIndices[tableIdx + 1];
        if (rowIndex >= currentTableEnd && rowIndex < nextTableStart) {
          isSeparatorRow = true;
        }
      }
    });
    
    // Process all cells in the row
    for (let colNumber = 1; colNumber <= Math.max(excelRow.cellCount, 20); colNumber++) {
      const cell = excelRow.getCell(colNumber);
      
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
        }
      }
      // Stats table to the right of the owners table
      else if (
        rowIndex < STATS_TABLE_ROW_COUNT &&
        colNumber >= statsTableColumnNumber &&
        colNumber < statsTableColumnNumber + STATS_TABLE_COLUMN_COUNT
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
      // Remove borders and fill for main table rows beyond column 11
      else if (!isSeparatorRow && !isTransferTableRow && colNumber > mainTableColumnCount) {
        cell.border = {};
        (cell as any).fill = null;
      }
    }
  });
  
  // Auto-fit columns based on content
  excelWorksheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? String(cell.value).length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
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
