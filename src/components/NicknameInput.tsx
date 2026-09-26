import React, { useState } from 'react';
import type { NicknameWithLine } from '../types';
import './NicknameInput.css';

interface NicknameInputProps {
  nicknames: NicknameWithLine[];
  onNicknamesChange: (nicknames: NicknameWithLine[]) => void;
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
const OWNER_RAKEBACK = 100;

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

const NicknameInput: React.FC<NicknameInputProps> = ({ nicknames, onNicknamesChange }) => {
  const [rows, setRows] = useState<PlayerRow[]>(() => nicknames.map(toRow));

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

  return (
    <div className="nickname-input-container">
      <h3>Active Players</h3>
      <p className="nickname-hint">
        Players found in the <code>Member Statistics</code> sheet. Line is in 1000s (e.g. <code>4,5</code> = 4500) and rakeback is in %, both optional. Owners always get 100% rakeback.
      </p>

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
          {rows.map(row => (
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
        </tbody>
      </table>

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
    </div>
  );
};

export default NicknameInput;
