import { useEffect, useState } from 'react'
import '../App.css'
import './StatsPage.css'
import { ColumnChart } from '../components/StatsCharts'
import StatTile from '../components/StatTile'
import type { StatDelta } from '../components/StatTile'
import { formatCompact, formatDate, formatFullDate, formatPercent } from '../utils/format'
import { deletePeriod, fetchAgentTotals, fetchLatestPeriodStart, fetchPeriods, fetchPlayerTotals, fetchUploadLog, resetStats } from '../utils/statsApi'
import type { AgentTotalRow, PeriodRow, PlayerTotalRow, UploadLogRow } from '../utils/statsApi'
import PlayersView from './stats/PlayersView'
import AgentsView from './stats/AgentsView'
import UploadLog from './stats/UploadLog'

// Ranges end at the latest stored period, so they are never empty just because nothing was uploaded today.
// Statistics older than a year are deleted every night, so a year is the longest range.
const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

const VIEWS = [
  { id: 'players', label: 'Players' },
  { id: 'agents', label: 'Agents' },
] as const

type View = (typeof VIEWS)[number]['id']

// Up to this many days the rake chart has one column per day, above that one per week
const MAX_DAILY_COLUMNS = 31

interface DateRange {
  from: string;
  to: string;
}

interface RangeData {
  periods: PeriodRow[];
  previousPeriods: PeriodRow[];
  players: PlayerTotalRow[];
  agents: AgentTotalRow[];
}

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

const mondayOf = (isoDate: string) => addDays(isoDate, -((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7))

const totalRakeback = (period: PeriodRow) => period.playerRakeback + period.agentRakeback

const sumBy = <T,>(rows: T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0)

/** Sum the values per day, or per week (labelled by its Monday) when the range is long */
const bucketByDate = <T,>(rows: T[], date: (row: T) => string, value: (row: T) => number, weekly: boolean) => {
  const buckets = new Map<string, number>()
  rows.forEach(row => {
    const key = weekly ? mondayOf(date(row)) : date(row)
    buckets.set(key, (buckets.get(key) ?? 0) + value(row))
  })
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, total]) => ({ key, total }))
}

/**
 * Percent change vs the previous range, or undefined when there is nothing to compare with.
 * `lowerIsBetter` marks a decrease as good (e.g. expenses).
 */
const changeVs = (current: number, previous: number | undefined, label: string, lowerIsBetter = false): StatDelta | undefined => {
  if (previous === undefined || previous === 0) return undefined
  const change = ((current - previous) / Math.abs(previous)) * 100
  return { text: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs prev. ${label}`, good: lowerIsBetter ? change <= 0 : change >= 0 }
}

function StatsPage() {
  const [rangeDays, setRangeDays] = useState(30)
  const [view, setView] = useState<View>('players')
  const [search, setSearch] = useState('')

  // The latest stored period start: undefined while loading, null when nothing is stored yet
  const [latest, setLatest] = useState<string | null | undefined>(undefined)
  const [data, setData] = useState<RangeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadLogRow[]>([])
  // An upload picked in the upload log: the stats then show only its period instead of the range
  const [selectedUpload, setSelectedUpload] = useState<UploadLogRow | null>(null)
  // Bumped after an upload is deleted, to load everything again
  const [reloadKey, setReloadKey] = useState(0)

  const range: DateRange | null = selectedUpload
    ? { from: selectedUpload.periodStart, to: selectedUpload.periodStart }
    : latest ? { from: addDays(latest, -(rangeDays - 1)), to: latest } : null
  // Length of the window, so the previous window to compare with is just as long
  const windowDays = selectedUpload ? daysBetween(selectedUpload.periodStart, selectedUpload.periodEnd) : rangeDays

  useEffect(() => {
    Promise.all([fetchLatestPeriodStart(), fetchUploadLog()])
      .then(([start, log]) => {
        setLatest(start ?? null)
        setUploads(log)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load statistics.'))
  }, [reloadKey])

  useEffect(() => {
    if (!range) return
    let cancelled = false
    Promise.all([
      fetchPeriods(range.from, range.to),
      fetchPeriods(addDays(range.from, -windowDays), addDays(range.from, -1)),
      fetchPlayerTotals(range.from, range.to),
      fetchAgentTotals(range.from, range.to),
    ])
      .then(([periods, previousPeriods, players, agents]) => {
        if (!cancelled) setData({ periods, previousPeriods, players, agents })
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load statistics.')
      })
    return () => {
      cancelled = true
    }
  }, [range?.from, range?.to, windowDays, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectUpload = (upload: UploadLogRow) => {
    setSelectedUpload(current => (current?.id === upload.id ? null : upload))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDeleteUpload = (upload: UploadLogRow) =>
    deletePeriod(upload.id)
      .then(() => {
        if (selectedUpload?.id === upload.id) setSelectedUpload(null)
        setReloadKey(key => key + 1)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete the upload.'))

  // TEMPORARY: reset button, remove together with resetStats and the reset_stats database function
  const handleReset = () => {
    if (!window.confirm('Erase ALL statistics from the database? This cannot be undone.')) return
    resetStats()
      .then(() => {
        setData(null)
        setLatest(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not reset statistics.'))
  }

  const header = (
    <div className="stats-header">
      <h1>Statistics</h1>
      <button type="button" onClick={handleReset} style={{ background: '#c62828', color: '#fff' }}>
        Reset all stats (temporary)
      </button>
    </div>
  )

  if (error) {
    return (
      <div className="app-container stats-page">
        {header}
        <p className="warning-message">⚠️ {error}</p>
      </div>
    )
  }

  if (latest === null) {
    return (
      <div className="app-container stats-page">
        {header}
        <p className="stats-empty">
          No statistics yet. Upload a document in the Machine and click Filter with <strong>Update data</strong> checked.
        </p>
      </div>
    )
  }

  if (!range || !data) {
    return (
      <div className="app-container stats-page">
        {header}
        <div className="players-loading-header stats-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          <span className="info-message">Loading statistics...</span>
        </div>
      </div>
    )
  }

  const rangeLabel = selectedUpload
    ? (windowDays === 1 ? 'day' : `${windowDays} days`)
    : RANGES.find(r => r.days === rangeDays)?.label ?? ''
  const { periods, previousPeriods, players, agents } = data

  const activePlayers = players.filter(p => p.rake !== 0)
  const totalRake = sumBy(periods, p => p.bruttoRake)
  const rakebackSum = sumBy(periods, totalRakeback)
  const clubNet = sumBy(periods, p => p.clubNet)
  const extraExpenses = sumBy(periods, p => p.extraExpenses)
  const hasPrevious = previousPeriods.length > 0
  const previousRake = hasPrevious ? sumBy(previousPeriods, p => p.bruttoRake) : undefined
  const previousRakeback = hasPrevious ? sumBy(previousPeriods, totalRakeback) : undefined
  const previousNet = hasPrevious ? sumBy(previousPeriods, p => p.clubNet) : undefined
  const previousExpenses = hasPrevious ? sumBy(previousPeriods, p => p.extraExpenses) : undefined

  const weekly = daysBetween(range.from, range.to) > MAX_DAILY_COLUMNS
  const rakeChart = bucketByDate(periods, p => p.periodStart, p => p.bruttoRake, weekly)
    .map(({ key, total }) => ({ label: formatDate(key), value: total }))

  const query = search.trim().toLowerCase()

  // Agents and their players are only shown in the Agents view
  const isAgentRelated = (player: PlayerTotalRow) => player.isAgent || player.agent !== ''
  const clubPlayers = players.filter(p => !isAgentRelated(p))
  const agentPlayers = players.filter(isAgentRelated)

  return (
    <div className="app-container stats-page">
      {header}

      <div className="stats-filters">
        <div className="segmented" role="radiogroup" aria-label="Range">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              role="radio"
              aria-checked={!selectedUpload && rangeDays === r.days}
              className={!selectedUpload && rangeDays === r.days ? 'active' : undefined}
              onClick={() => {
                setSelectedUpload(null)
                setRangeDays(r.days)
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        {selectedUpload ? (
          <span className="stats-range selected-period">
            Upload {selectedUpload.fileName || ''}: {formatFullDate(selectedUpload.periodStart)}
            {selectedUpload.periodEnd !== selectedUpload.periodStart && ` – ${formatFullDate(selectedUpload.periodEnd)}`}
            <button type="button" className="upload-cancel" onClick={() => setSelectedUpload(null)}>Show range</button>
          </span>
        ) : (
          <span className="stats-range">{formatFullDate(range.from)} – {formatFullDate(range.to)}</span>
        )}
      </div>

      <div className="stat-tiles stat-tiles-five">
        <StatTile label="Active players" value={String(activePlayers.length)} hint={`${periods.length} day(s) with data`} />
        <StatTile label="Total rake" value={formatCompact(totalRake)} delta={changeVs(totalRake, previousRake, rangeLabel)} />
        <StatTile
          label="Total rakeback"
          value={formatCompact(rakebackSum)}
          delta={changeVs(rakebackSum, previousRakeback, rangeLabel)}
          hint={`${formatPercent(rakebackSum, totalRake)} of rake`}
        />
        <StatTile
          label="Extra expenses"
          value={formatCompact(extraExpenses)}
          delta={changeVs(extraExpenses, previousExpenses, rangeLabel, true)}
          hint={`${formatPercent(extraExpenses, totalRake)} of rake`}
        />
        <StatTile label="Club net" value={formatCompact(clubNet)} delta={changeVs(clubNet, previousNet, rangeLabel)} />
      </div>

      <section className="stats-card">
        <header className="stats-card-header">
          <h3>{weekly ? 'Weekly rake' : 'Daily rake'}</h3>
          <span className="stats-card-subtitle">All players, chips per {weekly ? 'week' : 'day'}</span>
        </header>
        <ColumnChart data={rakeChart} valueLabel="chips" />
      </section>

      <div className="stats-view-bar">
        <div className="view-tabs" role="tablist" aria-label="Statistics view">
          {VIEWS.map(v => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'active' : undefined}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="stats-search"
          placeholder={view === 'players' ? 'Search player or name…' : 'Search agent or name…'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {view === 'players'
        ? <PlayersView key="players" title="Players" players={clubPlayers} range={range} query={query} onError={setError} />
        : (
          <>
            <AgentsView agents={agents} players={agentPlayers} clubRake={totalRake} query={query} />
            <PlayersView key="agent-players" title="Agent players" showAgent players={agentPlayers} range={range} query={query} onError={setError} />
          </>
        )}

      <UploadLog uploads={uploads} selectedId={selectedUpload?.id ?? null} onSelect={selectUpload} onDelete={handleDeleteUpload} />
    </div>
  )
}

export default StatsPage
