import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SlackChannel, SlackChannelWeek } from './types';
import type { Extraction } from '../fathom/extract-types';

const DATA_ROOT = path.join(process.cwd(), 'data', 'slack');
const CHANNELS_DIR = path.join(DATA_ROOT, 'channels');
const EXTRACTIONS_DIR = path.join(DATA_ROOT, 'extractions');
const UNMATCHED_DIR = path.join(CHANNELS_DIR, '_unmatched');
const STATE_FILE = path.join(DATA_ROOT, 'state.json');

export interface StoredChannelWeek {
  channelWeek: SlackChannelWeek;
  flattened: string; // LLM-ready chronological dump
  fetchedAt: string;
}

export interface SlackSyncState {
  lastPollByChannel: Record<string, string>; // channelId → ISO timestamp
}

// Slack synthetic recordingId: sha256(channelId + weekStart) → first 8 hex → int32.
// Keeps the UI's numeric-recordingId contract intact. Collisions across
// Fathom/Gmail/Slack are astronomically improbable for our data scale.
export function syntheticRecordingId(channelId: string, weekStart: string): number {
  const hash = crypto.createHash('sha256').update(`${channelId}|${weekStart}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16);
}

// Disk key for a channel-week: "{channelId}-{weekStart}.json"
export function channelWeekKey(channelId: string, weekStart: string): string {
  return `${channelId}-${weekStart}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveChannelWeek(stored: StoredChannelWeek): Promise<void> {
  await ensureDir(CHANNELS_DIR);
  const key = channelWeekKey(stored.channelWeek.channel.id, stored.channelWeek.weekStart);
  await fs.writeFile(path.join(CHANNELS_DIR, `${key}.json`), JSON.stringify(stored, null, 2));
}

export async function saveUnmatchedChannel(channel: SlackChannel): Promise<void> {
  await ensureDir(UNMATCHED_DIR);
  await fs.writeFile(
    path.join(UNMATCHED_DIR, `${channel.id}.json`),
    JSON.stringify(channel, null, 2)
  );
}

export async function saveExtraction(
  channelId: string,
  weekStart: string,
  extraction: Extraction
): Promise<void> {
  await ensureDir(EXTRACTIONS_DIR);
  const key = channelWeekKey(channelId, weekStart);
  await fs.writeFile(
    path.join(EXTRACTIONS_DIR, `${key}.json`),
    JSON.stringify(extraction, null, 2)
  );
}

export async function hasExtraction(channelId: string, weekStart: string): Promise<boolean> {
  const key = channelWeekKey(channelId, weekStart);
  try {
    await fs.access(path.join(EXTRACTIONS_DIR, `${key}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function loadState(): Promise<SlackSyncState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as SlackSyncState;
  } catch {
    return { lastPollByChannel: {} };
  }
}

export async function saveState(state: SlackSyncState): Promise<void> {
  await ensureDir(DATA_ROOT);
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}
