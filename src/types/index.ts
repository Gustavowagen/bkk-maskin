export interface NicknameWithLine {
  nickname: string;
  line?: number; // Optional line value
  rakeback?: number; // Optional rakeback in percent (30 = 30%)
  owner?: boolean; // Whether the player is an owner
}

// Owners always get 100% rakeback
export const OWNER_RAKEBACK = 100;

// Players that are marked as owners by default when a file is uploaded (matched case-insensitively)
export const DEFAULT_OWNERS = ['Finnfettfinger', 'sick1sa', 'Dannern', 'Kejila', 'Guccibike', 'shush22', 'Snowie'];

export const isDefaultOwner = (nickname: string): boolean =>
  DEFAULT_OWNERS.some(owner => owner.toLowerCase() === nickname.trim().toLowerCase());

/**
 * Owners that play on more than one account (matched case-insensitively). They count as one owner when
 * the rake is split, and their rake share is split between those of their accounts that are present.
 * When more than one of the accounts is present, a total row with the given name is added below them.
 */
export interface OwnerAccountGroup {
  name: string;
  accounts: string[];
}

export const OWNER_ACCOUNT_GROUPS: OwnerAccountGroup[] = [
  { name: 'Kejila + GucciBike', accounts: ['Kejila', 'Guccibike'] },
  { name: 'shush22 + Snowie', accounts: ['shush22', 'Snowie'] },
];

export interface AgentInput {
  name: string; // Agent nickname, matched against the "Agent" → "Nickname" column in "Member Statistics"
  rakeShare: number; // Agent's share of the total rake of his players and himself, in percent (30 = 30%)
  ownRakeShare?: number; // Agent's share of his own rake, if it differs from rakeShare
  playerRakeShares?: { nickname: string; rakeShare: number }[]; // Players (matched case-insensitively) with a different share
  previousBalance: number; // "Saldo fra før": the agent's balance from before, added to his "Ny Saldo" (0 if not entered)
}

// Agents that are always in the agents list; only their "Saldo fra før" is entered
export const KNOWN_AGENTS: Omit<AgentInput, 'previousBalance'>[] = [
  { name: 'JuniorBedell', rakeShare: 50 },
  { name: 'AndreasBanderas', rakeShare: 50 },
  { name: 'DegenHustlerrr', rakeShare: 50, ownRakeShare: 0, playerRakeShares: [{ nickname: 'Bleiduglad', rakeShare: 75 }] },
  { name: 'CagnusM@rlsen', rakeShare: 50 },
];

/** The agent's rake %, with the exceptions for his own play and single players (e.g. "50%, own 0%, Bleiduglad 75%") */
export const rakeShareLabel = (agent: Omit<AgentInput, 'previousBalance'>): string => [
  `${agent.rakeShare}%`,
  ...(agent.ownRakeShare !== undefined ? [`own ${agent.ownRakeShare}%`] : []),
  ...(agent.playerRakeShares ?? []).map(p => `${p.nickname} ${p.rakeShare}%`),
].join(', ');

/**
 * One editable row in the agents list. Rake % is kept as raw text so partially typed values are not lost.
 */
export interface AgentRow {
  id: number;
  name: string;
  rakeShareText: string;
  previousBalanceText: string; // "Saldo fra før", optional; may be negative
  known?: boolean; // One of KNOWN_AGENTS: name and rake % are fixed and the row can not be deleted
}

export interface AppState {
  file: File | null;
  workbook: any | null; // XLSX.WorkBook
  isProcessing: boolean;
  isFiltered: boolean;
  nicknames: NicknameWithLine[];
}
