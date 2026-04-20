import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FathomMeeting } from './types';
import type { Extraction } from './extract-types';

// All Fathom-derived data lives under this directory (gitignored).
const DATA_ROOT = path.join(process.cwd(), 'data', 'fathom');
const MEETINGS_DIR = path.join(DATA_ROOT, 'meetings');
const EXTRACTIONS_DIR = path.join(DATA_ROOT, 'extractions');
const STATE_FILE = path.join(DATA_ROOT, 'state.json');

export interface StoredMeeting {
  meeting: FathomMeeting;
  transcript: string; // flattened plain-text for LLM input
  summaryMarkdown: string;
  fetchedAt: string;
}

export interface SyncState {
  lastPollByTeam: Record<string, string>; // team name → ISO timestamp
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveMeeting(stored: StoredMeeting): Promise<void> {
  await ensureDir(MEETINGS_DIR);
  const file = path.join(MEETINGS_DIR, `${stored.meeting.recording_id}.json`);
  await fs.writeFile(file, JSON.stringify(stored, null, 2));
}

export async function hasMeeting(recordingId: number): Promise<boolean> {
  try {
    await fs.access(path.join(MEETINGS_DIR, `${recordingId}.json`));
    return true;
  } catch {
    return false;
  }
}

export async function loadMeeting(recordingId: number): Promise<StoredMeeting | null> {
  try {
    const raw = await fs.readFile(path.join(MEETINGS_DIR, `${recordingId}.json`), 'utf-8');
    return JSON.parse(raw) as StoredMeeting;
  } catch {
    return null;
  }
}

export async function saveExtraction(recordingId: number, extraction: Extraction): Promise<void> {
  await ensureDir(EXTRACTIONS_DIR);
  await fs.writeFile(
    path.join(EXTRACTIONS_DIR, `${recordingId}.json`),
    JSON.stringify(extraction, null, 2)
  );
}

export async function loadExtraction(recordingId: number): Promise<Extraction | null> {
  try {
    const raw = await fs.readFile(
      path.join(EXTRACTIONS_DIR, `${recordingId}.json`),
      'utf-8'
    );
    return JSON.parse(raw) as Extraction;
  } catch {
    return null;
  }
}

export async function listStoredMeetingKeys(): Promise<Set<string>> {
  // Used to dedupe across runs: same meeting appears once per attendee, each
  // with its own recording_id. Key on (title, scheduled_start_time).
  try {
    const files = await fs.readdir(MEETINGS_DIR);
    const keys = new Set<string>();
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(MEETINGS_DIR, f), 'utf-8');
      const stored = JSON.parse(raw) as StoredMeeting;
      keys.add(`${stored.meeting.title}|${stored.meeting.scheduled_start_time}`);
    }
    return keys;
  } catch {
    return new Set();
  }
}

export async function listAllExtractions(): Promise<Extraction[]> {
  try {
    const files = await fs.readdir(EXTRACTIONS_DIR);
    const out: Extraction[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(EXTRACTIONS_DIR, f), 'utf-8');
      out.push(JSON.parse(raw) as Extraction);
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadState(): Promise<SyncState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as SyncState;
  } catch {
    return { lastPollByTeam: {} };
  }
}

export async function saveState(state: SyncState): Promise<void> {
  await ensureDir(DATA_ROOT);
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}
