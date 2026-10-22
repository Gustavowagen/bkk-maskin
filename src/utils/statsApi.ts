import { createClient } from '@supabase/supabase-js';
import type { DocumentPeriod, FilterSummary } from './excelUtils';
import type { ExportDetail } from './exportDetail';

/**
 * Statistics are stored in Supabase: `periods` (one row per uploaded document) and
 * `player_stats` (one row per player per document), `ring_sessions` + `ring_session_players`
 * (every ring game table and its players) and `tournaments` + `tournament_results`.
 * Uploads are saved through the `save_period` function, which replaces a period that is already stored.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const client = () => {
  if (!supabase) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY is not set, so statistics are unavailable.');
  return supabase;
};

export interface PeriodRow {
  id: number;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  bruttoRake: number;
  playerRakeback: number;
  agentRakeback: number;
  extraExpenses: number;
  clubNet: number;
  totalHands: number;
  bbjContribution: number;
  bbjPayout: number;
  clubName: string;
  utcOffsetMinutes: number; // The export's clock, e.g. -420 for UTC -7:00
  memberCount: number;
}

export interface PlayerTotalRow {
  nickname: string;
  realName: string;
  agent: string;
  isAgent: boolean;
  owner: boolean;
  rake: number;
  rakeback: number;
  agentShare: number;
  profitLoss: number;
  hands: number;
  periodsPlayed: number;
  memberId: string;
  role: string;
  games: number;
  chips: number; // At the export of the latest period in the range
  gamePnl: Record<string, number>;
}

export interface AgentTotalRow {
  agent: string;
  realName: string;
  players: number; // Players (not counting the agent) that played in the range
  rake: number; // Players' and the agent's rake
  ownRake: number;
  agentShare: number; // Rake share paid to the agent
  sharedRake: number; // Rake that the rake share was calculated from (periods where the agent was entered)
  profitLoss: number; // Players' and the agent's P&L
  hands: number;
  periodsActive: number;
}

export interface PlayerHistoryRow {
  periodStart: string;
  rake: number;
  profitLoss: number;
  hands: number;
}

/** Save the stats of a filtered document. A period that is already stored is replaced. */
export const savePeriod = async (period: DocumentPeriod, summary: FilterSummary, detail: ExportDetail, fileName: string): Promise<void> => {
  const { error } = await client().rpc('save_period', {
    p_period: {
      period_start: period.start,
      period_end: period.end,
      file_name: fileName,
      club_name: detail.clubName,
      utc_offset_minutes: detail.utcOffsetMinutes,
      member_count: detail.memberCount,
      brutto_rake: summary.bruttoRake,
      player_rakeback: summary.playerRakeback,
      agent_rakeback: summary.agentRakeback,
      extra_expenses: summary.extraExpenses,
      total_hands: summary.totalHands,
      bbj_contribution: summary.bbjContribution,
      bbj_payout: summary.bbjPayout,
    },
    p_players: summary.players.map(player => ({
      nickname: player.nickname,
      real_name: player.realName,
      agent: player.agent,
      is_agent: player.isAgent,
      owner: player.owner,
      rake: player.rake,
      rakeback: player.rakeback,
      agent_share: player.agentShare,
      profit_loss: player.profitLoss,
      hands: player.hands,
      member_id: player.memberId,
      role: player.role,
      games: player.games,
      chips: player.chips,
      game_pnl: player.gamePnl,
    })),
    p_sessions: detail.sessions.map(session => ({
      table_name: session.tableName,
      game: session.game,
      blinds: session.blinds,
      stake: session.stake,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      hands: session.hands,
      buyin: session.buyin,
      rake: session.rake,
      bbj: session.bbj,
      players: session.players.map(p => ({
        member_id: p.memberId,
        nickname: p.nickname,
        buyin: p.buyin,
        cashout: p.cashout,
        hands: p.hands,
        rake: p.rake,
        profit_loss: p.profitLoss,
      })),
    })),
    p_tournaments: detail.tournaments.map(t => ({
      title: t.title,
      game: t.game,
      reentry: t.reentry,
      started_at: t.startedAt,
      ended_at: t.endedAt,
      entries: t.entries,
      gtd: t.gtd,
      prize_paid: t.prizePaid,
      overlay: t.overlay,
      buyin_total: t.buyinTotal,
      fee_total: t.feeTotal,
      results: t.results.map(r => ({ member_id: r.memberId, nickname: r.nickname, hands: r.hands, paid: r.paid, prize: r.prize, net: r.net })),
    })),
  });
  if (error) throw new Error(`Could not save statistics: ${error.message}`);
};

/** TEMPORARY: erase every stored period and player stat */
export const resetStats = async (): Promise<void> => {
  const { error } = await client().rpc('reset_stats');
  if (error) throw new Error(`Could not reset statistics: ${error.message}`);
};

export interface UploadLogRow {
  id: number;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  uploadedAt: string; // ISO timestamp
  players: number;
  bruttoRake: number;
  clubNet: number;
}

/** Every stored period with the file it came from, latest upload first */
export const fetchUploadLog = async (): Promise<UploadLogRow[]> => {
  const { data, error } = await client()
    .from('periods')
    .select('id, period_start, period_end, file_name, uploaded_at, brutto_rake, club_net, player_stats(count)')
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(`Could not load the upload log: ${error.message}`);
  return data.map(row => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fileName: row.file_name ?? '',
    uploadedAt: row.uploaded_at,
    players: Number((row.player_stats as unknown as { count: number }[])[0]?.count ?? 0),
    bruttoRake: Number(row.brutto_rake),
    clubNet: Number(row.club_net),
  }));
};

/** Delete a stored period and its player stats */
export const deletePeriod = async (id: number): Promise<void> => {
  const { error } = await client().rpc('delete_period', { p_id: id });
  if (error) throw new Error(`Could not delete the upload: ${error.message}`);
};

/** The latest stored period start, or undefined if nothing is stored yet */
export const fetchLatestPeriodStart = async (): Promise<string | undefined> => {
  const { data, error } = await client().from('periods').select('period_start').order('period_start', { ascending: false }).limit(1);
  if (error) throw new Error(`Could not load statistics: ${error.message}`);
  return data[0]?.period_start;
};

/** All periods that start within [from, to], oldest first */
export const fetchPeriods = async (from: string, to: string): Promise<PeriodRow[]> => {
  const { data, error } = await client()
    .from('periods')
    .select('id, period_start, period_end, brutto_rake, player_rakeback, agent_rakeback, extra_expenses, club_net, total_hands, bbj_contribution, bbj_payout, club_name, utc_offset_minutes, member_count')
    .gte('period_start', from)
    .lte('period_start', to)
    .order('period_start');
  if (error) throw new Error(`Could not load statistics: ${error.message}`);
  return data.map(row => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    bruttoRake: Number(row.brutto_rake),
    playerRakeback: Number(row.player_rakeback),
    agentRakeback: Number(row.agent_rakeback),
    extraExpenses: Number(row.extra_expenses),
    clubNet: Number(row.club_net),
    totalHands: Number(row.total_hands),
    bbjContribution: Number(row.bbj_contribution),
    bbjPayout: Number(row.bbj_payout),
    clubName: row.club_name ?? '',
    utcOffsetMinutes: Number(row.utc_offset_minutes),
    memberCount: Number(row.member_count),
  }));
};

/** Totals per player over the periods that start within [from, to] */
export const fetchPlayerTotals = async (from: string, to: string): Promise<PlayerTotalRow[]> => {
  const { data, error } = await client().rpc('player_totals', { p_from: from, p_to: to });
  if (error) throw new Error(`Could not load player statistics: ${error.message}`);
  return (data as Record<string, unknown>[]).map(row => ({
    nickname: String(row.nickname),
    realName: String(row.real_name ?? ''),
    agent: String(row.agent ?? ''),
    isAgent: Boolean(row.is_agent),
    owner: Boolean(row.owner),
    rake: Number(row.rake),
    rakeback: Number(row.rakeback),
    agentShare: Number(row.agent_share),
    profitLoss: Number(row.profit_loss),
    hands: Number(row.hands),
    periodsPlayed: Number(row.periods_played),
    memberId: String(row.member_id ?? ''),
    role: String(row.role ?? ''),
    games: Number(row.games ?? 0),
    chips: Number(row.chips ?? 0),
    gamePnl: Object.fromEntries(Object.entries((row.game_pnl ?? {}) as Record<string, unknown>).map(([game, value]) => [game, Number(value)])),
  }));
};

/** Totals per agent (his own rows and his players') over the periods that start within [from, to] */
export const fetchAgentTotals = async (from: string, to: string): Promise<AgentTotalRow[]> => {
  const { data, error } = await client().rpc('agent_totals', { p_from: from, p_to: to });
  if (error) throw new Error(`Could not load agent statistics: ${error.message}`);
  return (data as Record<string, unknown>[]).map(row => ({
    agent: String(row.agent),
    realName: String(row.real_name ?? ''),
    players: Number(row.players),
    rake: Number(row.rake),
    ownRake: Number(row.own_rake),
    agentShare: Number(row.agent_share),
    sharedRake: Number(row.shared_rake),
    profitLoss: Number(row.profit_loss),
    hands: Number(row.hands),
    periodsActive: Number(row.periods_active),
  }));
};

/** One player's numbers per period within [from, to], oldest first */
export const fetchPlayerHistory = async (nickname: string, from: string, to: string): Promise<PlayerHistoryRow[]> => {
  const { data, error } = await client()
    .from('player_stats')
    .select('rake, profit_loss, hands, periods!inner(period_start)')
    .ilike('nickname', nickname.replace(/[\\%_]/g, '\\$&'))
    .gte('periods.period_start', from)
    .lte('periods.period_start', to);
  if (error) throw new Error(`Could not load player history: ${error.message}`);
  return data
    .map(row => {
      const period = row.periods as unknown as { period_start: string };
      return { periodStart: period.period_start, rake: Number(row.rake), profitLoss: Number(row.profit_loss), hands: Number(row.hands) };
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
};

// Supabase returns at most 1000 rows per request, so longer lists are read page by page
const PAGE_SIZE = 1000;

type PageQuery = (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

const fetchAllPages = async (query: PageQuery, what: string): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
};

/** The upload a row belongs to, read from an embedded `periods(period_start, utc_offset_minutes)` */
const embeddedPeriod = (row: Record<string, unknown>) =>
  row.periods as { period_start: string; utc_offset_minutes: number };

export interface RingSessionRow {
  id: number;
  periodId: number;
  periodStart: string;
  utcOffsetMinutes: number; // The export clock of the upload the session came from
  tableName: string;
  game: string;
  stake: string;
  startedAt: string; // ISO timestamp
  endedAt: string;
  minutes: number;
  players: number;
  hands: number;
  buyin: number;
  rake: number;
  bbj: number;
}

/** Every ring game table in the periods that start within [from, to] */
export const fetchRingSessions = async (from: string, to: string): Promise<RingSessionRow[]> => {
  const rows = await fetchAllPages((start, end) => client()
    .from('ring_sessions')
    .select('id, period_id, table_name, game, stake, started_at, ended_at, players, hands, buyin, rake, bbj, periods!inner(period_start, utc_offset_minutes)')
    .gte('periods.period_start', from)
    .lte('periods.period_start', to)
    .order('id')
    .range(start, end), 'ring sessions');
  return rows.map(row => {
    const period = embeddedPeriod(row);
    const startedAt = String(row.started_at);
    const endedAt = String(row.ended_at);
    return {
      id: Number(row.id),
      periodId: Number(row.period_id),
      periodStart: period.period_start,
      utcOffsetMinutes: Number(period.utc_offset_minutes),
      tableName: String(row.table_name),
      game: String(row.game),
      stake: String(row.stake),
      startedAt,
      endedAt,
      minutes: Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 6000) / 10,
      players: Number(row.players),
      hands: Number(row.hands),
      buyin: Number(row.buyin),
      rake: Number(row.rake),
      bbj: Number(row.bbj),
    };
  });
};

export interface SessionPlayerRow {
  sessionId: number;
  utcOffsetMinutes: number;
  startedAt: string;
  game: string;
  stake: string;
  memberId: string;
  nickname: string;
  buyin: number;
  cashout: number;
  hands: number;
  rake: number;
  profitLoss: number;
}

// An exact (case-insensitive) ilike pattern, quoted for a PostgREST `or` filter
const escapeFilterValue = (value: string) => `"${value.replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&')}"`;

/**
 * The ring game results of the given players (matched case-insensitively) in the periods that start
 * within [from, to], in time order
 */
export const fetchSessionPlayers = async (nicknames: string[], from: string, to: string): Promise<SessionPlayerRow[]> => {
  if (nicknames.length === 0) return [];
  const rows = await fetchAllPages((start, end) => client()
    .from('ring_session_players')
    .select('id, session_id, member_id, nickname, buyin, cashout, hands, rake, profit_loss, ring_sessions!inner(started_at, game, stake), periods!inner(period_start, utc_offset_minutes)')
    .or(nicknames.map(n => `nickname.ilike.${escapeFilterValue(n)}`).join(','))
    .gte('periods.period_start', from)
    .lte('periods.period_start', to)
    .order('id')
    .range(start, end), 'session history');
  return rows
    .map(row => {
      const session = row.ring_sessions as { started_at: string; game: string; stake: string };
      return {
        sessionId: Number(row.session_id),
        utcOffsetMinutes: Number(embeddedPeriod(row).utc_offset_minutes),
        startedAt: session.started_at,
        game: session.game,
        stake: session.stake,
        memberId: String(row.member_id ?? ''),
        nickname: String(row.nickname),
        buyin: Number(row.buyin),
        cashout: Number(row.cashout),
        hands: Number(row.hands),
        rake: Number(row.rake),
        profitLoss: Number(row.profit_loss),
      };
    })
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.sessionId - b.sessionId);
};

export interface TournamentResultRow {
  memberId: string;
  nickname: string;
  hands: number;
  paid: number; // Buy-ins, re-entries and their fees
  prize: number;
  net: number;
}

export interface TournamentRow {
  id: number;
  utcOffsetMinutes: number;
  title: string;
  game: string;
  reentry: string;
  startedAt: string; // ISO timestamp, '' if unknown
  endedAt: string;
  entries: number;
  gtd: number;
  prizePaid: number;
  overlay: number;
  buyinTotal: number; // Buy-ins and re-entries, without fees
  feeTotal: number; // Buy-in and re-entry fees, kept by the club
  results: TournamentResultRow[];
}

/** Every tournament with its results in the periods that start within [from, to], latest first */
export const fetchTournaments = async (from: string, to: string): Promise<TournamentRow[]> => {
  const rows = await fetchAllPages((start, end) => client()
    .from('tournaments')
    .select('id, title, game, reentry, started_at, ended_at, entries, gtd, prize_paid, overlay, buyin_total, fee_total, tournament_results(member_id, nickname, hands, paid, prize, net), periods!inner(period_start, utc_offset_minutes)')
    .gte('periods.period_start', from)
    .lte('periods.period_start', to)
    .order('id')
    .range(start, end), 'tournaments');
  return rows
    .map(row => ({
      id: Number(row.id),
      utcOffsetMinutes: Number(embeddedPeriod(row).utc_offset_minutes),
      title: String(row.title),
      game: String(row.game ?? ''),
      reentry: String(row.reentry ?? ''),
      startedAt: String(row.started_at ?? ''),
      endedAt: String(row.ended_at ?? ''),
      entries: Number(row.entries),
      gtd: Number(row.gtd),
      prizePaid: Number(row.prize_paid),
      overlay: Number(row.overlay),
      buyinTotal: Number(row.buyin_total),
      feeTotal: Number(row.fee_total),
      results: ((row.tournament_results ?? []) as Record<string, unknown>[]).map(r => ({
        memberId: String(r.member_id ?? ''),
        nickname: String(r.nickname),
        hands: Number(r.hands),
        paid: Number(r.paid),
        prize: Number(r.prize),
        net: Number(r.net),
      })),
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};
