import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { google, gmail_v1 } from 'googleapis';
import type { GmailMessage, GmailThread } from './types';

export function hasServiceAccountAuth(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH);
}

type ServiceAccountKey = { client_email: string; private_key: string };
let cachedKey: ServiceAccountKey | null = null;
function loadServiceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set');
  const raw = readFileSync(keyPath, 'utf-8');
  const parsed = JSON.parse(raw) as ServiceAccountKey;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`Service-account key at ${keyPath} is missing client_email or private_key`);
  }
  cachedKey = parsed;
  return parsed;
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local'
    );
  }
  if (!refreshToken) {
    throw new Error(
      'Missing GOOGLE_OAUTH_REFRESH_TOKEN — run `npm run gmail:auth` to mint one'
    );
  }
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}

function getServiceAccountAuth(subject: string) {
  const key = loadServiceAccountKey();
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject, // the @searchtides.com mailbox this token reads
  });
}

// If `mailbox` is supplied AND a service-account key is configured, use
// domain-wide-delegation auth scoped to that mailbox. Otherwise fall back
// to the single-user OAuth flow (mailbox arg ignored — we read whatever
// mailbox authorized the refresh token).
function gmailClient(mailbox?: string): gmail_v1.Gmail {
  if (mailbox && hasServiceAccountAuth()) {
    return google.gmail({ version: 'v1', auth: getServiceAccountAuth(mailbox) });
  }
  return google.gmail({ version: 'v1', auth: getOAuth2Client() });
}

export async function* listThreadIds(
  query: string,
  mailbox?: string
): AsyncGenerator<string[]> {
  // Gmail's `threads.list` returns thread summaries (id + historyId).
  // We yield IDs per page so the caller can fetch full payloads on demand.
  const gmail = gmailClient(mailbox);
  let pageToken: string | undefined;
  let pages = 0;
  while (pages++ < 50) {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });
    const ids = (res.data.threads ?? []).map(t => t.id!).filter(Boolean);
    if (ids.length) yield ids;
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
}

export async function fetchThread(threadId: string, mailbox?: string): Promise<GmailThread> {
  const gmail = gmailClient(mailbox);
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  const raw = res.data;
  const messages = (raw.messages ?? []).map(parseMessage).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const earliest = messages[0];
  const latest = messages[messages.length - 1];
  const participants = Array.from(
    new Set(
      messages.flatMap(m =>
        [m.from, ...m.to, ...m.cc].map(a => a.toLowerCase()).filter(Boolean)
      )
    )
  );
  const rootMessageId = earliest?.rfc822MessageId ?? threadId;
  const dedupKey = crypto.createHash('sha256').update(rootMessageId).digest('hex');
  return {
    threadId,
    dedupKey,
    subject: earliest?.subject ?? '(no subject)',
    messages,
    participants,
    earliestDate: earliest?.date ?? '',
    latestDate: latest?.date ?? '',
  };
}

function parseMessage(m: gmail_v1.Schema$Message): GmailMessage {
  const headers: Record<string, string> = {};
  for (const h of m.payload?.headers ?? []) {
    if (h.name && h.value) headers[h.name.toLowerCase()] = h.value;
  }
  const dateHeader = headers['date'];
  // Gmail also provides internalDate as ms epoch — more reliable than the
  // Date header (which can be malformed in some messages).
  const internalDateMs = m.internalDate ? Number(m.internalDate) : NaN;
  const iso = Number.isFinite(internalDateMs)
    ? new Date(internalDateMs).toISOString()
    : dateHeader
      ? new Date(dateHeader).toISOString()
      : new Date(0).toISOString();
  return {
    id: m.id!,
    rfc822MessageId: headers['message-id'] ?? m.id ?? '',
    threadId: m.threadId ?? '',
    date: iso,
    from: extractAddr(headers['from']),
    to: splitAddrs(headers['to']),
    cc: splitAddrs(headers['cc']),
    subject: headers['subject'] ?? '',
    bodyPlain: extractBody(m.payload),
    headers,
  };
}

function extractAddr(raw: string | undefined): string {
  if (!raw) return '';
  // "Drew <drew@foo.com>" → "drew@foo.com"; "drew@foo.com" → same.
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

function splitAddrs(raw: string | undefined): string[] {
  if (!raw) return [];
  // Comma-separated; respect quoted display names.
  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return parts.map(extractAddr).filter(Boolean);
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  // Depth-first: prefer the first text/plain part; fall back to HTML stripped.
  const plain = findPart(payload, 'text/plain');
  if (plain?.body?.data) return decodeB64Url(plain.body.data);
  const html = findPart(payload, 'text/html');
  if (html?.body?.data) return stripHtml(decodeB64Url(html.body.data));
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  return '';
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mime: string
): gmail_v1.Schema$MessagePart | undefined {
  if (part.mimeType === mime) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return undefined;
}

function decodeB64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
