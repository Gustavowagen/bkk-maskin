import { useState } from 'react'
import DataTable from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ChartEmpty, HBarChart } from '../../components/StatsCharts'
import type { HBarDatum } from '../../components/StatsCharts'
import { formatAmount, formatChips, signedAmount } from '../../utils/format'
import type { PlayerTotalRow } from '../../utils/statsApi'
import { hasPlayed } from './types'
import type { TabProps } from './types'

const TOP_RAKE_COUNT = 15
const WINNERS_LOSERS_COUNT = 8

/** Nickname with owner/agent tags and the real name below */
export const PlayerName = ({ player, agentOf }: { player: PlayerTotalRow; agentOf?: string }) => (
  <span className="ck-player">
    <span>
      {player.nickname}
      {agentOf && <span className="ck-muted"> (agent)</span>}
      {player.owner && <span className="ck-pill ck-pill-owner">Owner</span>}
      {player.isAgent && !agentOf && <span className="ck-pill ck-pill-agent">Agent</span>}
    </span>
    {player.realName && <span className="ck-realname">{player.realName}</span>}
  </span>
)

const playerLines = (p: PlayerTotalRow) => [
  { label: 'Rake', value: formatAmount(p.rake) },
  { label: 'Rakeback', value: formatAmount(p.rakeback) },
  { label: 'Hands', value: formatChips(p.hands) },
  { label: 'Net', value: signedAmount(p.profitLoss) },
  { label: 'Agent', value: p.isAgent ? 'Is an agent' : p.agent || 'None' },
]

function PlayersTab({ data, openPlayer }: TabProps) {
  const [search, setSearch] = useState('')
  const [onlyPlayed, setOnlyPlayed] = useState(true)
  const { players } = data

  const topRake: HBarDatum[] = [...players]
    .filter(p => p.rake > 0)
    .sort((a, b) => b.rake - a.rake)
    .slice(0, TOP_RAKE_COUNT)
    .map(p => ({ key: p.nickname, label: p.nickname, value: p.rake, title: p.realName ? `${p.nickname} (${p.realName})` : p.nickname, lines: playerLines(p) }))

  const byResult = [...players].filter(hasPlayed).sort((a, b) => b.profitLoss - a.profitLoss)
  const winners = byResult.filter(p => p.profitLoss > 0).slice(0, WINNERS_LOSERS_COUNT)
  const losers = byResult.filter(p => p.profitLoss < 0).slice(-WINNERS_LOSERS_COUNT)
  const results: HBarDatum[] = [...winners, ...losers].map(p => ({
    key: p.nickname,
    label: p.nickname,
    value: p.profitLoss,
    title: p.realName ? `${p.nickname} (${p.realName})` : p.nickname,
    lines: [
      ...Object.entries(p.gamePnl).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([game, value]) => ({ label: game, value: signedAmount(value) })),
      { label: 'Rake paid', value: formatAmount(p.rake) },
      { label: 'Rakeback', value: formatAmount(p.rakeback) },
    ],
  }))

  const query = search.trim().toLowerCase()
  const rows = players.filter(p => (!onlyPlayed || hasPlayed(p)) && (query === ''
    || p.nickname.toLowerCase().includes(query)
    || p.realName.toLowerCase().includes(query)
    || p.memberId.includes(query)
    || p.agent.toLowerCase().includes(query)))

  const columns: Column<PlayerTotalRow>[] = [
    { key: 'player', label: 'Player', value: p => p.nickname, className: () => 'who', render: p => <PlayerName player={p} /> },
    { key: 'role', label: 'Role', hideSmall: true, value: p => p.role || '–' },
    { key: 'agent', label: 'Agent', hideSmall: true, value: p => (p.isAgent ? p.nickname : p.agent || 'Direct') },
    { key: 'games', label: 'Games', numeric: true, hideSmall: true, value: p => p.games },
    { key: 'hands', label: 'Hands', numeric: true, value: p => p.hands },
    { key: 'rake', label: 'Rake', numeric: true, value: p => p.rake, render: p => formatAmount(p.rake) },
    { key: 'rakeback', label: 'Rakeback', numeric: true, hideSmall: true, value: p => p.rakeback, render: p => formatAmount(p.rakeback) },
    {
      key: 'net', label: 'Net', numeric: true, value: p => p.profitLoss, render: p => signedAmount(p.profitLoss),
      className: p => (p.profitLoss > 0 ? 'ck-pos' : p.profitLoss < 0 ? 'ck-neg' : undefined),
    },
    { key: 'chips', label: 'Balance', numeric: true, hideSmall: true, value: p => p.chips, render: p => formatAmount(p.chips) },
  ]

  return (
    <section className="ck-page">
      <div className="ck-grid">
        <div className="ck-card">
          <h3>Top rake contributors</h3>
          <p className="ck-note">The {TOP_RAKE_COUNT} players who paid the most rake and fees in this range. Click a bar to open the profile.</p>
          {topRake.length > 0
            ? <HBarChart data={topRake} color={() => '#3b6ea8'} format={formatChips} onSelect={openPlayer} />
            : <ChartEmpty>No rake in this range.</ChartEmpty>}
        </div>
        <div className="ck-card">
          <h3>Biggest winners and losers</h3>
          <p className="ck-note">Net result across all games, after rake. Click a bar to open the profile.</p>
          {results.length > 0
            ? <HBarChart data={results} signed color={v => (v >= 0 ? 'var(--ck-muted-bar)' : 'var(--ck-bad-bar)')} format={v => signedAmount(Math.round(v))} onSelect={openPlayer} />
            : <ChartEmpty>No results in this range.</ChartEmpty>}
        </div>
      </div>

      <div className="ck-card">
        <h3>All players</h3>
        <p className="ck-note">
          Totals per player over the range, with the chip balance at the latest export. Search by name, real name, ID or agent,
          and click a row to open the profile.
        </p>
        <div className="ck-tools">
          <input type="search" placeholder="Search players" aria-label="Search players" value={search} onChange={e => setSearch(e.target.value)} />
          <label><input type="checkbox" checked={onlyPlayed} onChange={e => setOnlyPlayed(e.target.checked)} /> Only players who played</label>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={p => p.nickname.toLowerCase()}
          initialSort="rake"
          onRowClick={p => openPlayer(p.nickname)}
          empty={query ? `No players match "${search.trim()}"` : 'No players in this range.'}
        />
      </div>
    </section>
  )
}

export default PlayersTab
