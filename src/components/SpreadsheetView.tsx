import React, { useEffect, useRef, useState } from 'react';
import type { PreviewCell, SheetPreview } from '../utils/excelUtils';
import './SpreadsheetView.css';

interface SpreadsheetViewProps {
  sheet: SheetPreview;
}

interface CellPosition {
  row: number;
  col: number;
}

interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

// Excel reads pasted plain text with the system's decimal separator, so numbers use the browser's
const DECIMAL_SEPARATOR = (1.5).toLocaleString().includes(',') ? ',' : '.';

const formatNumber = (value: number) => String(value).replace('.', DECIMAL_SEPARATOR);

const cellText = (cell: PreviewCell) =>
  cell.value === null ? '' : typeof cell.value === 'number' ? formatNumber(cell.value) : cell.value;

/** Column letters as in Excel: A, B, ..., Z, AA, AB, ... */
const columnLetter = (index: number): string => {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const normalizeRange = (anchor: CellPosition, focus: CellPosition): Range => ({
  top: Math.min(anchor.row, focus.row),
  left: Math.min(anchor.col, focus.col),
  bottom: Math.max(anchor.row, focus.row),
  right: Math.max(anchor.col, focus.col),
});

/** Excel width in characters to pixels (Calibri 11) */
const widthToPixels = (width: number) => Math.round(width * 7 + 5);

/**
 * Plain text (tab separated) and HTML for a range. Excel uses the HTML when pasting, which keeps
 * borders, bold headers and fills; x:num gives it the exact number regardless of locale.
 */
const buildClipboardData = (sheet: SheetPreview, range: Range): { text: string; html: string } => {
  const textRows: string[] = [];
  const htmlRows: string[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    const textCells: string[] = [];
    const htmlCells: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      const cell = sheet.rows[r][c];
      textCells.push(cellText(cell));
      // A merged cell is only kept merged when it is fully inside the copied range
      if (cell.covered && c > range.left) continue;
      const colSpan = Math.min(cell.colSpan, range.right - c + 1);
      const styles = [
        'mso-number-format:General',
        cell.bordered ? 'border:.5pt solid windowtext' : '',
        cell.bold ? 'font-weight:700' : '',
        cell.fontSize ? `font-size:${cell.fontSize}pt` : '',
        cell.fill ? `background:${cell.fill}` : '',
        cell.center ? 'text-align:center' : '',
      ].filter(Boolean).join(';');
      const attributes = [
        `style="${styles}"`,
        colSpan > 1 ? `colspan="${colSpan}"` : '',
        typeof cell.value === 'number' ? `x:num="${cell.value}"` : '',
      ].filter(Boolean).join(' ');
      const value = cell.covered ? '' : escapeHtml(cellText(cell));
      htmlCells.push(`<td ${attributes}>${value}</td>`);
      c += colSpan - 1;
    }
    textRows.push(textCells.join('\t'));
    htmlRows.push(`<tr>${htmlCells.join('')}</tr>`);
  }
  const cols = sheet.columnWidths
    .slice(range.left, range.right + 1)
    .map(width => `<col width="${widthToPixels(width)}">`)
    .join('');
  const html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<head><meta charset="utf-8"></head><body>' +
    `<table style="border-collapse:collapse">${cols}${htmlRows.join('')}</table>` +
    '</body></html>';
  return { text: textRows.join('\r\n'), html };
};

/**
 * Write to the clipboard with both formats. Falls back to a copy event when the async clipboard API is missing.
 */
const writeClipboard = async ({ text, html }: { text: string; html: string }): Promise<void> => {
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return;
  }
  const onCopy = (e: ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', text);
    e.clipboardData?.setData('text/html', html);
  };
  document.addEventListener('copy', onCopy);
  try {
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    document.removeEventListener('copy', onCopy);
  }
};

const SpreadsheetView: React.FC<SpreadsheetViewProps> = ({ sheet }) => {
  const rowCount = sheet.rows.length;
  const columnCount = sheet.columnWidths.length;
  const [anchor, setAnchor] = useState<CellPosition>({ row: 0, col: 0 });
  const [focus, setFocus] = useState<CellPosition>({ row: 0, col: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const messageTimeoutRef = useRef<number | undefined>(undefined);

  const range = normalizeRange(anchor, focus);
  const isAllSelected = range.top === 0 && range.left === 0 && range.bottom === rowCount - 1 && range.right === columnCount - 1;

  // While dragging, follow the pointer anywhere on the page and scroll the grid when it is near or past an edge,
  // so a selection can extend beyond the visible part of the sheet
  useEffect(() => {
    const grid = gridRef.current;
    if (!isDragging || !grid) return;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;

    const visibleArea = () => {
      const rect = grid.getBoundingClientRect();
      const headerHeight = grid.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const rowHeaderWidth = grid.querySelector('tbody th')?.getBoundingClientRect().width ?? 0;
      return {
        left: rect.left + grid.clientLeft + rowHeaderWidth,
        top: rect.top + grid.clientTop + headerHeight,
        right: rect.left + grid.clientLeft + grid.clientWidth,
        bottom: rect.top + grid.clientTop + grid.clientHeight,
      };
    };

    // Select up to the cell under the pointer, or the nearest visible cell when the pointer is outside the grid
    const updateFocus = () => {
      if (!pointer) return;
      const area = visibleArea();
      const x = Math.min(Math.max(pointer.x, area.left + 1), area.right - 2);
      const y = Math.min(Math.max(pointer.y, area.top + 1), area.bottom - 2);
      const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('td[data-cell]');
      if (!cell || !grid.contains(cell)) return;
      const [row, col] = cell.dataset.cell!.split('-').map(Number);
      setFocus(f => (f.row === row && f.col === col ? f : { row, col }));
    };

    // Scroll speed grows the further the pointer is past the edge zone
    const EDGE = 30;
    const speed = (position: number, start: number, end: number) => {
      if (position < start + EDGE) return -Math.min(40, Math.ceil((start + EDGE - position) / 3));
      if (position > end - EDGE) return Math.min(40, Math.ceil((position - (end - EDGE)) / 3));
      return 0;
    };

    const tick = () => {
      if (pointer) {
        const area = visibleArea();
        const dx = speed(pointer.x, area.left, area.right);
        const dy = speed(pointer.y, area.top, area.bottom);
        if (dx !== 0 || dy !== 0) {
          const { scrollLeft, scrollTop } = grid;
          grid.scrollBy(dx, dy);
          if (grid.scrollLeft !== scrollLeft || grid.scrollTop !== scrollTop) updateFocus();
        }
      }
      frame = requestAnimationFrame(tick);
    };

    const handleMouseMove = (e: MouseEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      updateFocus();
    };
    const stopDragging = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDragging);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDragging);
      cancelAnimationFrame(frame);
    };
  }, [isDragging]);

  useEffect(() => () => window.clearTimeout(messageTimeoutRef.current), []);

  const showMessage = (message: string) => {
    setCopyMessage(message);
    window.clearTimeout(messageTimeoutRef.current);
    messageTimeoutRef.current = window.setTimeout(() => setCopyMessage(null), 2500);
  };

  const cellCountText = (r: Range) => {
    const count = (r.bottom - r.top + 1) * (r.right - r.left + 1);
    return count === 1 ? '1 cell' : `${count} cells`;
  };

  const copyRange = async (r: Range) => {
    try {
      await writeClipboard(buildClipboardData(sheet, r));
      showMessage(`✓ Copied ${cellCountText(r)}. Paste into Excel with Ctrl+V.`);
    } catch (error) {
      console.error('Error copying cells:', error);
      showMessage('Could not copy to the clipboard. Try selecting cells and pressing Ctrl+C.');
    }
  };

  const selectAll = () => {
    setAnchor({ row: 0, col: 0 });
    setFocus({ row: rowCount - 1, col: columnCount - 1 });
  };

  const handleCellMouseDown = (e: React.MouseEvent, position: CellPosition) => {
    if (e.button !== 0) return;
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    if (!e.shiftKey) setAnchor(position);
    setFocus(position);
    setIsDragging(true);
  };

  const handleColumnMouseDown = (e: React.MouseEvent, col: number) => {
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    if (!e.shiftKey) setAnchor({ row: 0, col });
    else setAnchor(a => ({ row: 0, col: a.col }));
    setFocus({ row: rowCount - 1, col });
  };

  const handleRowMouseDown = (e: React.MouseEvent, row: number) => {
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    if (!e.shiftKey) setAnchor({ row, col: 0 });
    else setAnchor(a => ({ row: a.row, col: 0 }));
    setFocus({ row, col: columnCount - 1 });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const next = {
      row: Math.min(rowCount - 1, Math.max(0, focus.row + move[0])),
      col: Math.min(columnCount - 1, Math.max(0, focus.col + move[1])),
    };
    if (!e.shiftKey) setAnchor(next);
    setFocus(next);
    gridRef.current
      ?.querySelector(`[data-cell="${next.row}-${next.col}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Ctrl+C on the grid: the native copy event is synchronous, so it works without clipboard permissions
  const handleCopy = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const { text, html } = buildClipboardData(sheet, range);
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
    showMessage(`✓ Copied ${cellCountText(range)}. Paste into Excel with Ctrl+V.`);
  };

  const isSelected = (row: number, col: number, colSpan: number) =>
    row >= range.top && row <= range.bottom && col + colSpan - 1 >= range.left && col <= range.right;

  return (
    <div className="spreadsheet">
      <div className="spreadsheet-toolbar">
        <span className="spreadsheet-hint">
          Click and drag to select cells (Shift+click to extend, Ctrl+A for all), then Ctrl+C and paste into Excel.
        </span>
        <div className="spreadsheet-actions">
          <button
            type="button"
            className="spreadsheet-button spreadsheet-button-primary"
            onClick={() => {
              const all = { top: 0, left: 0, bottom: rowCount - 1, right: columnCount - 1 };
              selectAll();
              copyRange(all);
            }}
          >
            Copy all
          </button>
        </div>
      </div>
      <div className="spreadsheet-status" aria-live="polite">
        <span className="spreadsheet-name-box">
          {columnLetter(range.left)}{range.top + 1}
          {(range.bottom !== range.top || range.right !== range.left) && `:${columnLetter(range.right)}${range.bottom + 1}`}
        </span>
        {copyMessage && <span className="spreadsheet-copy-message">{copyMessage}</span>}
      </div>
      <div
        ref={gridRef}
        className="spreadsheet-grid"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onCopy={handleCopy}
      >
        <table>
          <colgroup>
            <col style={{ width: 44 }} />
            {sheet.columnWidths.map((width, i) => (
              <col key={i} style={{ width: widthToPixels(width) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className={`spreadsheet-corner${isAllSelected ? ' spreadsheet-header-active' : ''}`}
                onMouseDown={e => {
                  e.preventDefault();
                  gridRef.current?.focus({ preventScroll: true });
                  selectAll();
                }}
                title="Select all"
              />
              {sheet.columnWidths.map((_, col) => (
                <th
                  key={col}
                  className={col >= range.left && col <= range.right ? 'spreadsheet-header-active' : undefined}
                  onMouseDown={e => handleColumnMouseDown(e, col)}
                >
                  {columnLetter(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th
                  className={r >= range.top && r <= range.bottom ? 'spreadsheet-header-active' : undefined}
                  onMouseDown={e => handleRowMouseDown(e, r)}
                >
                  {r + 1}
                </th>
                {row.map((cell, c) => {
                  if (cell.covered) return null;
                  const selected = isSelected(r, c, cell.colSpan);
                  const isFocus = focus.row === r && focus.col >= c && focus.col < c + cell.colSpan;
                  const className = [
                    cell.bordered && 'cell-bordered',
                    typeof cell.value === 'number' && 'cell-number',
                    cell.center && 'cell-center',
                    selected && 'cell-selected',
                    isFocus && 'cell-focus',
                  ].filter(Boolean).join(' ');
                  return (
                    <td
                      key={c}
                      data-cell={`${r}-${c}`}
                      colSpan={cell.colSpan}
                      className={className || undefined}
                      style={{
                        fontWeight: cell.bold ? 700 : undefined,
                        fontSize: cell.fontSize && cell.fontSize !== 11 ? `${cell.fontSize}pt` : undefined,
                        background: cell.fill,
                      }}
                      onMouseDown={e => handleCellMouseDown(e, { row: r, col: c })}
                    >
                      {cellText(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SpreadsheetView;
