import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProfoundSnapshot } from './types';

const SNAPSHOTS_DIR = path.join(process.cwd(), 'data', 'profound', 'snapshots');

function fileFor(clientId: string, weekStart: string): string {
  return path.join(SNAPSHOTS_DIR, `${clientId}-${weekStart}.json`);
}

export async function saveSnapshot(snap: ProfoundSnapshot): Promise<void> {
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  await fs.writeFile(fileFor(snap.clientId, snap.weekStart), JSON.stringify(snap, null, 2));
}

export async function listSnapshotsForClient(clientId: string): Promise<ProfoundSnapshot[]> {
  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    const out: ProfoundSnapshot[] = [];
    for (const f of files) {
      if (!f.startsWith(`${clientId}-`) || !f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(SNAPSHOTS_DIR, f), 'utf-8');
      out.push(JSON.parse(raw) as ProfoundSnapshot);
    }
    return out.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  } catch {
    return [];
  }
}

export async function listAllSnapshots(): Promise<ProfoundSnapshot[]> {
  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    const out: ProfoundSnapshot[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(SNAPSHOTS_DIR, f), 'utf-8');
      out.push(JSON.parse(raw) as ProfoundSnapshot);
    }
    return out;
  } catch {
    return [];
  }
}
