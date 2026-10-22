import { useState } from 'react'
import DataTable from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import StatTile from '../../components/StatTile'
import { ChartEmpty } from '../../components/StatsCharts'
import { clockName, formatDayTime, formatHourMinute, wallTime } from '../../utils/clock'
import { formatAmount, formatChips, signedAmount } from '../../utils/format'
import type { TournamentResultRow, TournamentRow } from '../../utils/statsApi'
import { sumBy } from './metrics'
import { sameName } from './types'
import type { TabProps } from './types'

const toneClass = (value: number) => (value > 0 ? 'ck-pos' : value < 0 ? 'ck-neg' : undefined)

function TournamentTab({ data, clock, openPlayer }: TabProps) {
  const { tournaments, players } = data
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const tournament = tournaments.find(t => t.id === selectedId) ?? tournaments[0]

  if (!tournament) {
    return (
      <section className="ck-page">
        <div className="ck-card">
          <ChartEmpty>No tournaments in this range. Tournaments are saved from uploads made after this update.</ChartEmpty>
        </div>
      </section>
    )
  }

  const wall = (t: TournamentRow, iso: string) => wallTime(iso, clock, t.utcOffsetMinutes)
  const when = (t: TournamentRow) => (t.startedAt
    ? `${formatDayTime(wall(t, t.startedAt))}${t.endedAt ? `–${formatHourMinute(wall(t, t.endedAt))}` : ''}`
    : '–')
  const knownPlayer = (nickname: string) => players.some(p => sameName(p.nickname, nickname))

  // Everyone who cashed or paid to play
  const results = tournament.results.filter(r => r.prize !== 0 || r.paid !== 0 || r.net !== 0)
  const columns: Column<TournamentResultRow>[] = [
    { key: 'player', label: 'Player', value: r => r.nickname, className: () => 'who' },
    { key: 'hands', label: 'Hands', numeric: true, hideSmall: true, value: r => r.hands },
    { key: 'paid', label: 'Buy-ins paid', numeric: true, value: r => r.paid, render: r => formatAmount(r.paid) },
    { key: 'prize', label: 'Prize', numeric: true, value: r => r.prize, render: r => formatAmount(r.prize) },
    { key: 'net', label: 'Net', numeric: true, value: r => r.net, render: r => signedAmount(r.net), className: r => toneClass(r.net) },
  ]

  const tournamentColumns: Column<TournamentRow>[] = [
    { key: 'title', label: 'Tournament', value: t => t.title, className: () => 'who' },
    { key: 'start', label: 'Started', value: t => t.startedAt, render: when },
    { key: 'entries', label: 'Entries', numeric: true, value: t => t.entries },
    { key: 'prize', label: 'Prize paid', numeric: true, value: t => t.prizePaid, render: t => formatAmount(t.prizePaid) },
    { key: 'overlay', label: 'Overlay', numeric: true, value: t => t.overlay, render: t => formatAmount(t.overlay) },
    { key: 'fees', label: 'Fees', numeric: true, value: t => t.feeTotal, render: t => formatAmount(t.feeTotal) },
  ]

  return (
    <section className="ck-page">
      {tournaments.length > 1 && (
        <div className="ck-pickbar">
          <label htmlFor="tournament-select">Tournament</label>
          <select id="tournament-select" value={tournament.id} onChange={e => setSelectedId(Number(e.target.value))}>
            {tournaments.map(t => <option key={t.id} value={t.id}>{t.title} · {when(t)}</option>)}
          </select>
        </div>
      )}

      <div className="ck-kpis">
        <StatTile label="Tournament" value={tournament.title} small hint={`${when(tournament)} ${clockName(clock)}`} />
        <StatTile label="Entries" value={formatChips(tournament.entries)} hint={tournament.reentry ? `Re-entry: ${tournament.reentry}` : tournament.game} />
        <StatTile label="Prize paid out" value={formatAmount(tournament.prizePaid)} hint={tournament.gtd > 0 ? `Guarantee ${formatChips(tournament.gtd)}` : 'No guarantee'} />
        <StatTile label="Club overlay" value={formatAmount(tournament.overlay)} tone={tournament.overlay > 0 ? -1 : 0} hint="Guarantee minus buy-in money" />
        <StatTile label="Buy-ins & re-entries" value={formatAmount(tournament.buyinTotal)} hint="Without fees" />
        <StatTile label="Fees" value={formatAmount(tournament.feeTotal)} hint="Kept by the club" />
      </div>

      <div className="ck-card">
        <h3>Prize list</h3>
        <p className="ck-note">Everyone who cashed or paid to play. Net is prize minus what they paid. Click a player to open the profile.</p>
        <DataTable
          columns={columns}
          rows={results}
          rowKey={r => r.memberId || r.nickname}
          initialSort="prize"
          onRowClick={r => (knownPlayer(r.nickname) ? openPlayer(r.nickname) : undefined)}
          empty="No results stored for this tournament."
        />
      </div>

      {tournaments.length > 1 && (
        <div className="ck-card">
          <h3>All tournaments</h3>
          <p className="ck-note">
            {tournaments.length} tournaments · {formatAmount(sumBy(tournaments, t => t.prizePaid))} paid out ·{' '}
            {formatAmount(sumBy(tournaments, t => t.overlay))} overlay · {formatAmount(sumBy(tournaments, t => t.feeTotal))} in fees.
            Click a row to see its prize list.
          </p>
          <DataTable columns={tournamentColumns} rows={tournaments} rowKey={t => String(t.id)} initialSort="start" selectedKey={String(tournament.id)} onRowClick={t => setSelectedId(t.id)} />
        </div>
      )}
    </section>
  )
}

export default TournamentTab
