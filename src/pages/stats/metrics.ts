// The derived numbers behind the stats page's charts and tables
import { nightOf, wallTime, weekdayOf } from '../../utils/clock'
import type { Clock } from '../../utils/clock'
import type { PeriodRow, RingSessionRow, SessionPlayerRow } from '../../utils/statsApi'

const HOUR = 3_600_000

export const sumBy = <T,>(rows: T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0)

export const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

export const mondayOf = (isoDate: string) => addDays(isoDate, -((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7))

/** The club's money for a list of periods: netto rake = brutto - rakeback - agent rake share - extra expenses */
export const periodTotals = (periods: PeriodRow[]) => ({
  brutto: sumBy(periods, p => p.bruttoRake),
  playerRakeback: sumBy(periods, p => p.playerRakeback),
  agentRakeback: sumBy(periods, p => p.agentRakeback),
  extraExpenses: sumBy(periods, p => p.extraExpenses),
  netto: sumBy(periods, p => p.clubNet),
  bbjContribution: sumBy(periods, p => p.bbjContribution),
  bbjPayout: sumBy(periods, p => p.bbjPayout),
  hands: sumBy(periods, p => p.totalHands),
})

// The common games keep their colour; other games get the spare colours in order of rake
const GAME_COLORS: Record<string, string> = { NLH: '#3b6ea8', PLO5: '#d38b2f', PLO: '#4f9a6a', PLO6: '#8a66b8' }
const SPARE_COLORS = ['#c25b55', '#3f9aa6', '#a3793d']
const OTHER_GAME_COLOR = '#9aa1ad'

/** The games in the sessions, the one with most rake first, each with its chart colour */
export const gamesOf = (sessions: { game: string; rake: number }[]): { game: string; color: string }[] => {
  const rake = new Map<string, number>()
  sessions.forEach(s => rake.set(s.game, (rake.get(s.game) ?? 0) + s.rake))
  let spare = 0
  return [...rake.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([game]) => ({ game, color: GAME_COLORS[game] ?? SPARE_COLORS[spare++] ?? OTHER_GAME_COLOR }))
}

export interface TimedSession {
  session: RingSessionRow;
  start: number; // Wall time in the chosen clock
  end: number;
  night: string; // The night it opened on (a night runs 06:00 to 06:00)
}

export const timeSessions = (sessions: RingSessionRow[], clock: Clock): TimedSession[] =>
  sessions.map(session => {
    const start = wallTime(session.startedAt, clock, session.utcOffsetMinutes)
    return { session, start, end: wallTime(session.endedAt, clock, session.utcOffsetMinutes), night: nightOf(start) }
  })

export interface RakeBucket {
  key: string; // The night, or the Monday of the week
  byGame: Record<string, { rake: number; sessions: number }>;
  total: number;
}

/** Ring rake per night (or per week) and game, counting each session on the night it opened */
export const rakeByNight = (timed: TimedSession[], weekly: boolean): RakeBucket[] => {
  const buckets = new Map<string, RakeBucket>()
  timed.forEach(({ session, night }) => {
    const key = weekly ? mondayOf(night) : night
    const bucket = buckets.get(key) ?? { key, byGame: {}, total: 0 }
    const game = bucket.byGame[session.game] ?? { rake: 0, sessions: 0 }
    game.rake += session.rake
    game.sessions += 1
    bucket.byGame[session.game] = game
    bucket.total += session.rake
    buckets.set(key, bucket)
  })
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export interface HeatCell {
  weekday: number; // 0 = Monday, the night the hour belongs to
  slot: number; // 0 = 06:00 ... 23 = 05:00
  tables: number; // Average number of open tables
}

/**
 * Average number of tables open in each hour, by night of the week. Each session is split into clock
 * hours; the table-hours are divided by the number of nights of that weekday that had any table.
 */
export const openTablesByHour = (timed: TimedSession[]): HeatCell[] => {
  const tableHours = new Map<string, number>()
  const nights = new Map<number, Set<string>>()
  timed.forEach(({ start, end, night }) => {
    const weekdayNights = nights.get(weekdayOf(night)) ?? new Set<string>()
    weekdayNights.add(night)
    nights.set(weekdayOf(night), weekdayNights)
    for (let t = Math.floor(start / HOUR) * HOUR; t < end; t += HOUR) {
      const part = (Math.min(end, t + HOUR) - Math.max(start, t)) / HOUR
      if (part <= 0) continue
      const weekday = weekdayOf(nightOf(t))
      const slot = (new Date(t).getUTCHours() + 18) % 24
      const key = `${weekday}|${slot}`
      tableHours.set(key, (tableHours.get(key) ?? 0) + part)
    }
  })
  return [...tableHours.entries()].map(([key, hours]) => {
    const [weekday, slot] = key.split('|').map(Number)
    return { weekday, slot, tables: hours / Math.max(1, nights.get(weekday)?.size ?? 1) }
  })
}

export interface StakeRow {
  stake: string;
  game: string;
  sessions: number;
  hours: number;
  avgPlayers: number;
  hands: number;
  rakePerHour: number;
  rake: number;
}

export const resultsByStake = (sessions: RingSessionRow[]): StakeRow[] => {
  const stakes = new Map<string, { game: string; sessions: number; minutes: number; hands: number; rake: number; seats: number }>()
  sessions.forEach(s => {
    const row = stakes.get(s.stake) ?? { game: s.game, sessions: 0, minutes: 0, hands: 0, rake: 0, seats: 0 }
    row.sessions += 1
    row.minutes += s.minutes
    row.hands += s.hands
    row.rake += s.rake
    row.seats += s.players
    stakes.set(s.stake, row)
  })
  return [...stakes.entries()].map(([stake, r]) => ({
    stake,
    game: r.game,
    sessions: r.sessions,
    hours: r.minutes / 60,
    avgPlayers: r.seats / r.sessions,
    hands: r.hands,
    rakePerHour: r.minutes > 0 ? r.rake / (r.minutes / 60) : 0,
    rake: r.rake,
  }))
}

export interface RingProfile {
  sessions: number;
  winShare: number; // Share of the sessions that ended in profit
  buyin: number;
  avgBuyin: number;
  biggestWin: number;
  biggestLoss: number;
  favStake: string;
  rakePer100: number;
}

/** A player's ring game habits, worked out from every session */
export const ringProfile = (rows: SessionPlayerRow[]): RingProfile | undefined => {
  if (rows.length === 0) return undefined
  const stakes = new Map<string, number>()
  rows.forEach(r => stakes.set(r.stake, (stakes.get(r.stake) ?? 0) + 1))
  const buyin = sumBy(rows, r => r.buyin)
  const hands = sumBy(rows, r => r.hands)
  return {
    sessions: rows.length,
    winShare: rows.filter(r => r.profitLoss > 0).length / rows.length,
    buyin,
    avgBuyin: buyin / rows.length,
    biggestWin: Math.max(0, ...rows.map(r => r.profitLoss)),
    biggestLoss: Math.min(0, ...rows.map(r => r.profitLoss)),
    favStake: [...stakes.entries()].sort((a, b) => b[1] - a[1])[0][0],
    rakePer100: hands > 0 ? (sumBy(rows, r => r.rake) / hands) * 100 : 0,
  }
}

export interface NightResult {
  key: string;
  rake: number;
  profitLoss: number;
  hands: number;
}

/** Ring rake, P&L and hands of the given player rows per night (or per week) */
export const resultsByNight = (rows: SessionPlayerRow[], clock: Clock, weekly: boolean): NightResult[] => {
  const buckets = new Map<string, NightResult>()
  rows.forEach(r => {
    const night = nightOf(wallTime(r.startedAt, clock, r.utcOffsetMinutes))
    const key = weekly ? mondayOf(night) : night
    const bucket = buckets.get(key) ?? { key, rake: 0, profitLoss: 0, hands: 0 }
    bucket.rake += r.rake
    bucket.profitLoss += r.profitLoss
    bucket.hands += r.hands
    buckets.set(key, bucket)
  })
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Every night (or Monday of a week) from `from` to `to`, so charts show the nights without play as well */
export const nightsInRange = (from: string, to: string, weekly: boolean): string[] => {
  const keys: string[] = []
  for (let day = weekly ? mondayOf(from) : from; day <= to; day = addDays(day, weekly ? 7 : 1)) keys.push(day)
  return keys
}
