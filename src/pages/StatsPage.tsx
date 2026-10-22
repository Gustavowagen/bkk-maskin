import { useCallback, useEffect, useState } from 'react'
import './StatsPage.css'
import { formatUtcOffset } from '../utils/clock'
import type { Clock } from '../utils/clock'
import { formatChips, formatFullDate, formatShare } from '../utils/format'
import {
  deletePeriod, fetchAgentTotals, fetchLatestPeriodStart, fetchPeriods, fetchPlayerTotals, fetchRingSessions, fetchTournaments,
  fetchUploadLog, resetStats,
} from '../utils/statsApi'
import type { UploadLogRow } from '../utils/statsApi'
import AgentsTab from './stats/AgentsTab'
import { addDays, daysBetween, gamesOf, periodTotals, sumBy } from './stats/metrics'
import OverviewTab from './stats/OverviewTab'
import PlayersTab from './stats/PlayersTab'
import ProfileTab from './stats/ProfileTab'
import TablesTab from './stats/TablesTab'
import TournamentTab from './stats/TournamentTab'
import { hasPlayed } from './stats/types'
import type { DateRange, StatsData } from './stats/types'
import UploadLog from './stats/UploadLog'

// Ranges end at the latest stored period, so they are never empty just because nothing was uploaded today.
// Statistics older than a year are deleted every night, so a year is the longest range.
const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tables', label: 'Tables' },
  { id: 'players', label: 'Players' },
  { id: 'profile', label: 'Player profile' },
  { id: 'agents', label: 'Agents' },
  { id: 'tournament', label: 'Tournament' },
] as const

type Tab = (typeof TABS)[number]['id']

// Up to this many days the charts have one column per night, above that one per week
const MAX_DAILY_COLUMNS = 31
// The takeaway names the share of rake paid by this many players
const TOP_PAYERS = 10

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

function StatsPage() {
  const [rangeDays, setRangeDays] = useState(30)
  const [tab, setTab] = useState<Tab>('overview')
  const [clock, setClock] = useState<Clock>('oslo')
  const [player, setPlayer] = useState<string | null>(null)
  const [agent, setAgent] = useState<string | null>(null)

  // The latest stored period start: undefined while loading, null when nothing is stored yet
  const [latest, setLatest] = useState<string | null | undefined>(undefined)
  const [data, setData] = useState<StatsData | null>(null)
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
  const rangeLabel = selectedUpload
    ? (windowDays === 1 ? 'day' : `${windowDays} days`)
    : RANGES.find(r => r.days === rangeDays)?.label ?? ''

  useEffect(() => {
    Promise.all([fetchLatestPeriodStart(), fetchUploadLog()])
      .then(([start, log]) => {
        setLatest(start ?? null)
        setUploads(log)
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Could not load statistics.')))
  }, [reloadKey])

  useEffect(() => {
    if (!range) return
    let cancelled = false
    Promise.all([
      fetchPeriods(range.from, range.to),
      fetchPeriods(addDays(range.from, -windowDays), addDays(range.from, -1)),
      fetchPlayerTotals(range.from, range.to),
      fetchAgentTotals(range.from, range.to),
      fetchRingSessions(range.from, range.to),
      fetchTournaments(range.from, range.to),
    ])
      .then(([periods, previousPeriods, players, agents, sessions, tournaments]) => {
        if (cancelled) return
        const firstDay = periods[0]?.periodStart ?? range.from
        const lastDay = periods.reduce((last, p) => (p.periodEnd > last ? p.periodEnd : last), range.to)
        setData({
          range, firstDay, lastDay, weekly: daysBetween(firstDay, lastDay) > MAX_DAILY_COLUMNS, rangeLabel,
          periods, previousPeriods, players, agents, sessions, tournaments,
        })
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, 'Could not load statistics.'))
      })
    return () => {
      cancelled = true
    }
  }, [range?.from, range?.to, windowDays, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const openPlayer = useCallback((nickname: string) => {
    setPlayer(nickname)
    setTab('profile')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const openAgent = useCallback((name: string) => {
    setAgent(name)
    setTab('agents')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

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
      .catch((e: unknown) => setError(errorMessage(e, 'Could not delete the upload.')))

  // TEMPORARY: reset button, remove together with resetStats and the reset_stats database function
  const handleReset = () => {
    if (!window.confirm('Erase ALL statistics from the database? This cannot be undone.')) return
    resetStats()
      .then(() => {
        setData(null)
        setLatest(null)
        setUploads([])
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Could not reset statistics.')))
  }

  const latestPeriod = data?.periods[data.periods.length - 1]
  const exportOffset = latestPeriod?.utcOffsetMinutes ?? -420
  const clubName = [...(data?.periods ?? [])].reverse().find(p => p.clubName)?.clubName

  const title = data
    ? `${clubName ?? 'Statistics'} · ${formatFullDate(data.firstDay)}${data.lastDay !== data.firstDay ? ` – ${formatFullDate(data.lastDay)}` : ''}`
    : 'Statistics'

  const takeaway = (() => {
    if (!data || data.periods.length === 0) return null
    const money = periodTotals(data.periods)
    const active = data.players.filter(hasPlayed).length
    const topGame = gamesOf(data.sessions)[0]
    const ringRake = sumBy(data.sessions, s => s.rake)
    const topGameRake = topGame ? sumBy(data.sessions.filter(s => s.game === topGame.game), s => s.rake) : 0
    const topPayers = sumBy([...data.players].sort((a, b) => b.rake - a.rake).slice(0, TOP_PAYERS), p => p.rake)
    return (
      <p className="ck-sub">
        <b>{formatChips(money.brutto)}</b> brutto rake from <b>{active}</b> active players, of which the club keeps{' '}
        <b>{formatChips(money.netto)}</b> netto after rakeback, agent rake share and ekstra utgifter.
        {topGame && ringRake > 0 && <> {topGame.game} tables brought in <b>{formatShare(topGameRake / ringRake)}</b> of ring rake,</>}
        {' '}{topGame && ringRake > 0 ? 'and the' : 'The'} {TOP_PAYERS} biggest payers account for <b>{formatShare(topPayers / (money.brutto || 1))}</b> of all rake.
      </p>
    )
  })()

  const tabProps = data ? { data, clock, openPlayer, openAgent, onError: setError } : null

  return (
    <div className="stats-page">
      <div className="ck">
        <header className="ck-head">
          <div>
            <h1 className="ck-title">{title}</h1>
            {takeaway}
          </div>
          <div className="ck-seg" role="group" aria-label="Clock">
            <button type="button" aria-pressed={clock === 'oslo'} onClick={() => setClock('oslo')}>Oslo time</button>
            <button type="button" aria-pressed={clock === 'export'} onClick={() => setClock('export')}>Export time ({formatUtcOffset(exportOffset)})</button>
          </div>
        </header>

        <div className="ck-filters">
          <div className="ck-seg" role="radiogroup" aria-label="Range">
            {RANGES.map(r => (
              <button
                key={r.days}
                type="button"
                role="radio"
                aria-checked={!selectedUpload && rangeDays === r.days}
                aria-pressed={!selectedUpload && rangeDays === r.days}
                onClick={() => {
                  setSelectedUpload(null)
                  setRangeDays(r.days)
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          {selectedUpload && (
            <span className="ck-range">
              Upload {selectedUpload.fileName || ''}
              <button type="button" className="ck-linkbtn" onClick={() => setSelectedUpload(null)}>Show range</button>
            </span>
          )}
          <button type="button" className="ck-reset" onClick={handleReset}>Reset all stats (temporary)</button>
        </div>

        <nav className="ck-tabs" role="tablist" aria-label="Sections">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>

        {error ? (
          <p className="ck-callout ck-callout-bad">⚠️ {error}</p>
        ) : latest === null ? (
          <p className="ck-empty">
            No statistics yet. Upload a document in the Machine and click Filter with <strong>Update data</strong> checked.
          </p>
        ) : !tabProps ? (
          <div className="ck-loading" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            <span>Loading statistics...</span>
          </div>
        ) : (
          <>
            {tab === 'overview' && <OverviewTab {...tabProps} />}
            {tab === 'tables' && <TablesTab {...tabProps} />}
            {tab === 'players' && <PlayersTab {...tabProps} />}
            {tab === 'profile' && <ProfileTab {...tabProps} nickname={player} onSelectPlayer={setPlayer} />}
            {tab === 'agents' && <AgentsTab {...tabProps} agent={agent} onSelectAgent={setAgent} />}
            {tab === 'tournament' && <TournamentTab {...tabProps} />}
          </>
        )}

        {uploads.length > 0 && (
          <UploadLog uploads={uploads} selectedId={selectedUpload?.id ?? null} onSelect={selectUpload} onDelete={handleDeleteUpload} />
        )}
      </div>
    </div>
  )
}

export default StatsPage
