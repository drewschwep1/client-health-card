import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GmailThread } from './types';
import type { Extraction } from '../fathom/extract-types';

const DATA_ROOT = path.join(process.cwd(), 'data', 'gmail');
const THREADS_DIR = path.join(DATA_ROOT, 'threads');
const EXTRACTIONS_DIR = path.join(DATA_ROOT, 'extractions');
const UNMATCHED_DIR = path.join(THREADS_DIR, '_unmatched');
const STATE_FILE = path.join(DATA_ROOT, 'state.json');

export interface StoredThread {
  thread: GmailThread;
  flattened: string; // LLM-ready plain-text dump
  fetchedAt: string;
}

export interface GmailSyncState {
  lastPollByClient: Record<string, string>; // clientId → ISO timestamp
  seenDedupKeys: string[];
}

// Gmail thread dedup keys are 64-char hex (sha256). We truncate to 8 hex
// (32 bits) for the synthetic Extraction.recordingId. Collisions between
// Fathom's ~8-digit decimal IDs and Gmail's 8-hex IDs are astronomically
// rare; we accept the risk for v1.
export function syntheticRecordingId(dedupKey: string): number {
  return parseInt(dedupKey.slice(0, 8), 16);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveThread(stored: StoredThread): Promise<void> {
  await ensureDir(THREADS_DIR);
  const file = path.join(THREADS_DIR, `${stored.thread.dedupKey}.json`);
  await fs.writeFile(file, JSON.stringify(stored, null, 2));
}

export async function saveUnmatchedThread(stored: StoredThread): Promise<void> {
  await ensureDir(UNMATCHED_DIR);
  const file = path.join(UNMATCHED_DIR, `${stored.thread.dedupKey}.json`);
  await fs.writeFile(file, JSON.stringify(stored, null, 2));
}

export async function hasThread(dedupKey: string): Promise<boolean> {
  try {
    await fs.access(path.join(THREADS_DIR, `${dedupKey}.json`));
    return true;
  } catch {
    try {
      await fs.access(path.join(UNMATCHED_DIR, `${dedupKey}.json`));
      return true;
    } catch {
      return false;
    }
  }
}

export async function loadThread(dedupKey: string): Promise<StoredThread | null> {
  try {
    const raw = await fs.readFile(path.join(THREADS_DIR, `${dedupKey}.json`), 'utf-8');
    return JSON.parse(raw) as StoredThread;
  } catch {
    return null;
  }
}

export async function saveExtraction(
  dedupKey: string,
  extraction: Extraction
): Promise<void> {
  await ensureDir(EXTRACTIONS_DIR);
  await fs.writeFile(
    path.join(EXTRACTIONS_DIR, `${dedupKey}.json`),
    JSON.stringify(extraction, null, 2)
  );
}

export async function loadState(): Promise<GmailSyncState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as GmailSyncState;
  } catch {
    return { lastPollByClient: {}, seenDedupKeys: [] };
  }
}

export async function saveState(state: GmailSyncState): Promise<void> {
  await ensureDir(DATA_ROOT);
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}
