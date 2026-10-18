export const formatChips = (value: number): string => Math.round(value).toLocaleString('en-US')

export const formatCompact = (value: number): string => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(Math.round(value))
}

export const signed = (value: number): string => `${value > 0 ? '+' : ''}${formatChips(value)}`

export const profitClass = (value: number): string => (value > 0 ? 'stat-positive' : value < 0 ? 'stat-negative' : '')

export const rakePerHand = (rake: number, hands: number): number => (hands > 0 ? rake / hands : 0)

export const formatRakePerHand = (rake: number, hands: number): string => (hands > 0 ? rakePerHand(rake, hands).toFixed(2) : '–')

export const formatPercent = (part: number, whole: number): string => `${((part / (whole || 1)) * 100).toFixed(1)}%`

export const formatDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const formatFullDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export const formatDateTime = (isoTimestamp: string): string =>
  new Date(isoTimestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
