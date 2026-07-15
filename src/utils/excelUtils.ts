import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type { NicknameWithLine, PlayerStack } from '../types';

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

/**
 * Read name file and extract nickname to real name mapping
 * Looks for "Player overview" sheet with Nick and Name columns
 */
export const readNameFile = async (file: File): Promise<Map<string, string>> => {
  const workbook = await readExcelFile(file);
  const targetSheetName = 'Player overview';
  
  // Check if the target sheet exists
  if (!workbook.SheetNames.includes(targetSheetName)) {
    throw new Error(`Sheet "${targetSheetName}" not found in the name file.`);
  }
  
  const worksheet = workbook.Sheets[targetSheetName];
  
  // Convert sheet to JSON with first row as headers
  const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);
  
  // Create mapping from Nick to Name
  const nameMapping = new Map<string, string>();
  
  jsonData.forEach((row: any) => {
    const nick = row['Nick'] || row['nick'] || row['NICK'];
    const name = row['Name'] || row['name'] || row['NAME'];
    
    if (nick && name) {
      // Store with lowercase key for case-insensitive lookup
      nameMapping.set(String(nick).toLowerCase(), String(name));
    }
  });
  
  return nameMapping;
};

/**
 * Filter Excel workbook based on nicknames
 * - Only processes the "Club Member Balance" sheet
 * - Removes first 3 rows
 * - Keeps only columns K and L
 * - Filters rows where column K starts with any of the provided nicknames (case-insensitive prefix match)
 * - Adds "Name" column with real name from nameMapping
 * - Adds "Has Line" column (Yes/No)
 * - Adds "Profit/Loss" column (L - line if line exists, otherwise just L)
 */
export const filterWorkbookByNicknames = (
  workbook: XLSX.WorkBook,
  nicknames: NicknameWithLine[],
  nameMapping: Map<string, string> = new Map()
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
      
      // The actual nickname from the Excel file (column K)
      const actualNickname = String(row[10]);
      
      // Get real name from mapping (case-insensitive lookup)
      // Try both the actual nickname from Excel and the user-entered nickname
      const realName = nameMapping.get(actualNickname.toLowerCase()) || 
                       nameMapping.get(matchingNickname.nickname.toLowerCase()) || '';
      
      // Calculate profit/loss
      let profitLoss: number;
      if (hasLine && matchingNickname.line !== undefined) {
        profitLoss = Number(columnL) - matchingNickname.line;
      } else {
        profitLoss = Number(columnL);
      }

      // Round down to integer (floor for positive, ceil for negative to round towards zero)
      profitLoss = profitLoss >= 0 ? Math.floor(profitLoss) : Math.ceil(profitLoss);

      const rowData = [row[10], realName, lineAmount, columnL, hasLineValue, profitLoss, '', '', '', '', ''];

      // Split into positive and negative arrays
      if (profitLoss >= 0) {
        positiveData.push(rowData);
      } else {
        negativeData.push(rowData);
      }
    }
  });

  // Sort both arrays by profit/loss (highest first)
  positiveData.sort((a, b) => b[5] - a[5]);
  negativeData.sort((a, b) => b[5] - a[5]);

  // Add headers for main tables
  const positiveHeaders = ['Nickname', 'Name', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Claima chips', 'satt opp'];
  const negativeHeaders = ['Nickname', 'Name', 'Line Amount', 'Chips', 'Has Line', 'Profit/Loss', 'Pm', 'uttak sum', 'ruller', 'Gitt chips', 'satt opp'];
  
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
    
    // Main table column count varies by club (11 for Knekt with Name, 10 for Stvg without) —
    // derive it from the actual header row instead of hardcoding, so this function
    // stays club-agnostic. Transfer table has 5 columns per table (3 tables with
    // 3 empty cells between = 23 columns total), independent of main table width.
    const mainTableColumnCount = data[0]?.length || 11;
    
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
