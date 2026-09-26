import React, { useState, useEffect } from 'react';
import type { NicknameWithLine } from '../types';
import './NicknameInput.css';

interface NicknameInputProps {
  nicknames: NicknameWithLine[];
  onNicknamesChange: (nicknames: NicknameWithLine[]) => void;
}

/**
 * Parse a number that may use "," as decimal separator. Returns undefined if invalid.
 */
const parseDecimal = (value: string): number | undefined => {
  const parsed = parseFloat(value.trim().replace(',', '.'));
  return isNaN(parsed) ? undefined : parsed;
};

/**
 * Parse textarea content to extract nicknames, optional lines and optional rakeback
 * Format:
 * - "nickname", "nickname/line", "nickname#rakeback" or "nickname/line#rakeback"
 * - One entry per line
 * - Line values are in 1000s (e.g., 5 = 5000, 4.5 = 4500)
 * - Rakeback is in percent (e.g., 30 = 30%)
 * - Accepts both "." and "," as decimal separators
 * Examples:
 * - "gus" -> {nickname: "gus"}
 * - "gus/5" -> {nickname: "gus", line: 5000}
 * - "gus/4,728" -> {nickname: "gus", line: 4728}
 * - "gus#30" -> {nickname: "gus", rakeback: 30}
 * - "gus/10#30" -> {nickname: "gus", line: 10000, rakeback: 30}
 */
const parseNicknameText = (text: string): NicknameWithLine[] => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const nicknames: NicknameWithLine[] = [];

  lines.forEach(line => {
    let rest = line;
    let rakeback: number | undefined;
    let lineValue: number | undefined;

    const hashIndex = rest.lastIndexOf('#');
    if (hashIndex !== -1) {
      rakeback = parseDecimal(rest.slice(hashIndex + 1));
      rest = rest.slice(0, hashIndex);
    }

    const slashIndex = rest.lastIndexOf('/');
    if (slashIndex !== -1) {
      const parsedLine = parseDecimal(rest.slice(slashIndex + 1));
      lineValue = parsedLine !== undefined ? parsedLine * 1000 : undefined;
      rest = rest.slice(0, slashIndex);
    }

    const nickname = rest.trim();
    if (nickname) {
      nicknames.push({ nickname, line: lineValue, rakeback });
    }
  });

  return nicknames;
};

/**
 * Convert nicknames array back to text format for display
 * Line values are divided by 1000 for display
 */
const formatNicknamesAsText = (nicknames: NicknameWithLine[]): string => {
  return nicknames.map(n => {
    let text = n.nickname;
    if (n.line !== undefined) text += `/${n.line / 1000}`;
    if (n.rakeback !== undefined) text += `#${n.rakeback}`;
    return text;
  }).join('\n');
};

const NicknameInput: React.FC<NicknameInputProps> = ({ nicknames, onNicknamesChange }) => {
  const [textValue, setTextValue] = useState('');

  // Initialize text value from nicknames prop
  useEffect(() => {
    setTextValue(formatNicknamesAsText(nicknames));
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setTextValue(newText);
    
    // Parse and update nicknames
    const parsedNicknames = parseNicknameText(newText);
    onNicknamesChange(parsedNicknames);
  };

  return (
    <div className="nickname-input-container">
      <h3>Active Players</h3>
      <p className="nickname-hint">
        Players found in the <code>Member Statistics</code> sheet. Format: <code>nickname/line#rakeback</code> — line in 1000s and rakeback in %, both optional (e.g. <code>gustavo/10#30</code> or <code>gustavo#30</code>).
      </p>
      
      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="gustavo/10#30&#10;carlos&#10;conrado/4.5&#10;alberto#25"
        className="nickname-textarea"
        rows={6}
      />

      {nicknames.length > 0 && (
        <div className="nickname-summary">
          <p className="summary-text">
            <strong>{nicknames.length}</strong> active player(s)
            {' '}({nicknames.filter(n => n.line !== undefined).length} with line,
            {' '}{nicknames.filter(n => n.rakeback !== undefined).length} with rakeback)
          </p>
        </div>
      )}
    </div>
  );
};

export default NicknameInput;
