import type { Clock } from '../../utils/clock'
import type { AgentTotalRow, PeriodRow, PlayerTotalRow, RingSessionRow, TournamentRow } from '../../utils/statsApi'

export interface DateRange {
  from: string;
  to: string;
}

/** Everything the stats page loads for the chosen range */
export interface StatsData {
  range: DateRange; // Periods that start within it are included
  firstDay: string; // The first day the included periods cover (the range start if there are none)
  lastDay: string; // The last day the included periods cover (a weekly upload ends after its start)
  weekly: boolean; // Long ranges are charted per week instead of per night
  rangeLabel: string; // e.g. "30 days", for "vs prev. 30 days"
  periods: PeriodRow[];
  previousPeriods: PeriodRow[]; // The range just before, for the change shown on the tiles
  players: PlayerTotalRow[];
  agents: AgentTotalRow[];
  sessions: RingSessionRow[];
  tournaments: TournamentRow[];
}

export interface TabProps {
  data: StatsData;
  clock: Clock;
  openPlayer: (nickname: string) => void;
  openAgent: (agent: string) => void;
  onError: (message: string) => void;
}

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Players without rake or hands did not play in the range */
export const hasPlayed = (player: { rake: number; hands: number }) => player.rake !== 0 || player.hands !== 0
