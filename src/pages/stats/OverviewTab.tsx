import DataTable from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import StatTile from '../../components/StatTile'
import type { StatDelta } from '../../components/StatTile'
import { ChartEmpty, ColumnChart, Heatmap, Legend } from '../../components/StatsCharts'
import type { ColumnDatum, HeatmapCell } from '../../components/StatsCharts'
import { WEEKDAYS, clockName, formatNightLong, formatNightShort } from '../../utils/clock'
import { formatAmount, formatChips, formatDate, formatPercent, signedAmount } from '../../utils/format'
import { gamesOf, mondayOf, nightsInRange, openTablesByHour, periodTotals, rakeByNight, resultsByStake, sumBy, timeSessions } from './metrics'
import type { StakeRow } from './metrics'
import { hasPlayed } from './types'
import type { TabProps } from './types'

/**
 * Percent change vs the previous range, or undefined when there is nothing to compare with.
 * `lowerIsBetter` marks a decrease as good (e.g. expenses).
 */
const changeVs = (current: number, previous: number | undefined, label: string, lowerIsBetter = false): StatDelta | undefined => {
  if (previous === undefined || previous === 0) return undefined
  const change = ((current - previous) / Math.abs(previous)) * 100
  return { text: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs prev. ${label}`, good: lowerIsBetter ? change <= 0 : change >= 0 }
}

// Hours of a night, from 06:00 to 05:00
const SLOT_LABELS = Array.from({ length: 24 }, (_, slot) => String((slot + 6) % 24).padStart(2, '0'))

const stakeColumns = (maxRake: number): Column<StakeRow>[] => [
  { key: 'stake', label: 'Stake', value: r => r.stake },
  { key: 'sessions', label: 'Sessions', numeric: true, value: r => r.sessions },
  { key: 'hours', label: 'Hours', numeric: true, hideSmall: true, value: r => Math.round(r.hours * 10) / 10 },
  { key: 'avgPlayers', label: 'Avg players', numeric: true, hideSmall: true, value: r => Math.round(r.avgPlayers * 10) / 10 },
  { key: 'hands', label: 'Hands', numeric: true, hideSmall: true, value: r => r.hands },
  { key: 'rakePerHour', label: 'Rake / hour', numeric: true, value: r => Math.round(r.rakePerHour) },
  {
    key: 'rake', label: 'Rake', numeric: true, value: r => r.rake,
    render: r => (
      <span className="ck-bar"><i style={{ width: Math.round((r.rake / (maxRake || 1)) * 80) }} />{formatAmount(r.rake)}</span>
    ),
  },
]

function OverviewTab({ data, clock }: TabProps) {
  const { periods, previousPeriods, players, sessions, weekly, rangeLabel } = data
  const money = periodTotals(periods)
  const previous = previousPeriods.length > 0 ? periodTotals(previousPeriods) : undefined

  const ringRake = sumBy(sessions, s => s.rake)
  const tableHours = sumBy(sessions, s => s.minutes) / 60
  const ringHands = sumBy(sessions, s => s.hands)
  const activePlayers = players.filter(hasPlayed).length
  const memberCount = Math.max(0, ...periods.map(p => p.memberCount))

  const timed = timeSessions(sessions, clock)
  const games = gamesOf(sessions)
  const nights = nightsInRange(data.firstDay, data.lastDay, weekly)
  const bucketLabel = (key: string) => (weekly ? formatDate(key) : formatNightShort(key))

  // Ring rake per night split by game; without session data, the brutto rake per upload instead
  const rakeChart: ColumnDatum[] = sessions.length > 0
    ? (() => {
      const buckets = new Map(rakeByNight(timed, weekly).map(b => [b.key, b]))
      return nights.map(key => {
        const bucket = buckets.get(key)
        return {
          key,
          label: bucketLabel(key),
          title: weekly ? `Week of ${formatDate(key)}` : formatNightLong(key),
          values: Object.fromEntries(games.map(g => [g.game, bucket?.byGame[g.game]?.rake ?? 0])),
          lines: [
            ...games.map(g => ({
              color: g.color,
              label: `${g.game} · ${bucket?.byGame[g.game]?.sessions ?? 0} sessions`,
              value: formatChips(bucket?.byGame[g.game]?.rake ?? 0),
            })),
            { label: 'Total', value: formatChips(bucket?.total ?? 0) },
          ],
        }
      })
    })()
    : (() => {
      const byKey = new Map<string, number>()
      periods.forEach(p => {
        const key = weekly ? mondayOf(p.periodStart) : p.periodStart
        byKey.set(key, (byKey.get(key) ?? 0) + p.bruttoRake)
      })
      return nights.map(key => ({
        key,
        label: bucketLabel(key),
        title: weekly ? `Week of ${formatDate(key)}` : formatNightLong(key),
        values: { brutto: byKey.get(key) ?? 0 },
        lines: [{ label: 'Brutto rake', value: formatChips(byKey.get(key) ?? 0) }],
      }))
    })()

  const heatCells: HeatmapCell[] = openTablesByHour(timed).map(cell => {
    const hour = (cell.slot + 6) % 24
    return {
      row: cell.weekday,
      col: cell.slot,
      value: cell.tables,
      title: `${WEEKDAYS[cell.weekday]} night · ${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
      lines: [{ label: 'Tables open on average', value: cell.tables.toFixed(1) }],
    }
  })
  // Only the hours where any table ran, like the reference
  const usedSlots = heatCells.map(c => c.col)
  const firstSlot = Math.min(...usedSlots)
  const lastSlot = Math.max(...usedSlots)
  const heatColumns = heatCells.length > 0 ? SLOT_LABELS.slice(firstSlot, lastSlot + 1) : []
  const shiftedCells = heatCells.map(c => ({ ...c, col: c.col - firstSlot }))
  const busiest = Math.max(0, ...heatCells.map(c => c.value))

  const stakes = resultsByStake(sessions)

  const split = [
    { label: 'Brutto rake', value: money.brutto, kind: 'total' },
    { label: 'Player rakeback', value: -money.playerRakeback, kind: 'cost' },
    { label: 'Agent rake share', value: -money.agentRakeback, kind: 'cost' },
    { label: 'Ekstra utgifter', value: -money.extraExpenses, kind: 'cost' },
    { label: 'Netto rake', value: money.netto, kind: 'result' },
  ]
  const splitMax = Math.max(1, ...split.map(s => Math.abs(s.value)))

  return (
    <section className="ck-page">
      <div className="ck-kpis">
        <StatTile label="Brutto rake" value={formatChips(money.brutto)} delta={changeVs(money.brutto, previous?.brutto, rangeLabel)} hint="All entered players' rake" />
        <StatTile
          label="Netto rake"
          value={formatChips(money.netto)}
          tone={money.netto < 0 ? -1 : 0}
          delta={changeVs(money.netto, previous?.netto, rangeLabel)}
          hint={`${formatPercent(money.netto, money.brutto)} of brutto, kept by the club`}
        />
        <StatTile
          label="Player rakeback"
          value={formatChips(money.playerRakeback)}
          delta={changeVs(money.playerRakeback, previous?.playerRakeback, rangeLabel, true)}
          hint={`${formatPercent(money.playerRakeback, money.brutto)} of brutto`}
        />
        <StatTile
          label="Agent rake share"
          value={formatChips(money.agentRakeback)}
          delta={changeVs(money.agentRakeback, previous?.agentRakeback, rangeLabel, true)}
          hint={`${formatPercent(money.agentRakeback, money.brutto)} of brutto`}
        />
        <StatTile
          label="Ekstra utgifter"
          value={formatChips(money.extraExpenses)}
          delta={changeVs(money.extraExpenses, previous?.extraExpenses, rangeLabel, true)}
          hint={`${formatPercent(money.extraExpenses, money.brutto)} of brutto`}
        />
        <StatTile
          label="Bad beat jackpot"
          value={formatChips(money.bbjContribution)}
          delta={changeVs(money.bbjContribution, previous?.bbjContribution, rangeLabel)}
          hint={`Contributed · ${formatChips(money.bbjPayout)} paid out`}
        />
      </div>

      <div className="ck-kpis">
        <StatTile label="Ring sessions" value={formatChips(sessions.length)} hint="Tables opened" />
        <StatTile label="Table hours" value={formatChips(tableHours)} hint="Sum of session lengths" />
        <StatTile label="Rake per table hour" value={tableHours > 0 ? formatChips(ringRake / tableHours) : '–'} hint="Ring rake ÷ table hours" />
        <StatTile label="Hands played" value={formatChips(sessions.length > 0 ? ringHands : money.hands)} hint={sessions.length > 0 ? 'Ring, counted per seat' : 'All games'} />
        <StatTile label="Active players" value={String(activePlayers)} hint={memberCount > 0 ? `of ${memberCount} members` : `${periods.length} upload(s)`} />
      </div>

      {sessions.length === 0 && (
        <p className="ck-callout">
          No table data for this range yet. Tables, sessions and tournaments are saved from uploads made after this update,
          so upload the files again in the Machine (with <strong>Update data</strong> checked) to fill them in.
        </p>
      )}

      <div className="ck-grid">
        <div className="ck-card">
          <h3>{sessions.length > 0 ? `Ring rake per ${weekly ? 'week' : 'night'}` : `Brutto rake per ${weekly ? 'week' : 'day'}`}</h3>
          <p className="ck-note">
            {sessions.length > 0
              ? `Each session counts on the night it opened (${clockName(clock)}). Hover a bar for the split.`
              : 'Rake of all entered players per upload.'}
          </p>
          {sessions.length > 0 && <Legend items={games.map(g => ({ label: g.game, color: g.color }))} />}
          <ColumnChart
            data={rakeChart}
            series={sessions.length > 0 ? games.map(g => ({ key: g.game, label: g.game, color: g.color })) : [{ key: 'brutto', label: 'Brutto rake', color: '#3b6ea8' }]}
          />
        </div>

        <div className="ck-card">
          <h3>When the tables run</h3>
          <p className="ck-note">Average number of tables open in each hour, by night of the week. Hours after midnight belong to the night before.</p>
          {heatCells.length > 0 ? (
            <>
              <Heatmap rows={WEEKDAYS} columns={heatColumns} cells={shiftedCells} color="#3b6ea8" />
              <p className="ck-note ck-note-after">Hours shown in {clockName(clock)}. Darkest cell: {busiest.toFixed(1)} tables.</p>
            </>
          ) : <ChartEmpty>No table data for this range.</ChartEmpty>}
        </div>

        <div className="ck-card">
          <h3>Where the rake goes</h3>
          <p className="ck-note">Netto rake is brutto rake minus player rakeback, the agents' rake share and ekstra utgifter.</p>
          <div className="ck-split-bars">
            {split.map(s => (
              <div key={s.label} className={`ck-split-row ${s.kind}`}>
                <span className="ck-split-label">{s.label}</span>
                <span className="ck-split-track">
                  <i style={{ width: `${(Math.abs(s.value) / splitMax) * 100}%` }} />
                </span>
                <span className={`ck-split-value${s.kind === 'result' && s.value < 0 ? ' ck-neg' : ''}`}>
                  {s.kind === 'cost' ? signedAmount(s.value) : formatAmount(s.value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="ck-card">
          <h3>Bad beat jackpot</h3>
          <p className="ck-note">Contribution fees and payouts of every member, from "Member Statistics".</p>
          <div className="ck-facts">
            <div><span>Contributed</span><b>{formatAmount(money.bbjContribution)}</b></div>
            <div><span>Paid out</span><b>{formatAmount(money.bbjPayout)}</b></div>
            <div>
              <span>Net</span>
              <b className={money.bbjContribution - money.bbjPayout < 0 ? 'ck-neg' : undefined}>{signedAmount(money.bbjContribution - money.bbjPayout)}</b>
            </div>
            <div><span>Share of brutto rake</span><b>{formatPercent(money.bbjContribution, money.brutto)}</b></div>
          </div>
        </div>

        <div className="ck-card ck-wide">
          <h3>Results by stake</h3>
          <p className="ck-note">Ring games grouped by game and blinds. Rake per hour shows which tables earn the most while they run.</p>
          <DataTable
            columns={stakeColumns(Math.max(0, ...stakes.map(s => s.rake)))}
            rows={stakes}
            rowKey={r => r.stake}
            initialSort="rake"
            empty="No table data for this range."
          />
        </div>
      </div>
    </section>
  )
}

export default OverviewTab
