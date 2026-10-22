import DataTable from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ChartEmpty, GanttChart, Legend } from '../../components/StatsCharts'
import type { GanttBar } from '../../components/StatsCharts'
import { clockName, formatDayTime, formatHourMinute, formatNightShort, nightStart } from '../../utils/clock'
import { formatAmount, formatChips } from '../../utils/format'
import { gamesOf, timeSessions } from './metrics'
import type { TimedSession } from './metrics'
import type { TabProps } from './types'

const HOUR = 3_600_000
// The timeline shows this many of the latest nights, so long ranges stay readable
const MAX_TIMELINE_NIGHTS = 14
// The sessions table shows this many rows (after sorting)
const MAX_SESSION_ROWS = 300

interface SessionRow extends TimedSession {
  number: number; // 1 = the first session in the range
}

const formatLength = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`

function TablesTab({ data, clock }: TabProps) {
  const timed = timeSessions(data.sessions, clock).sort((a, b) => a.start - b.start || a.session.id - b.session.id)
  const rows: SessionRow[] = timed.map((t, i) => ({ ...t, number: i + 1 }))
  const games = gamesOf(data.sessions)
  const colorOf = new Map(games.map(g => [g.game, g.color]))

  const allNights = [...new Set(timed.map(t => t.night))].sort()
  const nights = allNights.slice(-MAX_TIMELINE_NIGHTS)
  const bars: GanttBar[] = rows
    .filter(r => nights.includes(r.night))
    .map(r => {
      const start = nightStart(r.night)
      return {
        key: String(r.session.id),
        row: r.night,
        start: (r.start - start) / HOUR,
        end: (r.end - start) / HOUR,
        color: colorOf.get(r.session.game) ?? '#9aa1ad',
        title: `${r.session.tableName} · ${formatDayTime(r.start).split(' ')[0]} ${formatHourMinute(r.start)}–${formatHourMinute(r.end)}`,
        lines: [
          { color: colorOf.get(r.session.game), label: 'Length', value: formatLength(r.session.minutes) },
          { label: 'Players', value: String(r.session.players) },
          { label: 'Hands', value: formatChips(r.session.hands) },
          { label: 'Rake', value: formatAmount(r.session.rake) },
        ],
      }
    })

  const columns: Column<SessionRow>[] = [
    { key: 'number', label: '#', numeric: true, value: r => r.number },
    {
      key: 'table', label: 'Table', value: r => r.session.tableName, className: () => 'who',
      render: r => <>{r.session.tableName} <span className="ck-pill">{r.session.game}</span></>,
    },
    { key: 'start', label: 'Opened', hideSmall: true, value: r => r.start, render: r => formatDayTime(r.start) },
    { key: 'minutes', label: 'Minutes', numeric: true, hideSmall: true, value: r => r.session.minutes },
    { key: 'players', label: 'Players', numeric: true, value: r => r.session.players },
    { key: 'hands', label: 'Hands', numeric: true, hideSmall: true, value: r => r.session.hands },
    { key: 'rake', label: 'Rake', numeric: true, value: r => r.session.rake, render: r => formatAmount(r.session.rake) },
  ]

  return (
    <section className="ck-page">
      <div className="ck-card">
        <h3>Every table, night by night</h3>
        <p className="ck-note">One bar per ring session, from open to close. Overlapping tables stack. Hover for players, hands and rake.</p>
        {bars.length > 0 ? (
          <>
            <Legend items={games.map(g => ({ label: g.game, color: g.color }))} />
            <GanttChart
              rows={nights.map(night => ({ key: night, label: formatNightShort(night) }))}
              bars={bars}
              hourLabel={hour => `${String((((hour + 6) % 24) + 24) % 24).padStart(2, '0')}:00`}
            />
            <p className="ck-note ck-note-after">
              Times in {clockName(clock)}. Each row is one night, from 06:00 to 06:00.
              {allNights.length > nights.length && ` Showing the latest ${nights.length} of ${allNights.length} nights.`}
            </p>
          </>
        ) : <ChartEmpty>No table data for this range. Upload the files again to fill it in.</ChartEmpty>}
      </div>

      <div className="ck-card">
        <h3>Biggest sessions</h3>
        <p className="ck-note">
          Ring sessions ranked by rake. Sort by any column.
          {rows.length > MAX_SESSION_ROWS && ` Showing the first ${MAX_SESSION_ROWS} of ${rows.length}.`}
        </p>
        <DataTable columns={columns} rows={rows} rowKey={r => String(r.session.id)} initialSort="rake" limit={MAX_SESSION_ROWS} empty="No sessions in this range." />
      </div>
    </section>
  )
}

export default TablesTab
