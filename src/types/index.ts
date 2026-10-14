export interface NicknameWithLine {
  nickname: string;
  line?: number; // Optional line value
  rakeback?: number; // Optional rakeback in percent (30 = 30%)
  owner?: boolean; // Whether the player is an owner
}

// Owners always get 100% rakeback
export const OWNER_RAKEBACK = 100;

// Players that are marked as owners by default when a file is uploaded (matched case-insensitively)
export const DEFAULT_OWNERS = ['Finnfettfinger', 'sick1sa', 'Dannern', 'Kejila', 'Guccibike', 'shush22'];

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
];

export interface AgentInput {
  name: string; // Agent nickname, matched against the "Agent" → "Nickname" column in "Member Statistics"
  rakeShare: number; // Agent's share of the total rake of his players and himself, in percent (30 = 30%)
  previousBalance: number; // "Saldo fra før": the agent's balance from before, added to his "Ny Saldo" (0 if not entered)
}

/**
 * One editable row in the agents list. Rake % is kept as raw text so partially typed values are not lost.
 */
export interface AgentRow {
  id: number;
  name: string;
  rakeShareText: string;
  previousBalanceText: string; // "Saldo fra før", optional; may be negative
}

export interface AppState {
  file: File | null;
  workbook: any | null; // XLSX.WorkBook
  isProcessing: boolean;
  isFiltered: boolean;
  nicknames: NicknameWithLine[];
}
