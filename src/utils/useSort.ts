import { useState } from 'react'

export interface SortState<K extends string> {
  key: K;
  descending: boolean;
}

/**
 * Sort state for a table. Clicking a new column sorts it descending (ascending for `textKey`),
 * clicking the same column again flips the direction.
 */
export const useSort = <K extends string>(initial: K, textKey?: K) => {
  const [sort, setSort] = useState<SortState<K>>({ key: initial, descending: initial !== textKey })
  const toggleSort = (key: K) =>
    setSort(current => (current.key === key ? { key, descending: !current.descending } : { key, descending: key !== textKey }))
  return { sort, toggleSort }
}
