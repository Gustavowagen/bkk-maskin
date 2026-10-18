import { createClient } from '@supabase/supabase-js';
import type { DocumentPeriod, FilterSummary } from './excelUtils';

/**
 * Statistics are stored in Supabase: `periods` (one row per uploaded document) and
 * `player_stats` (one row per player per document). Uploads are saved through the
 * `save_period` function, which replaces a period that is already stored.
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
export const savePeriod = async (period: DocumentPeriod, summary: FilterSummary, fileName: string): Promise<void> => {
  const { error } = await client().rpc('save_period', {
    p_period: {
      period_start: period.start,
      period_end: period.end,
      file_name: fileName,
      brutto_rake: summary.bruttoRake,
      player_rakeback: summary.playerRakeback,
      agent_rakeback: summary.agentRakeback,
      extra_expenses: summary.extraExpenses,
      total_hands: summary.totalHands,
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
    .select('id, period_start, period_end, brutto_rake, player_rakeback, agent_rakeback, extra_expenses, club_net, total_hands')
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
