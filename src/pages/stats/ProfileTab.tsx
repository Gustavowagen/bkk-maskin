import { useEffect, useState } from 'react'
import DataTable from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import StatTile from '../../components/StatTile'
import { ChartEmpty, HBarChart, LineChart } from '../../components/StatsCharts'
import type { LinePoint } from '../../components/StatsCharts'
import { formatDayTime, wallTime } from '../../utils/clock'
import { formatAmount, formatChips, formatDate, formatShare, signedAmount } from '../../utils/format'
import { fetchPlayerHistory, fetchSessionPlayers } from '../../utils/statsApi'
import type { PlayerHistoryRow, SessionPlayerRow } from '../../utils/statsApi'
import { ringProfile, sumBy } from './metrics'
import { hasPlayed, sameName } from './types'
import type { TabProps } from './types'

interface ProfileTabProps extends TabProps {
  nickname: string | null; // The player to show, null for the biggest rake payer
  onSelectPlayer: (nickname: string) => void;
}

interface Loaded {
  key: string; // Player and range the rows were loaded for
  sessions: SessionPlayerRow[];
  history: PlayerHistoryRow[];
}

interface HistoryRow extends SessionPlayerRow {
  number: number;
  wall: number;
}

const toneClass = (value: number) => (value > 0 ? 'ck-pos' : value < 0 ? 'ck-neg' : undefined)

function ProfileTab({ data, clock, nickname, onSelectPlayer, openAgent, onError }: ProfileTabProps) {
  const { players, agents, tournaments, range } = data
  const byName = (a: { nickname: string }, b: { nickname: string }) => a.nickname.localeCompare(b.nickname, 'nb', { sensitivity: 'base' })
  const played = players.filter(hasPlayed).sort(byName)
  const notPlayed = players.filter(p => !hasPlayed(p)).sort(byName)
  const player = (nickname ? players.find(p => sameName(p.nickname, nickname)) : undefined)
    ?? [...players].sort((a, b) => b.rake - a.rake)[0]

  const loadKey = player ? `${player.nickname.toLowerCase()}|${range.from}|${range.to}` : ''
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!player) return
    let cancelled = false
    Promise.all([
      fetchSessionPlayers([player.nickname], range.from, range.to),
      fetchPlayerHistory(player.nickname, range.from, range.to),
    ])
      .then(([sessions, history]) => {
        if (!cancelled) setLoaded({ key: loadKey, sessions, history })
      })
      .catch((e: unknown) => {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Could not load the player.')
      })
    return () => {
      cancelled = true
    }
  }, [loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!player) {
    return <section className="ck-page"><p className="ck-empty">No players in this range.</p></section>
  }

  const ready = loaded?.key === loadKey
  const sessions = ready ? loaded.sessions : []
  const ring = ringProfile(sessions)
  const results = tournaments.flatMap(t => t.results
    .filter(r => (player.memberId && r.memberId === player.memberId) || sameName(r.nickname, player.nickname))
    .map(r => ({ ...r, title: t.title })))
  const agentName = player.isAgent ? player.nickname : player.agent
  const agentKnown = agentName !== '' && agents.some(a => sameName(a.agent, agentName))

  // Running result: per ring session when the tables are stored, otherwise per upload
  // Sessions are numbered across the club in time order, like on the Tables tab
  const sessionNumbers = new Map([...data.sessions]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id - b.id)
    .map((s, i) => [s.id, i + 1]))
  const history: HistoryRow[] = sessions.map((s, i) => ({
    ...s, number: sessionNumbers.get(s.sessionId) ?? i + 1, wall: wallTime(s.startedAt, clock, s.utcOffsetMinutes),
  }))
  let running = 0
  const runningPoints: LinePoint[] = history.length > 0
    ? history.map(s => {
      running += s.profitLoss
      return {
        key: `${s.sessionId}`,
        label: formatDayTime(s.wall).replace(/ \d+ \w+ /, ' '),
        value: running,
        title: `#${s.number} · ${s.stake} · ${formatDayTime(s.wall)}`,
        lines: [
          { label: 'Session net', value: signedAmount(s.profitLoss) },
          { label: 'Running total', value: signedAmount(running) },
          { label: 'Hands', value: String(s.hands) },
          { label: 'Rake', value: formatAmount(s.rake) },
        ],
      }
    })
    : (ready ? loaded.history : []).map(h => {
      running += h.profitLoss
      return {
        key: h.periodStart,
        label: formatDate(h.periodStart),
        value: running,
        title: formatDate(h.periodStart),
        lines: [
          { label: 'Net', value: signedAmount(h.profitLoss) },
          { label: 'Running total', value: signedAmount(running) },
          { label: 'Rake', value: formatAmount(h.rake) },
        ],
      }
    })

  const games = Object.entries(player.gamePnl).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))

  const columns: Column<HistoryRow>[] = [
    { key: 'number', label: '#', numeric: true, value: r => r.number },
    { key: 'opened', label: 'Opened', value: r => r.wall, render: r => formatDayTime(r.wall) },
    { key: 'stake', label: 'Stake', value: r => r.stake },
    { key: 'buyin', label: 'Buy-in', numeric: true, hideSmall: true, value: r => r.buyin },
    { key: 'cashout', label: 'Cashout', numeric: true, hideSmall: true, value: r => r.cashout },
    { key: 'hands', label: 'Hands', numeric: true, value: r => r.hands },
    { key: 'rake', label: 'Rake', numeric: true, hideSmall: true, value: r => r.rake },
    { key: 'net', label: 'Net', numeric: true, value: r => r.profitLoss, render: r => signedAmount(r.profitLoss), className: r => toneClass(r.profitLoss) },
  ]

  return (
    <section className="ck-page">
      <div className="ck-pickbar">
        <label htmlFor="profile-select">Player</label>
        <select id="profile-select" value={player.nickname} onChange={e => onSelectPlayer(e.target.value)}>
          {played.length > 0 && (
            <optgroup label="Played in this range">
              {played.map(p => <option key={p.nickname} value={p.nickname}>{p.nickname}{p.realName ? ` · ${p.realName}` : ''}</option>)}
            </optgroup>
          )}
          {notPlayed.length > 0 && (
            <optgroup label="Did not play">
              {notPlayed.map(p => <option key={p.nickname} value={p.nickname}>{p.nickname}{p.realName ? ` · ${p.realName}` : ''}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      <div className="ck-who">
        <h2>{player.nickname}</h2>
        <div className="ck-who-meta">
          {player.realName && <span>{player.realName}</span>}
          {player.memberId && <span>{player.memberId}</span>}
          {player.role && <span className="ck-pill">{player.role}</span>}
          {player.owner && <span className="ck-pill ck-pill-owner">Owner</span>}
          {player.isAgent && <span className="ck-pill ck-pill-agent">Agent</span>}
          <span>
            Agent:{' '}
            {agentKnown
              ? <button type="button" className="ck-linkbtn" onClick={() => openAgent(agentName)}>{player.isAgent ? `${agentName} (self)` : agentName}</button>
              : agentName || 'Direct'}
          </span>
        </div>
      </div>

      <div className="ck-kpis">
        <StatTile label="Net result" value={signedAmount(player.profitLoss)} tone={player.profitLoss} hint="All games, after rake" />
        <StatTile label="Rake & fees paid" value={formatAmount(player.rake)} hint="Ring rake + tournament fees" />
        <StatTile
          label={player.owner ? 'Rakeback (owner)' : player.agentShare > 0 ? 'Agent rake share' : 'Rakeback'}
          value={formatAmount(player.agentShare > 0 ? player.agentShare : player.rakeback)}
          hint={player.agentShare > 0 ? "Part of the agent's rake share from this player" : `${formatShare(player.rakeback / (player.rake || 1))} of rake`}
        />
        <StatTile label="Hands" value={formatChips(player.hands)} hint={`${player.periodsPlayed} upload(s) played`} />
        <StatTile label="Ring sessions" value={ready ? String(sessions.length) : '…'} hint={ring ? `${formatShare(ring.winShare)} ended in profit` : 'No stored tables'} />
        <StatTile label="Chip balance" value={formatAmount(player.chips)} hint="At the latest export" />
      </div>

      <div className="ck-grid">
        <div className="ck-card ck-wide">
          <h3>Running result</h3>
          <p className="ck-note">
            {history.length > 0 ? 'Ring-game net added up session by session. Hover a point for the session.' : 'Net added up upload by upload.'}
          </p>
          {!ready
            ? <div className="ck-chart-placeholder" />
            : runningPoints.length > 0
              ? <LineChart data={runningPoints} color={running >= 0 ? '#3b6ea8' : 'var(--ck-bad-bar)'} />
              : <ChartEmpty>No results in this range.</ChartEmpty>}
        </div>

        <div className="ck-card">
          <h3>Result by game</h3>
          <p className="ck-note">Net per game type in this range.</p>
          {games.length > 0
            ? (
              <HBarChart
                data={games.map(([game, value]) => ({ key: game, label: game, value, title: game, lines: [{ label: 'Net', value: signedAmount(value) }] }))}
                signed
                rowHeight={30}
                color={v => (v < 0 ? 'var(--ck-bad-bar)' : '#3b6ea8')}
                format={v => signedAmount(Math.round(v))}
              />
            )
            : <ChartEmpty>No results per game (upload the files again to fill it in).</ChartEmpty>}
        </div>

        <div className="ck-card">
          <h3>How they play</h3>
          <p className="ck-note">Ring-game habits worked out from every session.</p>
          <div className="ck-facts">
            <div><span>Favourite stake</span><b>{ring?.favStake ?? '–'}</b></div>
            <div><span>Average buy-in</span><b>{ring ? formatChips(ring.avgBuyin) : '–'}</b></div>
            <div><span>Total bought in</span><b>{ring ? formatAmount(ring.buyin) : '–'}</b></div>
            <div><span>Biggest win</span><b className={ring ? toneClass(ring.biggestWin) : undefined}>{ring ? signedAmount(ring.biggestWin) : '–'}</b></div>
            <div><span>Biggest loss</span><b className={ring ? toneClass(ring.biggestLoss) : undefined}>{ring ? signedAmount(ring.biggestLoss) : '–'}</b></div>
            <div><span>Rake per 100 hands</span><b>{ring ? formatAmount(Math.round(ring.rakePer100 * 100) / 100) : '–'}</b></div>
            <div><span>Tournament prize</span><b>{results.length > 0 ? formatAmount(sumBy(results, r => r.prize)) : 'Did not play'}</b></div>
            <div>
              <span>Tournament net</span>
              <b className={toneClass(sumBy(results, r => r.net))}>{results.length > 0 ? signedAmount(sumBy(results, r => r.net)) : 'Did not play'}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="ck-card">
        <h3>Session history</h3>
        <p className="ck-note">Every ring session this player sat in.</p>
        {!ready
          ? <div className="ck-chart-placeholder" />
          : history.length > 0
            ? <DataTable columns={columns} rows={history} rowKey={r => String(r.sessionId)} initialSort="number" />
            : <ChartEmpty>No stored ring sessions in this range.</ChartEmpty>}
      </div>
    </section>
  )
}

export default ProfileTab
