// Pure functions behind every number on the dashboard. Ported 1:1 from the
// `dash.calc(...)` blocks in ../index.html, so results match the reference page.
import type { ClockZone, Member, PlayerSession, Session } from './types';

const HOUR = 3600e3;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((t, r) => t + f(r), 0);

/** Export clock is UTC-7. Oslo is UTC+2 in summer time (to 25 Oct 2026), so +9 h.
 *  NOTE: hard-coded for this week; use a real tz library (e.g. date-fns-tz) for other weeks. */
export const OFFSET_HOURS: Record<ClockZone, number> = { oslo: 9, club: 0 };

/** Parse an export timestamp and shift it; read the result with getUTC* methods. */
export function shiftTime(s: string, tz: ClockZone): Date {
  return new Date(Date.parse(s.replace(' ', 'T') + 'Z') + OFFSET_HOURS[tz] * HOUR);
}

// ---------------------------------------------------------------- headline
export function weekTotals(members: Member[], sessions: Session[]) {
  const fees = sum(members, (m) => m.fee);
  const ringRake = sum(sessions, (s) => s.rake);
  const tableHours = sum(sessions, (s) => s.minutes) / 60;
  const plo = sum(sessions.filter((s) => s.game === 'PLO5'), (s) => s.rake);
  const top10 = members.map((m) => m.fee).sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  return {
    fees: Math.round(fees),
    ringRake: Math.round(ringRake),
    sessions: sessions.length,
    tableHours: Math.round(tableHours),
    rakePerHour: Math.round(ringRake / tableHours),
    hands: sum(sessions, (s) => s.hands),
    activePlayers: members.filter((m) => m.hands > 0).length,
    members: members.length,
    ploShare: plo / ringRake,
    top10Share: top10 / fees,
  };
}

// ---------------------------------------------------------------- overview
export interface DailyRow { day: string; game: string; rake: number; hands: number; sessions: number }
/** Ring rake per night (by the export-clock date each session opened) and game. */
export function dailyRake(sessions: Session[]): DailyRow[] {
  const m = new Map<string, DailyRow>();
  for (const s of sessions) {
    const day = s.start.slice(0, 10);
    const k = `${day}|${s.game}`;
    const r = m.get(k) ?? { day, game: s.game, rake: 0, hands: 0, sessions: 0 };
    r.rake += s.rake; r.hands += s.hands; r.sessions += 1;
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ ...r, rake: round2(r.rake) })).sort((a, b) => (a.day + a.game < b.day + b.game ? -1 : 1));
}

export interface HeatCell { weekday: number; slot: number; hour: number; tableHours: number }
/** Average open tables per hour. weekday 0=Mon is the *night* (a night runs 06:00-06:00);
 *  slot 0 = 06:00, so slot = (hour + 18) % 24. */
export function openTablesByHour(sessions: Session[], tz: ClockZone): HeatCell[] {
  const out = new Map<string, HeatCell>();
  for (const s of sessions) {
    const a = shiftTime(s.start, tz).getTime();
    const b = shiftTime(s.end, tz).getTime();
    for (let t = Math.floor(a / HOUR) * HOUR; t < b; t += HOUR) {
      const part = (Math.min(b, t + HOUR) - Math.max(a, t)) / HOUR;
      if (part <= 0) continue;
      const weekday = (new Date(t - 6 * HOUR).getUTCDay() + 6) % 7;
      const hour = new Date(t).getUTCHours();
      const slot = (hour + 18) % 24;
      const k = `${weekday}|${slot}`;
      const r = out.get(k) ?? { weekday, slot, hour, tableHours: 0 };
      r.tableHours += part;
      out.set(k, r);
    }
  }
  return [...out.values()].map((r) => ({ ...r, tableHours: round2(r.tableHours) }));
}

export function resultsByStake(sessions: Session[]) {
  const m = new Map<string, { stake: string; sessions: number; minutes: number; hands: number; rake: number; seats: number }>();
  for (const s of sessions) {
    const r = m.get(s.stake) ?? { stake: s.stake, sessions: 0, minutes: 0, hands: 0, rake: 0, seats: 0 };
    r.sessions += 1; r.minutes += s.minutes; r.hands += s.hands; r.rake += s.rake; r.seats += s.players;
    m.set(s.stake, r);
  }
  return [...m.values()].map((r) => ({
    stake: r.stake, sessions: r.sessions, hours: Math.round(r.minutes / 6) / 10, hands: r.hands,
    rake: round2(r.rake), rakePerHour: Math.round(r.rake / (r.minutes / 60)), avgPlayers: Math.round((r.seats / r.sessions) * 10) / 10,
  })).sort((a, b) => b.rake - a.rake);
}

// ---------------------------------------------------------------- agents
/** Every nickname that is someone's agent or super agent. */
export function agentNames(members: Member[]): Set<string> {
  const names = new Set<string>();
  for (const m of members) { if (m.agent !== 'Direct') names.add(m.agent); if (m.superAgent) names.add(m.superAgent); }
  return names;
}

/** Which downlines a member belongs to: their agent, their super agent, and
 *  themselves if they are an agent. Members with none belong to "Direct". */
export function ownersOf(m: Member, names: Set<string>): Set<string> {
  const o = new Set<string>();
  if (m.agent !== 'Direct') o.add(m.agent);
  if (m.superAgent) o.add(m.superAgent);
  if (names.has(m.player)) o.add(m.player);
  if (!o.size) o.add('Direct');
  return o;
}

export interface AgentRow { agent: string; role: string; players: number; active: number; hands: number; fee: number; pnl: number; chips: number }
export function agentDownlines(members: Member[]): AgentRow[] {
  const names = agentNames(members);
  return [...names, 'Direct'].map((agent) => {
    const self = members.find((m) => m.player === agent);
    const down = members.filter((m) => ownersOf(m, names).has(agent));
    const s = (f: (m: Member) => number) => round2(sum(down, f));
    return {
      agent, role: agent === 'Direct' ? 'No agent' : self?.role ?? 'Agent',
      players: down.length, active: down.filter((m) => m.hands > 0).length,
      hands: s((m) => m.hands), fee: s((m) => m.fee), pnl: s((m) => m.pnl), chips: s((m) => m.chips),
    };
  }).sort((a, b) => Number(a.agent === 'Direct') - Number(b.agent === 'Direct') || b.fee - a.fee);
}

export function downlineMembers(members: Member[], agent: string): Member[] {
  const names = agentNames(members);
  return members.filter((m) => ownersOf(m, names).has(agent));
}

export interface AgentDayRow { agent: string; day: string; rake: number; pnl: number; hands: number; seats: number }
export function agentDaily(playerSessions: PlayerSession[], members: Member[]): AgentDayRow[] {
  const names = agentNames(members);
  const byId = new Map(members.map((m) => [m.id, m]));
  const out = new Map<string, AgentDayRow>();
  for (const p of playerSessions) {
    const m = byId.get(p.id);
    if (!m) continue;
    const day = p.start.slice(0, 10);
    for (const agent of ownersOf(m, names)) {
      const k = `${agent}|${day}`;
      const r = out.get(k) ?? { agent, day, rake: 0, pnl: 0, hands: 0, seats: 0 };
      r.rake += p.rake; r.pnl += p.pnl; r.hands += p.hands; r.seats += 1;
      out.set(k, r);
    }
  }
  return [...out.values()].map((r) => ({ ...r, rake: round2(r.rake), pnl: round2(r.pnl) })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

// ---------------------------------------------------------------- player profile
export interface PlayerStats {
  id: string; player: string; sessions: number; winShare: number; buyin: number; avgBuyin: number;
  biggestWin: number; biggestLoss: number; favStake: string; rakePer100: number;
}
export function playerStats(playerSessions: PlayerSession[]): Map<string, PlayerStats> {
  const acc = new Map<string, { id: string; player: string; sessions: number; wins: number; hands: number; rake: number; buyin: number; best: number; worst: number; stakes: Record<string, number> }>();
  for (const p of playerSessions) {
    const r = acc.get(p.id) ?? { id: p.id, player: p.player, sessions: 0, wins: 0, hands: 0, rake: 0, buyin: 0, best: -Infinity, worst: Infinity, stakes: {} };
    r.sessions += 1; r.wins += p.pnl > 0 ? 1 : 0; r.hands += p.hands; r.rake += p.rake; r.buyin += p.buyin;
    r.best = Math.max(r.best, p.pnl); r.worst = Math.min(r.worst, p.pnl);
    r.stakes[p.stake] = (r.stakes[p.stake] ?? 0) + 1;
    acc.set(p.id, r);
  }
  const out = new Map<string, PlayerStats>();
  for (const r of acc.values()) {
    out.set(r.id, {
      id: r.id, player: r.player, sessions: r.sessions, winShare: r.wins / r.sessions,
      buyin: round2(r.buyin), avgBuyin: Math.round(r.buyin / r.sessions),
      biggestWin: Math.max(0, round2(r.best)), biggestLoss: Math.min(0, round2(r.worst)),
      favStake: Object.entries(r.stakes).sort((a, b) => b[1] - a[1])[0][0],
      rakePer100: r.hands ? round2((r.rake / r.hands) * 100) : 0,
    });
  }
  return out;
}

/** A player's ring sessions in time order with a running total. */
export function runningResult(playerSessions: PlayerSession[], id: string) {
  let run = 0;
  return playerSessions
    .filter((p) => p.id === id)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((p) => { run += p.pnl; return { ...p, running: round2(run) }; });
}
