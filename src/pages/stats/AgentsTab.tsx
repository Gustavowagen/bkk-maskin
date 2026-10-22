import { useEffect, useState } from 'react'
import DataTable from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import StatTile from '../../components/StatTile'
import { ChartEmpty, ColumnChart } from '../../components/StatsCharts'
import { formatNightLong, formatNightShort } from '../../utils/clock'
import { formatAmount, formatChips, formatDate, formatShare, signedAmount } from '../../utils/format'
import { fetchSessionPlayers } from '../../utils/statsApi'
import type { AgentTotalRow, PlayerTotalRow, SessionPlayerRow } from '../../utils/statsApi'
import { nightsInRange, resultsByNight, sumBy } from './metrics'
import { PlayerName } from './PlayersTab'
import { hasPlayed, sameName } from './types'
import type { TabProps } from './types'

interface AgentsTabProps extends TabProps {
  agent: string | null; // The agent to show, null for the one with most rake
  onSelectAgent: (agent: string) => void;
}

/** The rake share as a ratio of the rake it was calculated from, or undefined if the agent was never entered */
const shareRatio = (agent: AgentTotalRow) => (agent.sharedRake > 0 ? agent.agentShare / agent.sharedRake : undefined)

const toneClass = (value: number) => (value > 0 ? 'ck-pos' : value < 0 ? 'ck-neg' : undefined)

/** The agent himself and every player whose agent he is */
const downlineOf = (players: PlayerTotalRow[], agent: string) =>
  players
    .filter(p => sameName(p.nickname, agent) || (!p.isAgent && sameName(p.agent, agent)))
    .sort((a, b) => Number(sameName(b.nickname, agent)) - Number(sameName(a.nickname, agent)) || b.rake - a.rake)

function AgentsTab({ data, clock, agent: agentName, onSelectAgent, openPlayer, onError }: AgentsTabProps) {
  const { agents, players, range, weekly } = data
  const active = agents.filter(hasPlayed).sort((a, b) => b.rake - a.rake)
  const agent = (agentName ? active.find(a => sameName(a.agent, agentName)) : undefined) ?? active[0]
  const downline = agent ? downlineOf(players, agent.agent) : []

  const loadKey = agent ? `${downline.map(p => p.nickname).join('|')}|${range.from}|${range.to}` : ''
  const [loaded, setLoaded] = useState<{ key: string; rows: SessionPlayerRow[] } | null>(null)
  useEffect(() => {
    if (!agent) return
    let cancelled = false
    fetchSessionPlayers(downline.map(p => p.nickname), range.from, range.to)
      .then(rows => {
        if (!cancelled) setLoaded({ key: loadKey, rows })
      })
      .catch((e: unknown) => {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Could not load the agent.')
      })
    return () => {
      cancelled = true
    }
  }, [loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!agent) {
    return (
      <section className="ck-page">
        <p className="ck-empty">No agents or agent players played in this range.</p>
      </section>
    )
  }

  const ready = loaded?.key === loadKey
  const nightly = new Map(resultsByNight(ready ? loaded.rows : [], clock, weekly).map(r => [r.key, r]))
  const chart = nightsInRange(data.firstDay, data.lastDay, weekly).map(key => {
    const r = nightly.get(key)
    return {
      key,
      label: weekly ? formatDate(key) : formatNightShort(key),
      title: weekly ? `Week of ${formatDate(key)}` : formatNightLong(key),
      values: { rake: r?.rake ?? 0 },
      lines: [
        { label: 'Ring rake', value: formatAmount(r?.rake ?? 0) },
        { label: "Players' net", value: signedAmount(r?.profitLoss ?? 0) },
        { label: 'Hands', value: formatChips(r?.hands ?? 0) },
      ],
    }
  })

  const ratio = shareRatio(agent)
  const notEntered = active.filter(a => a.sharedRake === 0)
  const self = downline.find(p => sameName(p.nickname, agent.agent))

  const downlineColumns: Column<PlayerTotalRow>[] = [
    {
      key: 'player', label: 'Player', value: p => p.nickname, className: () => 'who',
      render: p => <PlayerName player={p} agentOf={sameName(p.nickname, agent.agent) ? agent.agent : undefined} />,
    },
    { key: 'hands', label: 'Hands', numeric: true, value: p => p.hands },
    { key: 'rake', label: 'Rake', numeric: true, value: p => p.rake, render: p => formatAmount(p.rake) },
    { key: 'share', label: 'Rake share', numeric: true, hideSmall: true, value: p => p.agentShare, render: p => formatAmount(p.agentShare) },
    { key: 'net', label: 'Net', numeric: true, value: p => p.profitLoss, render: p => signedAmount(p.profitLoss), className: p => toneClass(p.profitLoss) },
    { key: 'chips', label: 'Balance', numeric: true, hideSmall: true, value: p => p.chips, render: p => formatAmount(p.chips) },
  ]

  const agentColumns: Column<AgentTotalRow>[] = [
    {
      key: 'agent', label: 'Agent', value: a => a.agent, className: () => 'who',
      render: a => <span className="ck-player"><span>{a.agent}</span>{a.realName && <span className="ck-realname">{a.realName}</span>}</span>,
    },
    { key: 'players', label: 'Players', numeric: true, value: a => a.players },
    { key: 'hands', label: 'Hands', numeric: true, hideSmall: true, value: a => a.hands },
    { key: 'rake', label: 'Rake', numeric: true, value: a => a.rake, render: a => formatAmount(a.rake) },
    { key: 'share', label: 'Rake share', numeric: true, value: a => a.agentShare, render: a => formatAmount(a.agentShare) },
    { key: 'ratio', label: 'Share %', numeric: true, hideSmall: true, value: a => shareRatio(a) ?? -1, render: a => (shareRatio(a) === undefined ? '–' : formatShare(shareRatio(a)!)) },
    { key: 'club', label: 'Net to club', numeric: true, value: a => a.rake - a.agentShare, render: a => formatAmount(a.rake - a.agentShare) },
    { key: 'net', label: "Players' net", numeric: true, value: a => a.profitLoss, render: a => signedAmount(a.profitLoss), className: a => toneClass(a.profitLoss) },
    { key: 'days', label: 'Uploads', numeric: true, hideSmall: true, value: a => a.periodsActive },
  ]

  return (
    <section className="ck-page">
      <div className="ck-pickbar">
        <label htmlFor="agent-select">Agent</label>
        <select id="agent-select" value={agent.agent} onChange={e => onSelectAgent(e.target.value)}>
          {active.map(a => <option key={a.agent} value={a.agent}>{a.agent}{a.realName ? ` · ${a.realName}` : ''}</option>)}
        </select>
      </div>

      <div className="ck-who">
        <h2>{agent.agent}</h2>
        <div className="ck-who-meta">
          <span className="ck-pill ck-pill-agent">Agent</span>
          {agent.realName && <span>{agent.realName}</span>}
          <span>{ratio === undefined ? 'Not entered in the agents list in the Machine, so no rake share is counted' : `Rake share ${formatShare(ratio)} of rake`}</span>
          {self && <button type="button" className="ck-linkbtn" onClick={() => openPlayer(self.nickname)}>Open own profile</button>}
        </div>
      </div>

      <div className="ck-kpis">
        <StatTile label="Rake generated" value={formatAmount(agent.rake)} hint={`Own rake ${formatChips(agent.ownRake)}`} />
        <StatTile label="Rake share" value={formatAmount(agent.agentShare)} hint={ratio === undefined ? 'Not entered in the Machine' : `${formatShare(ratio)} of rake`} />
        <StatTile label="Net to club" value={formatAmount(agent.rake - agent.agentShare)} hint="Rake minus rake share" />
        <StatTile label="Players' net" value={signedAmount(agent.profitLoss)} tone={agent.profitLoss} hint="Agent and players, after rake" />
        <StatTile label="Players" value={String(agent.players)} hint={`${downline.filter(hasPlayed).length} played, agent included`} />
        <StatTile label="Chips held" value={formatAmount(sumBy(downline, p => p.chips))} hint="Balances at the latest export" />
      </div>

      {notEntered.length > 0 && (
        <p className="ck-callout">
          No rake share is counted for <strong>{notEntered.map(a => a.agent).join(', ')}</strong>: they were never entered in the
          agents list in the Machine for this range.
        </p>
      )}

      <div className="ck-grid">
        <div className="ck-card">
          <h3>Rake per {weekly ? 'week' : 'night'}</h3>
          <p className="ck-note">Ring rake paid by the agent and his players. Hover for their net and hands.</p>
          {!ready
            ? <div className="ck-chart-placeholder" />
            : loaded.rows.length > 0
              ? <ColumnChart data={chart} series={[{ key: 'rake', label: 'Ring rake', color: '#3b6ea8' }]} />
              : <ChartEmpty>No stored ring sessions for these players in this range.</ChartEmpty>}
        </div>
        <div className="ck-card">
          <h3>Agent and players</h3>
          <p className="ck-note">Click a player to open their profile.</p>
          <DataTable columns={downlineColumns} rows={downline} rowKey={p => p.nickname.toLowerCase()} initialSort="rake" onRowClick={p => openPlayer(p.nickname)} />
        </div>
      </div>

      <div className="ck-card">
        <h3>All agents compared</h3>
        <p className="ck-note">
          Every agent with his players. The rake share is worked out in the Machine from the agent's rake % (his own play and single
          players can have their own %). Click a row to review that agent.
        </p>
        <DataTable columns={agentColumns} rows={active} rowKey={a => a.agent} initialSort="rake" selectedKey={agent.agent} onRowClick={a => onSelectAgent(a.agent)} />
      </div>
    </section>
  )
}

export default AgentsTab
