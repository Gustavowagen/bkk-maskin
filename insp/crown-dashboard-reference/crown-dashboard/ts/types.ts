// Row types for the five datasets produced by tools/clubgg_to_json.py.
// Times are strings in the export's own clock (UTC-7), "YYYY-MM-DD HH:MM:SS".

export type GameType = 'NLH' | 'PLO5' | string;

/** One ring-game table session (Ring Game Detail sheet). */
export interface Session {
  session: number;      // 1-based, ordered by start time
  table: string;        // e.g. "5/10(2) NLH Straddle"
  game: GameType;
  stake: string;        // game + blinds, e.g. "PLO5 5/10"
  blinds: string;       // e.g. "5/10(2)" (2 = straddle/ante)
  start: string;
  end: string;
  minutes: number;
  players: number;
  hands: number;        // hands summed per seat (ClubGG's way of counting)
  buyin: number;
  rake: number;
  bbj: number;          // bad beat jackpot contribution
}

/** One player's result in one ring session. */
export interface PlayerSession {
  session: number;
  start: string;
  game: GameType;
  stake: string;
  id: string;           // ClubGG member ID "1234-5678"
  player: string;       // nickname
  buyin: number;
  cashout: number;
  hands: number;
  rake: number;
  pnl: number;          // cashout - buyin
}

/** Week totals per club member (Club Overview + Member Statistics + Club Member Balance). */
export interface Member {
  id: string;
  player: string;
  role: 'Player' | 'Agent' | 'Super Agent' | 'Manager' | 'Master' | string;
  agent: string;        // agent nickname, or "Direct" when none
  superAgent: string;   // super agent nickname, or ""
  games: number;
  hands: number;
  fee: number;          // rake + tournament fees paid
  bbj: number;
  pnl: number;          // net result, all games
  pnlNLH: number;
  pnlPLO5: number;
  pnlMTT: number;
  chips: number;        // balance at export
  credits: number;
}

export interface Tournament {
  title: string;
  game: string;
  start: string;
  end: string;
  entries: number;
  gtd: number;
  prizePaid: number;
  overlay: number;
  reentryBuyin: number;
  reentryFee: number;
}

export interface TournamentResult {
  id: string;
  player: string;
  hands: number;
  reentries: number;    // money paid for re-entries (buy-in + fee)
  prize: number;
  net: number;          // prize - reentries
}

export interface ClubData {
  sessions: Session[];
  player_sessions: PlayerSession[];
  members: Member[];
  mtt: Tournament[];
  mtt_results: TournamentResult[];
}

export type ClockZone = 'oslo' | 'club';
