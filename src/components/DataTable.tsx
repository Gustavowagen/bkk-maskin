import { useState } from 'react'
import type { ReactNode } from 'react'

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  hideSmall?: boolean; // Hidden on narrow screens
  value: (row: T) => number | string; // Sorted by this, and shown when there is no `render`
  render?: (row: T) => ReactNode;
  className?: (row: T) => string | undefined;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort: string;
  initialAscending?: boolean;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
  limit?: number; // Show only the first rows after sorting
}

const formatCell = (value: number | string) =>
  typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value

/**
 * Sortable table. Clicking a column sorts by it (numbers largest first, text A–Z), clicking it again flips
 * the direction. Rows are clickable and keyboard reachable when `onRowClick` is given.
 */
function DataTable<T>({ columns, rows, rowKey, initialSort, initialAscending = false, onRowClick, selectedKey, empty, limit }: DataTableProps<T>) {
  const [sort, setSort] = useState({ key: initialSort, ascending: initialAscending })
  const column = columns.find(c => c.key === sort.key) ?? columns[0]

  const sorted = [...rows].sort((a, b) => {
    const x = column.value(a)
    const y = column.value(b)
    const order = typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' })
    return sort.ascending ? order : -order
  })
  const shown = limit === undefined ? sorted : sorted.slice(0, limit)

  const toggleSort = (c: Column<T>) => setSort(current => current.key === c.key
    ? { key: c.key, ascending: !current.ascending }
    : { key: c.key, ascending: !c.numeric })

  const cellClass = (c: Column<T>, row?: T) =>
    [c.numeric && 'num', c.hideSmall && 'ck-hide-sm', row && c.className?.(row)].filter(Boolean).join(' ') || undefined

  return (
    <div className="ck-tbl-wrap">
      <table className={`ck-tbl${onRowClick ? ' ck-click' : ''}`}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className={cellClass(c)} aria-sort={c.key === sort.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => toggleSort(c)}>
                  {c.label}
                  <span className="ck-sort" aria-hidden="true">{c.key === sort.key ? (sort.ascending ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(row => {
            const key = rowKey(row)
            return (
              <tr
                key={key}
                className={key === selectedKey ? 'ck-sel' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onRowClick(row)
                  }
                } : undefined}
              >
                {columns.map(c => (
                  <td key={c.key} className={cellClass(c, row)}>{c.render ? c.render(row) : formatCell(c.value(row))}</td>
                ))}
              </tr>
            )
          })}
          {shown.length === 0 && empty && (
            <tr><td colSpan={columns.length} className="ck-empty-row">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default DataTable
