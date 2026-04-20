// Normalized Slack shapes. The @slack/web-api client returns loose dynamic
// payloads; we flatten to these interfaces once at fetch time.

export interface SlackUser {
  id: string;
  name: string; // display name (or real name fallback)
  email: string | null; // null for bots or when users:read.email is missing
  isBot: boolean;
  isSearchtides: boolean; // true if email ends with @searchtides.com
}

export interface SlackMessage {
  ts: string; // slack timestamp "1713580000.000100" — primary key within channel
  userId: string;
  userName: string; // resolved display name (or "bot" for bot messages)
  userEmail: string | null;
  text: string;
  threadTs: string | null; // parent ts if this is a reply, else null
  subtype: string | null; // "bot_message" | "channel_join" | etc.; null = regular
  date: string; // ISO — derived from ts
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMpim: boolean; // multi-party DM
  memberIds: string[];
  memberEmails: string[]; // lowercased, only resolved (humans with email)
}

export interface SlackChannelWeek {
  channel: SlackChannel;
  weekStart: string; // ISO (Monday)
  messages: SlackMessage[]; // chronological
  participantIds: string[]; // unique across the week
  participantEmails: string[]; // lowercased, dedup'd
}
