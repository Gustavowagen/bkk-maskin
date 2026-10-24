import React, { useEffect, useState } from 'react';
import './GmailImport.css';
import { CLUBGG_SENDER, downloadClubGGZip, findClubGGMails, isGmailConfigured, preloadGmail } from '../utils/gmailApi';
import type { ClubGGMail } from '../utils/gmailApi';

interface GmailImportProps {
  onFileUpload: (file: File) => void;
}

const formatSentAt = (date: Date): string =>
  date.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

/**
 * "Fetch from Gmail" button: finds the ClubGG mails from the past 24 hours and loads the zip from the chosen one
 * as if it had been uploaded. With several mails the user picks one.
 */
const GmailImport: React.FC<GmailImportProps> = ({ onFileUpload }) => {
  const [status, setStatus] = useState<'idle' | 'searching' | 'downloading'>('idle');
  const [mails, setMails] = useState<ClubGGMail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<ClubGGMail | null>(null);

  useEffect(preloadGmail, []);

  const loadMail = async (mail: ClubGGMail) => {
    setStatus('downloading');
    setError(null);
    try {
      const file = await downloadClubGGZip(mail);
      setMails(null);
      setLoadedFrom(mail);
      onFileUpload(file);
    } catch (err) {
      console.error('Error downloading from Gmail:', err);
      setError(err instanceof Error ? err.message : 'Could not download the zip from Gmail.');
    }
    setStatus('idle');
  };

  const handleFetch = async () => {
    setStatus('searching');
    setError(null);
    setMails(null);
    setLoadedFrom(null);
    let found: ClubGGMail[];
    try {
      found = await findClubGGMails();
    } catch (err) {
      console.error('Error searching Gmail:', err);
      setError(err instanceof Error ? err.message : 'Could not search Gmail.');
      setStatus('idle');
      return;
    }
    if (found.length === 0) {
      setError(`No mail from ${CLUBGG_SENDER} in the past 24 hours.`);
      setStatus('idle');
      return;
    }
    if (found.length === 1) {
      await loadMail(found[0]);
      return;
    }
    setMails(found);
    setStatus('idle');
  };

  if (!isGmailConfigured()) return null;

  return (
    <div className="gmail-import">
      <button className="gmail-button" onClick={handleFetch} disabled={status !== 'idle'}>
        {status === 'searching' ? 'Searching Gmail...' : status === 'downloading' ? 'Downloading...' : '✉ Fetch from Gmail'}
      </button>

      {mails && (
        <div className="gmail-mail-list">
          <p className="info-message">{mails.length} mails from {CLUBGG_SENDER} in the past 24 hours. Choose one:</p>
          {mails.map(mail => (
            <button key={mail.id} className="gmail-mail" onClick={() => loadMail(mail)} disabled={status !== 'idle'}>
              <span className="gmail-mail-time">{formatSentAt(mail.sentAt)}</span>
              <span className="gmail-mail-subject">{mail.subject}</span>
              <span className="gmail-mail-file">
                {mail.attachments[0]?.filename ?? (mail.downloadLinks.length > 0 ? 'Download link' : 'No zip found')}
              </span>
            </button>
          ))}
        </div>
      )}

      {loadedFrom && !error && (
        <p className="info-message">✓ Loaded from the mail sent {formatSentAt(loadedFrom.sentAt)} (Oslo time)</p>
      )}
      {error && <p className="warning-message">⚠️ {error}</p>}
    </div>
  );
};

export default GmailImport;
