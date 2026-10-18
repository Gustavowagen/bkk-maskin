import type { SortState } from '../utils/useSort'

interface SortHeaderProps<K extends string> {
  sortKey: K;
  label: string;
  sort: SortState<K>;
  onSort: (key: K) => void;
  numeric?: boolean;
}

/** Table header cell that sorts the table by its column when clicked */
const SortHeader = <K extends string>({ sortKey, label, sort, onSort, numeric = true }: SortHeaderProps<K>) => (
  <th className={numeric ? 'numeric' : undefined} aria-sort={sort.key === sortKey ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
    <button type="button" className="sort-button" onClick={() => onSort(sortKey)}>
      {label}
      <span className="sort-indicator" aria-hidden="true">{sort.key === sortKey ? (sort.descending ? '▼' : '▲') : ''}</span>
    </button>
  </th>
)

export default SortHeader
