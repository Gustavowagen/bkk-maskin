import { useEffect, useState } from 'react'
import { LineChart } from '../../components/StatsCharts'
import SortHeader from '../../components/SortHeader'
import StatTile from '../../components/StatTile'
import { formatChips, formatDate, formatRakePerHand, profitClass, rakePerHand, signed } from '../../utils/format'
import { fetchPlayerHistory } from '../../utils/statsApi'
import type { PlayerHistoryRow, PlayerTotalRow } from '../../utils/statsApi'
import { useSort } from '../../utils/useSort'

type SortKey = 'nickname' | 'agent' | 'hands' | 'rake' | 'rakePerHand' | 'rakeback' | 'profitLoss' | 'periodsPlayed'

interface PlayersViewProps {
  players: PlayerTotalRow[];
  title: string;
  showAgent?: boolean; // Adds an "Agent" column (the agent himself for agents)
  range: { from: string; to: string };
  query: string; // Lowercase search text, '' for all players
  onError: (message: string) => void;
}

// The agent a row belongs to: the agent himself for agents, otherwise the player's agent
const agentGroup = (player: PlayerTotalRow) => (player.isAgent ? player.nickname : player.agent)

function PlayersView({ players, title, showAgent = false, range, query, onError }: PlayersViewProps) {
  const { sort, toggleSort } = useSort<SortKey>('rake', 'nickname')
  const [selectedNickname, setSelectedNickname] = useState<string | null>(null)
  const [history, setHistory] = useState<PlayerHistoryRow[] | null>(null)

  useEffect(() => {
    if (!selectedNickname) return
    let cancelled = false
    setHistory(null)
    fetchPlayerHistory(selectedNickname, range.from, range.to)
      .then(rows => {
        if (!cancelled) setHistory(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Could not load player history.')
      })
    return () => {
      cancelled = true
    }
  }, [selectedNickname, range.from, range.to, onError])

  const tableRows = players
    .filter(p => p.rake !== 0)
    .filter(p => query === ''
      || p.nickname.toLowerCase().includes(query)
      || p.realName.toLowerCase().includes(query)
      || (showAgent && agentGroup(p).toLowerCase().includes(query)))
    .sort((a, b) => {
      const order = sort.key === 'nickname'
        ? a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' })
        : sort.key === 'agent'
          ? agentGroup(a).localeCompare(agentGroup(b), undefined, { sensitivity: 'base' })
            || Number(b.isAgent) - Number(a.isAgent)
        : sort.key === 'rakePerHand'
          ? rakePerHand(a.rake, a.hands) - rakePerHand(b.rake, b.hands)
          : a[sort.key] - b[sort.key]
      return sort.descending ? -order : order
    })

  const selectPlayer = (nickname: string) => setSelectedNickname(current => (current === nickname ? null : nickname))

  const selected = players.find(p => p.nickname === selectedNickname)
  let runningProfit = 0
  const profitHistory = (history ?? []).map(row => {
    runningProfit += row.profitLoss
    return { label: formatDate(row.periodStart), value: runningProfit }
  })

  return (
    <>
      {selected && (
        <section className="stats-card player-detail">
          <header className="stats-card-header">
            <div>
              <h3>
                {selected.nickname}
                {selected.owner && <span className="tag tag-owner">Owner</span>}
                {selected.isAgent && <span className="tag tag-agent">Agent</span>}
                {selected.agent && <span className="tag">Agent: {selected.agent}</span>}
              </h3>
              {selected.realName && <span className="stats-card-subtitle">{selected.realName}</span>}
            </div>
            <button type="button" className="close-button" onClick={() => setSelectedNickname(null)} aria-label="Close player details">×</button>
          </header>
          <div className="stat-tiles stat-tiles-compact stat-tiles-five">
            <StatTile label="Profit / loss" value={signed(selected.profitLoss)} />
            <StatTile label="Rake" value={formatChips(selected.rake)} />
            <StatTile label="Rake per hand" value={formatRakePerHand(selected.rake, selected.hands)} />
            <StatTile label="Rakeback" value={formatChips(selected.rakeback)} />
            <StatTile label="Hands" value={formatChips(selected.hands)} hint={`${selected.periodsPlayed} day(s) played`} />
          </div>
          <h4 className="chart-title">Cumulative profit / loss</h4>
          {history ? <LineChart data={profitHistory} valueLabel="chips" /> : <div className="chart-placeholder" />}
        </section>
      )}

      <section className="stats-card">
        <header className="stats-card-header">
          <h3>{title}</h3>
          <span className="stats-card-subtitle">Click a player to see their details</span>
        </header>
        <div className="stats-table-wrapper">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="rank">#</th>
                <SortHeader sortKey="nickname" label="Player" sort={sort} onSort={toggleSort} numeric={false} />
                {showAgent && <SortHeader sortKey="agent" label="Agent" sort={sort} onSort={toggleSort} numeric={false} />}
                <SortHeader sortKey="hands" label="Hands" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="rake" label="Rake" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="rakePerHand" label="Rake / hand" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="rakeback" label="Rakeback" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="profitLoss" label="Profit / loss" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="periodsPlayed" label="Days" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p, index) => (
                <tr
                  key={p.nickname}
                  className={p.nickname === selectedNickname ? 'selected' : undefined}
                  onClick={() => selectPlayer(p.nickname)}
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectPlayer(p.nickname)
                    }
                  }}
                >
                  <td className="rank">{index + 1}</td>
                  <td>
                    <div className="player-cell">
                      <span className="player-nickname">
                        {p.nickname}
                        {p.owner && <span className="tag tag-owner">Owner</span>}
                        {p.isAgent && <span className="tag tag-agent">Agent</span>}
                      </span>
                      {p.realName && <span className="player-realname">{p.realName}</span>}
                    </div>
                  </td>
                  {showAgent && <td>{agentGroup(p)}</td>}
                  <td className="numeric">{formatChips(p.hands)}</td>
                  <td className="numeric">{formatChips(p.rake)}</td>
                  <td className="numeric">{formatRakePerHand(p.rake, p.hands)}</td>
                  <td className="numeric">{formatChips(p.rakeback)}</td>
                  <td className={`numeric ${profitClass(p.profitLoss)}`}>{signed(p.profitLoss)}</td>
                  <td className="numeric">{p.periodsPlayed}</td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={showAgent ? 9 : 8} className="empty-row">{query ? `No players match "${query}"` : 'No active players in this range'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export default PlayersView
