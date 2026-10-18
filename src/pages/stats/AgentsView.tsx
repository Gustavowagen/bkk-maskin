import { useState } from 'react'
import { ColumnChart } from '../../components/StatsCharts'
import SortHeader from '../../components/SortHeader'
import StatTile from '../../components/StatTile'
import { formatChips, formatCompact, formatPercent, formatRakePerHand, profitClass, rakePerHand, signed } from '../../utils/format'
import type { AgentTotalRow, PlayerTotalRow } from '../../utils/statsApi'
import { useSort } from '../../utils/useSort'

type SortKey = 'agent' | 'players' | 'hands' | 'rake' | 'rakePerHand' | 'agentShare' | 'sharePercent' | 'profitLoss' | 'periodsActive'

// Up to this many agents get their own column in the rake chart, the rest are summed as "Other"
const MAX_CHART_AGENTS = 12

interface AgentsViewProps {
  agents: AgentTotalRow[];
  players: PlayerTotalRow[];
  clubRake: number; // Total rake of the club in the range, to show the agents' part of it
  query: string; // Lowercase search text, '' for all agents
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The rake share in percent of the rake it was calculated from, or undefined if the agent was never entered */
const sharePercent = (agent: AgentTotalRow) => (agent.sharedRake > 0 ? (agent.agentShare / agent.sharedRake) * 100 : undefined)

const formatSharePercent = (agent: AgentTotalRow) => {
  const percent = sharePercent(agent)
  return percent === undefined ? '–' : `${percent.toFixed(1)}%`
}

function AgentsView({ agents, players, clubRake, query }: AgentsViewProps) {
  const { sort, toggleSort } = useSort<SortKey>('rake', 'agent')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  const activeAgents = agents.filter(a => a.rake !== 0 || a.hands !== 0)
  const agentRake = activeAgents.reduce((sum, a) => sum + a.rake, 0)
  const agentShare = activeAgents.reduce((sum, a) => sum + a.agentShare, 0)
  const agentPlayers = activeAgents.reduce((sum, a) => sum + a.players, 0)
  const notEntered = activeAgents.filter(a => a.sharedRake === 0)

  const byRake = [...activeAgents].sort((a, b) => b.rake - a.rake)
  const otherRake = byRake.slice(MAX_CHART_AGENTS).reduce((sum, a) => sum + a.rake, 0)
  const rakeChart = [
    ...byRake.slice(0, MAX_CHART_AGENTS).map(a => ({ label: a.agent, value: a.rake })),
    ...(otherRake > 0 ? [{ label: 'Other', value: otherRake }] : []),
  ]

  const tableRows = activeAgents
    .filter(a => query === '' || a.agent.toLowerCase().includes(query) || a.realName.toLowerCase().includes(query))
    .sort((a, b) => {
      const order = sort.key === 'agent'
        ? a.agent.localeCompare(b.agent, undefined, { sensitivity: 'base' })
        : sort.key === 'rakePerHand'
          ? rakePerHand(a.rake, a.hands) - rakePerHand(b.rake, b.hands)
          : sort.key === 'sharePercent'
            ? (sharePercent(a) ?? -1) - (sharePercent(b) ?? -1)
            : a[sort.key] - b[sort.key]
      return sort.descending ? -order : order
    })

  const selectAgent = (agent: string) => setSelectedAgent(current => (current === agent ? null : agent))

  const selected = activeAgents.find(a => a.agent === selectedAgent)
  const selectedPlayers = selected
    ? players
      .filter(p => (sameName(p.nickname, selected.agent) || sameName(p.agent, selected.agent)) && (p.rake !== 0 || p.hands !== 0))
      .sort((a, b) => Number(b.isAgent) - Number(a.isAgent) || b.rake - a.rake)
    : []

  if (activeAgents.length === 0) {
    return (
      <section className="stats-card">
        <p className="stats-empty">No agents or agent players played in this range.</p>
      </section>
    )
  }

  return (
    <>
      <div className="stat-tiles stat-tiles-five">
        <StatTile label="Active agents" value={String(activeAgents.length)} />
        <StatTile label="Agent players" value={String(agentPlayers)} hint="Not counting the agents" />
        <StatTile label="Rake via agents" value={formatCompact(agentRake)} hint={`${formatPercent(agentRake, clubRake)} of club rake`} />
        <StatTile label="Rake share paid" value={formatCompact(agentShare)} hint={`${formatPercent(agentShare, agentRake)} of their rake`} />
        <StatTile label="Net from agents" value={formatCompact(agentRake - agentShare)} hint="Rake minus rake share" />
      </div>

      {notEntered.length > 0 && (
        <p className="stats-note">
          No rake share is counted for <strong>{notEntered.map(a => a.agent).join(', ')}</strong>: they were never entered in the
          agents field in the Machine for this range.
        </p>
      )}

      <section className="stats-card">
        <header className="stats-card-header">
          <h3>Rake by agent</h3>
          <span className="stats-card-subtitle">The agent's and their players' rake</span>
        </header>
        <ColumnChart data={rakeChart} valueLabel="chips" />
      </section>

      {selected && (
        <section className="stats-card player-detail">
          <header className="stats-card-header">
            <div>
              <h3>
                {selected.agent}
                <span className="tag tag-agent">Agent</span>
              </h3>
              {selected.realName && <span className="stats-card-subtitle">{selected.realName}</span>}
            </div>
            <button type="button" className="close-button" onClick={() => setSelectedAgent(null)} aria-label="Close agent details">×</button>
          </header>
          <div className="stat-tiles stat-tiles-compact stat-tiles-five">
            <StatTile label="Rake" value={formatChips(selected.rake)} hint={`Own rake ${formatChips(selected.ownRake)}`} />
            <StatTile label="Rake share" value={formatChips(selected.agentShare)} hint={sharePercent(selected) === undefined ? 'Not entered in the Machine' : `${formatSharePercent(selected)} of rake`} />
            <StatTile label="Net to club" value={formatChips(selected.rake - selected.agentShare)} />
            <StatTile label="Profit / loss" value={signed(selected.profitLoss)} hint="Agent and players" />
            <StatTile label="Hands" value={formatChips(selected.hands)} hint={`${selected.periodsActive} day(s) active`} />
          </div>
          <h4 className="chart-title">Agent and players ({selected.players} player{selected.players === 1 ? '' : 's'})</h4>
          <div className="stats-table-wrapper">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="numeric">Hands</th>
                  <th className="numeric">Rake</th>
                  <th className="numeric">Rake / hand</th>
                  <th className="numeric">Rake share</th>
                  <th className="numeric">Profit / loss</th>
                  <th className="numeric">Days</th>
                </tr>
              </thead>
              <tbody>
                {selectedPlayers.map(p => (
                  <tr key={p.nickname} className="static-row">
                    <td>
                      <div className="player-cell">
                        <span className="player-nickname">
                          {p.nickname}
                          {p.isAgent && <span className="tag tag-agent">Agent</span>}
                        </span>
                        {p.realName && <span className="player-realname">{p.realName}</span>}
                      </div>
                    </td>
                    <td className="numeric">{formatChips(p.hands)}</td>
                    <td className="numeric">{formatChips(p.rake)}</td>
                    <td className="numeric">{formatRakePerHand(p.rake, p.hands)}</td>
                    <td className="numeric">{formatChips(p.agentShare)}</td>
                    <td className={`numeric ${profitClass(p.profitLoss)}`}>{signed(p.profitLoss)}</td>
                    <td className="numeric">{p.periodsPlayed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stats-card">
        <header className="stats-card-header">
          <h3>Agents</h3>
          <span className="stats-card-subtitle">Click an agent to see their players</span>
        </header>
        <div className="stats-table-wrapper">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="rank">#</th>
                <SortHeader sortKey="agent" label="Agent" sort={sort} onSort={toggleSort} numeric={false} />
                <SortHeader sortKey="players" label="Players" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="hands" label="Hands" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="rake" label="Rake" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="rakePerHand" label="Rake / hand" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="agentShare" label="Rake share" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="sharePercent" label="Share %" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="profitLoss" label="Profit / loss" sort={sort} onSort={toggleSort} />
                <SortHeader sortKey="periodsActive" label="Days" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {tableRows.map((a, index) => (
                <tr
                  key={a.agent}
                  className={a.agent === selectedAgent ? 'selected' : undefined}
                  onClick={() => selectAgent(a.agent)}
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectAgent(a.agent)
                    }
                  }}
                >
                  <td className="rank">{index + 1}</td>
                  <td>
                    <div className="player-cell">
                      <span className="player-nickname">{a.agent}</span>
                      {a.realName && <span className="player-realname">{a.realName}</span>}
                    </div>
                  </td>
                  <td className="numeric">{a.players}</td>
                  <td className="numeric">{formatChips(a.hands)}</td>
                  <td className="numeric">{formatChips(a.rake)}</td>
                  <td className="numeric">{formatRakePerHand(a.rake, a.hands)}</td>
                  <td className="numeric">{formatChips(a.agentShare)}</td>
                  <td className="numeric">{formatSharePercent(a)}</td>
                  <td className={`numeric ${profitClass(a.profitLoss)}`}>{signed(a.profitLoss)}</td>
                  <td className="numeric">{a.periodsActive}</td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty-row">No agents match "{query}"</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export default AgentsView
