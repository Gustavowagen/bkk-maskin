/**
 * Fetch the ClubGG export (a zip with the context file) straight from Gmail.
 * The user signs in with Google Identity Services in the browser and grants read-only Gmail access;
 * the OAuth client id is configured in the VITE_GOOGLE_CLIENT_ID environment variable.
 */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const CLUBGG_SENDER = 'support@clubgg.com';
// Only mails sent within this window count
const MAX_MAIL_AGE_MS = 24 * 60 * 60 * 1000;

export interface ZipAttachment {
  filename: string;
  attachmentId: string;
}

export interface ClubGGMail {
  id: string;
  subject: string;
  sentAt: Date;
  attachments: ZipAttachment[];
  // Links in the mail body that look like a zip download, used when the zip is not attached
  downloadLinks: string[];
}

// Minimal types for the parts of Google Identity Services and the Gmail API that are used
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type: string; message?: string }) => void;
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      callback: (response: TokenResponse) => void;
      error_callback?: (error: { type: string; message?: string }) => void;
    }) => TokenClient;
  };
}

interface MessagePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: MessagePart[];
}

interface GmailMessage {
  id: string;
  internalDate: string;
  payload: MessagePart;
}

let gisPromise: Promise<GoogleAccounts> | null = null;
let tokenClient: TokenClient | null = null;
let accessToken: { value: string; expiresAt: number } | null = null;

export const isGmailConfigured = (): boolean => Boolean(GOOGLE_CLIENT_ID);

const loadGoogleIdentity = (): Promise<GoogleAccounts> => {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        const accounts = (window as unknown as { google?: { accounts?: GoogleAccounts } }).google?.accounts;
        if (accounts) resolve(accounts);
        else reject(new Error('Google sign-in did not load.'));
      };
      script.onerror = () => {
        gisPromise = null;
        reject(new Error('Could not load Google sign-in (check your connection or browser extensions blocking accounts.google.com).'));
      };
      document.head.appendChild(script);
    });
  }
  return gisPromise;
};

// Loading the script ahead of the click keeps the sign-in popup from being blocked
export const preloadGmail = (): void => {
  if (GOOGLE_CLIENT_ID) loadGoogleIdentity().catch(() => {});
};

/**
 * Get an access token, asking the user to sign in / grant access when there is no valid one.
 * Tokens live about an hour and are only kept in memory.
 */
const getAccessToken = async (): Promise<string> => {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not set, so Gmail could not be reached.');
  }
  // Refresh a minute early so a token never expires halfway through the downloads
  if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) return accessToken.value;

  const accounts = await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const onResponse = (response: TokenResponse) => {
      if (response.error || !response.access_token) {
        reject(new Error(response.error_description || response.error || 'Google sign-in failed.'));
        return;
      }
      accessToken = { value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
      resolve(response.access_token);
    };
    const onError = (error: { type: string; message?: string }) => {
      reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was closed.' : error.message || 'Google sign-in failed.'));
    };
    if (!tokenClient) {
      tokenClient = accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GMAIL_SCOPE, callback: onResponse, error_callback: onError });
    } else {
      tokenClient.callback = onResponse;
      tokenClient.error_callback = onError;
    }
    // After the first consent Google skips the consent screen
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : undefined });
  });
};

const gmailGet = async <T>(path: string): Promise<T> => {
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach Gmail (check your connection).');
  }
  if (response.status === 401) {
    // Revoked or expired token: sign in again next time
    accessToken = null;
    throw new Error('Gmail access expired. Click the button again to sign in.');
  }
  if (!response.ok) {
    throw new Error(`Gmail request failed (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
};

const decodeBase64Url = (data: string) => {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const flattenParts = (part: MessagePart): MessagePart[] => [part, ...(part.parts ?? []).flatMap(flattenParts)];

const header = (message: GmailMessage, name: string): string =>
  message.payload.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

// "ClubGG <support@clubgg.com>" → "support@clubgg.com"
const senderAddress = (from: string): string => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();

const isZipPart = (part: MessagePart): boolean =>
  Boolean(part.body?.attachmentId) &&
  (/\.zip$/i.test(part.filename ?? '') || /zip/i.test(part.mimeType ?? ''));

const findDownloadLinks = (parts: MessagePart[]): string[] => {
  const links = new Set<string>();
  parts
    .filter(part => (part.mimeType === 'text/html' || part.mimeType === 'text/plain') && part.body?.data)
    .forEach(part => {
      const text = new TextDecoder().decode(decodeBase64Url(part.body!.data!));
      for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        const url = match[0].replace(/&amp;/g, '&');
        if (/\.zip(\?|$)|download/i.test(url)) links.add(url);
      }
    });
  return [...links];
};

/**
 * Mails from ClubGG sent within the past 24 hours, newest first
 */
export const findClubGGMails = async (): Promise<ClubGGMail[]> => {
  // Gmail's "newer_than" is in whole days, so search a bit wider and check the exact time below
  const query = encodeURIComponent(`from:${CLUBGG_SENDER} newer_than:2d`);
  const list = await gmailGet<{ messages?: { id: string }[] }>(`/messages?q=${query}&maxResults=20`);
  const messages = await Promise.all(
    (list.messages ?? []).map(({ id }) => gmailGet<GmailMessage>(`/messages/${id}?format=full`))
  );

  const cutoff = Date.now() - MAX_MAIL_AGE_MS;
  return messages
    // The search also matches the name in the From field, so check the actual address
    .filter(message => senderAddress(header(message, 'From')) === CLUBGG_SENDER)
    .filter(message => Number(message.internalDate) >= cutoff)
    .map((message): ClubGGMail => {
      const parts = flattenParts(message.payload);
      return {
        id: message.id,
        subject: header(message, 'Subject') || '(no subject)',
        sentAt: new Date(Number(message.internalDate)),
        attachments: parts.filter(isZipPart).map(part => ({ filename: part.filename || 'clubgg.zip', attachmentId: part.body!.attachmentId! })),
        downloadLinks: findDownloadLinks(parts),
      };
    })
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
};

/**
 * Download the zip from a mail: the attachment if there is one, otherwise the first download link in the body
 */
export const downloadClubGGZip = async (mail: ClubGGMail): Promise<File> => {
  const attachment = mail.attachments[0];
  if (attachment) {
    const data = await gmailGet<{ data: string }>(`/messages/${mail.id}/attachments/${attachment.attachmentId}`);
    return new File([decodeBase64Url(data.data)], attachment.filename, { type: 'application/zip' });
  }

  const link = mail.downloadLinks[0];
  if (!link) {
    throw new Error('The mail has no zip file attached and no download link.');
  }
  let response: Response;
  try {
    response = await fetch(link);
  } catch {
    // Usually the download server does not allow requests from other websites (CORS)
    throw new Error(`The zip could not be downloaded automatically. Open the link in the mail, then upload the file manually: ${link}`);
  }
  if (!response.ok) {
    throw new Error(`The download link in the mail failed (HTTP ${response.status}). It may have expired: ${link}`);
  }
  const name = decodeURIComponent(new URL(link).pathname.split('/').pop() || '');
  return new File([await response.blob()], /\.zip$/i.test(name) ? name : 'clubgg.zip', { type: 'application/zip' });
};
