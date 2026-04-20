import { WebClient } from '@slack/web-api';
import type { SlackChannel, SlackMessage, SlackUser } from './types';

const SEARCHTIDES_DOMAIN = 'searchtides.com';

let cachedClient: WebClient | null = null;
function client(): WebClient {
  if (cachedClient) return cachedClient;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set — check .env.local');
  cachedClient = new WebClient(token);
  return cachedClient;
}

// Simple in-process cache for user lookups — same users appear across many
// messages and channels; avoid hammering the API.
const userCache = new Map<string, SlackUser>();

export async function getUser(userId: string): Promise<SlackUser> {
  const hit = userCache.get(userId);
  if (hit) return hit;
  try {
    const res = await client().users.info({ user: userId });
    const u = res.user ?? {};
    const email = u.profile?.email?.toLowerCase() ?? null;
    const parsed: SlackUser = {
      id: userId,
      name: u.profile?.display_name || u.real_name || u.name || userId,
      email,
      isBot: Boolean(u.is_bot),
      isSearchtides: Boolean(email && email.endsWith('@' + SEARCHTIDES_DOMAIN)),
    };
    userCache.set(userId, parsed);
    return parsed;
  } catch {
    const fallback: SlackUser = {
      id: userId,
      name: userId,
      email: null,
      isBot: false,
      isSearchtides: false,
    };
    userCache.set(userId, fallback);
    return fallback;
  }
}

export async function listChannels(): Promise<SlackChannel[]> {
  // Bot sees public channels it's invited to + private channels + mpims.
  // `conversations.list` with types filter covers all three.
  const out: SlackChannel[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages++ < 20) {
    const res = await client().conversations.list({
      types: 'public_channel,private_channel,mpim',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const c of res.channels ?? []) {
      if (!c.id || !c.name) continue;
      if (!c.is_member) continue; // bot has to be in the channel
      const members = await fetchMembers(c.id);
      const memberEmails: string[] = [];
      for (const mid of members) {
        const u = await getUser(mid);
        if (u.email && !u.isBot) memberEmails.push(u.email);
      }
      out.push({
        id: c.id,
        name: c.name,
        isPrivate: Boolean(c.is_private),
        isMpim: Boolean(c.is_mpim),
        memberIds: members,
        memberEmails,
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

async function fetchMembers(channelId: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages++ < 20) {
    const res = await client().conversations.members({
      channel: channelId,
      limit: 200,
      cursor,
    });
    out.push(...(res.members ?? []));
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

// Fetch channel history plus thread replies in a single call sequence.
// `oldestTs` is a Slack-format ts (seconds since epoch, with decimals).
export async function fetchMessages(
  channelId: string,
  oldestTs: string
): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages++ < 50) {
    const res = await client().conversations.history({
      channel: channelId,
      oldest: oldestTs,
      limit: 200,
      cursor,
    });
    for (const m of res.messages ?? []) {
      const normalized = await normalizeMessage(m, channelId);
      if (normalized) out.push(normalized);
      // Fetch threaded replies when present.
      if (m.thread_ts && m.thread_ts === m.ts && (m.reply_count ?? 0) > 0) {
        const replies = await fetchThreadReplies(channelId, m.thread_ts);
        out.push(...replies);
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

async function fetchThreadReplies(
  channelId: string,
  threadTs: string
): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages++ < 10) {
    const res = await client().conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
      cursor,
    });
    for (const m of res.messages ?? []) {
      // Skip the parent — already included from history.
      if (m.ts === threadTs) continue;
      const normalized = await normalizeMessage(m, channelId);
      if (normalized) out.push(normalized);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

async function normalizeMessage(
  m: Record<string, unknown> | { ts?: string; subtype?: string; user?: string; bot_id?: string; text?: string; thread_ts?: string },
  _channelId: string
): Promise<SlackMessage | null> {
  const msg = m as Record<string, unknown>;
  const ts = String(msg.ts ?? '');
  if (!ts) return null;
  const subtype = (msg.subtype as string | undefined) ?? null;
  const userId = String(msg.user ?? msg.bot_id ?? 'unknown');
  const user = await getUser(userId);
  const text = String(msg.text ?? '');
  const threadTs = (msg.thread_ts as string | undefined) ?? null;
  const secs = Number(ts.split('.')[0]);
  return {
    ts,
    userId,
    userName: user.name,
    userEmail: user.email,
    text,
    threadTs,
    subtype,
    date: new Date(secs * 1000).toISOString(),
  };
}
