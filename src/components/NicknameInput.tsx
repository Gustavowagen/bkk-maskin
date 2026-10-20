import React, { useState } from 'react';
import { KNOWN_AGENTS, OWNER_RAKEBACK, rakeShareLabel } from '../types';
import type { AgentRow, NicknameWithLine } from '../types';
import './NicknameInput.css';

interface NicknameInputProps {
  nicknames: NicknameWithLine[];
  onNicknamesChange: (nicknames: NicknameWithLine[]) => void;
  extraExpensesText: string;
  onExtraExpensesTextChange: (text: string) => void;
  extraExpensesInvalid: boolean;
  agentRows: AgentRow[];
  onAgentRowsChange: (rows: AgentRow[]) => void;
  invalidAgentIds: Set<number>;
  agentPlayerNicknames: Set<string>; // Lowercase nicknames of entered agents and their players, hidden from the player table
}

/**
 * One editable row in the player table. Line and rakeback are kept as raw text
 * so partially typed values (e.g. "4,") are not lost while editing.
 */
interface PlayerRow {
  id: number;
  nickname: string;
  lineText: string;
  rakebackText: string;
  owner: boolean;
}

/**
 * Parse a number that may use "," as decimal separator. Returns undefined if invalid.
 */
const parseDecimal = (value: string): number | undefined => {
  const parsed = parseFloat(value.trim().replace(',', '.'));
  return isNaN(parsed) ? undefined : parsed;
};

let nextRowId = 0;

const toRow = (n: NicknameWithLine): PlayerRow => ({
  id: nextRowId++,
  nickname: n.nickname,
  lineText: n.line !== undefined ? String(n.line / 1000) : '',
  rakebackText: n.rakeback !== undefined ? String(n.rakeback) : '',
  owner: n.owner ?? false,
});

/**
 * Convert table rows to nicknames. Rows without a nickname are skipped.
 * Line values are entered in 1000s (e.g., 5 = 5000, 4,5 = 4500), rakeback in percent.
 * Owners always get 100% rakeback.
 */
const rowsToNicknames = (rows: PlayerRow[]): NicknameWithLine[] =>
  rows
    .filter(row => row.nickname.trim().length > 0)
    .map(row => {
      const parsedLine = parseDecimal(row.lineText);
      return {
        nickname: row.nickname.trim(),
        line: parsedLine !== undefined ? parsedLine * 1000 : undefined,
        rakeback: row.owner ? OWNER_RAKEBACK : parseDecimal(row.rakebackText),
        owner: row.owner,
      };
    });

const NicknameInput: React.FC<NicknameInputProps> = ({
  nicknames,
  onNicknamesChange,
  extraExpensesText,
  onExtraExpensesTextChange,
  extraExpensesInvalid,
  agentRows,
  onAgentRowsChange,
  invalidAgentIds,
  agentPlayerNicknames,
}) => {
  const [rows, setRows] = useState<PlayerRow[]>(() => nicknames.map(toRow));
  const [search, setSearch] = useState('');

  // Agent players stay in the nicknames (they are put in the agent tables) but are not shown
  const playerRows = rows.filter(row => !agentPlayerNicknames.has(row.nickname.trim().toLowerCase()));
  const hiddenAgentPlayerCount = rows.length - playerRows.length;

  // Rows without a nickname (just added) stay visible so they can be filled in.
  const searchTerm = search.trim().toLowerCase();
  const visibleRows = searchTerm
    ? playerRows.filter(row => row.nickname.trim() === '' || row.nickname.toLowerCase().includes(searchTerm))
    : playerRows;

  const updateRows = (newRows: PlayerRow[]) => {
    setRows(newRows);
    onNicknamesChange(rowsToNicknames(newRows));
  };

  const updateRow = (id: number, changes: Partial<PlayerRow>) => {
    updateRows(rows.map(row => (row.id === id ? { ...row, ...changes } : row)));
  };

  const addRow = () => {
    updateRows([...rows, toRow({ nickname: '' })]);
  };

  const deleteRow = (id: number) => {
    updateRows(rows.filter(row => row.id !== id));
  };

  const updateAgentRow = (id: number, changes: Partial<AgentRow>) => {
    onAgentRowsChange(agentRows.map(row => (row.id === id ? { ...row, ...changes } : row)));
  };

  const addAgentRow = () => {
    const id = agentRows.reduce((max, row) => Math.max(max, row.id), -1) + 1;
    onAgentRowsChange([...agentRows, { id, name: '', rakeShareText: '', previousBalanceText: '' }]);
  };

  return (
    <div className="nickname-input-container">
      <h3>Active Players</h3>
      <p className="nickname-hint">
        Players with rake in the <code>Member Statistics</code> sheet. Line is in 1000s (e.g. <code>4,5</code> = 4500) and rakeback is in %, both optional. Owners always get 100% rakeback.
      </p>

      <div className="player-search">
        <input
          type="text"
          className="player-input player-search-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search players"
          aria-label="Search players"
        />
        <button
          type="button"
          className="player-search-clear"
          onClick={() => setSearch('')}
          disabled={search === ''}
        >
          Clear search
        </button>
      </div>

      <table className="player-table">
        <thead>
          <tr>
            <th>Nickname</th>
            <th>Line</th>
            <th>Rakeback %</th>
            <th>Owner</th>
            <th aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(row => (
            <tr key={row.id}>
              <td>
                <input
                  type="text"
                  className="player-input"
                  value={row.nickname}
                  onChange={e => updateRow(row.id, { nickname: e.target.value })}
                  placeholder="nickname"
                />
              </td>
              <td>
                <input
                  type="text"
                  inputMode="decimal"
                  className="player-input player-input-number"
                  value={row.lineText}
                  onChange={e => updateRow(row.id, { lineText: e.target.value })}
                  placeholder="—"
                />
              </td>
              <td>
                <input
                  type="text"
                  inputMode="decimal"
                  className="player-input player-input-number"
                  value={row.owner ? String(OWNER_RAKEBACK) : row.rakebackText}
                  onChange={e => updateRow(row.id, { rakebackText: e.target.value })}
                  placeholder="—"
                  disabled={row.owner}
                  title={row.owner ? 'Owners always get 100% rakeback' : undefined}
                />
              </td>
              <td className="player-owner-cell">
                <input
                  type="checkbox"
                  checked={row.owner}
                  onChange={e => updateRow(row.id, { owner: e.target.checked })}
                  aria-label={`${row.nickname || 'Player'} is owner`}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="player-delete-button"
                  onClick={() => deleteRow(row.id)}
                  title="Delete player"
                  aria-label={`Delete ${row.nickname || 'player'}`}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {visibleRows.length === 0 && searchTerm !== '' && (
            <tr>
              <td colSpan={5} className="player-search-empty">No players match "{search.trim()}"</td>
            </tr>
          )}
        </tbody>
      </table>

      {hiddenAgentPlayerCount > 0 && (
        <p className="nickname-hint player-agent-hidden">
          {hiddenAgentPlayerCount} player(s) hidden because they are agents or agent players in the Agents list below. They go in the agent tables, where line and rakeback are not used.
        </p>
      )}

      <button type="button" className="player-add-button" onClick={addRow}>
        + Add player manually
      </button>

      {nicknames.length > 0 && (
        <div className="nickname-summary">
          <p className="summary-text">
            <strong>{nicknames.length}</strong> active player(s)
            {' '}({nicknames.filter(n => n.line !== undefined).length} with line,
            {' '}{nicknames.filter(n => n.rakeback !== undefined).length} with rakeback,
            {' '}{nicknames.filter(n => n.owner).length} owner(s))
          </p>
        </div>
      )}

      <div className="extra-expenses">
        <label htmlFor="extra-expenses-input" className="extra-expenses-label">Ekstra utgifter</label>
        <p className="nickname-hint">
          Other club expenses in chips. Subtracted from the netto rake.
        </p>
        <input
          id="extra-expenses-input"
          type="text"
          inputMode="decimal"
          className={`player-input player-input-number extra-expenses-input${extraExpensesInvalid ? ' player-input-invalid' : ''}`}
          value={extraExpensesText}
          onChange={e => onExtraExpensesTextChange(e.target.value)}
          placeholder="0"
          aria-invalid={extraExpensesInvalid}
        />
        {extraExpensesInvalid && (
          <p className="extra-expenses-error">Must be a number (e.g. <code>1500</code> or <code>1500,5</code>).</p>
        )}
      </div>

      <div className="extra-expenses">
        <span className="extra-expenses-label">Agents</span>
        <p className="nickname-hint">
          Players whose agent in the <code>Member Statistics</code> sheet has this name get their own table, together with the agent.
          Rake % is the agent's share of their total rake and is subtracted from the netto rake.
          Saldo fra før (optional) is the agent's balance from before and is added to their Ny Saldo.
          The first agents are always included with a fixed Rake %; only their Saldo fra før is entered.
        </p>
        <table className="player-table">
          <thead>
            <tr>
              <th>Add Agent</th>
              <th>Rake %</th>
              <th>Saldo fra før</th>
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {agentRows.map(row => {
              const invalid = invalidAgentIds.has(row.id);
              const previousBalanceInvalid = invalid && !/^(-?\d+([.,]\d+)?)?$/.test(row.previousBalanceText.trim());
              const rakeShareInvalid = invalid && row.name.trim() !== '' && !/^\d+([.,]\d+)?$/.test(row.rakeShareText.trim());
              const known = row.known ? KNOWN_AGENTS.find(agent => agent.name === row.name) : undefined;
              return (
                <tr key={row.id}>
                  <td>
                    <input
                      type="text"
                      className={`player-input${invalid && row.name.trim() === '' ? ' player-input-invalid' : ''}`}
                      value={row.name}
                      onChange={e => updateAgentRow(row.id, { name: e.target.value })}
                      placeholder="agent nickname"
                      aria-label="Agent nickname"
                      disabled={row.known}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={`player-input player-input-number${rakeShareInvalid ? ' player-input-invalid' : ''}`}
                      value={known ? rakeShareLabel(known) : row.rakeShareText}
                      onChange={e => updateAgentRow(row.id, { rakeShareText: e.target.value })}
                      placeholder="%"
                      aria-label={`Rake % for ${row.name || 'agent'}`}
                      aria-invalid={rakeShareInvalid}
                      disabled={row.known}
                      title={known ? rakeShareLabel(known) : undefined}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={`player-input player-input-number${previousBalanceInvalid ? ' player-input-invalid' : ''}`}
                      value={row.previousBalanceText}
                      onChange={e => updateAgentRow(row.id, { previousBalanceText: e.target.value })}
                      placeholder="0"
                      aria-label={`Saldo fra før for ${row.name || 'agent'}`}
                      aria-invalid={previousBalanceInvalid}
                    />
                  </td>
                  <td>
                    {!row.known && (
                      <button
                        type="button"
                        className="player-delete-button"
                        onClick={() => onAgentRowsChange(agentRows.filter(r => r.id !== row.id))}
                        title="Delete agent"
                        aria-label={`Delete ${row.name || 'agent'}`}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invalidAgentIds.size > 0 && (
          <p className="extra-expenses-error">Every agent needs a name and a Rake % (e.g. <code>30</code> or <code>27,5</code>), and Saldo fra før must be a number if entered (e.g. <code>-1500</code>).</p>
        )}
        <button type="button" className="player-add-button" onClick={addAgentRow}>
          + Add agent
        </button>
      </div>
    </div>
  );
};

export default NicknameInput;
