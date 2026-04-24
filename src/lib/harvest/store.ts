import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { HarvestSnapshot } from './types';

const SNAPSHOTS_DIR = path.join(process.cwd(), 'data', 'harvest', 'snapshots');

function fileFor(clientId: string, weekStart: string): string {
  return path.join(SNAPSHOTS_DIR, `${clientId}-${weekStart}.json`);
}

export async function saveSnapshot(snap: HarvestSnapshot): Promise<void> {
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  await fs.writeFile(fileFor(snap.clientId, snap.weekStart), JSON.stringify(snap, null, 2));
}

export async function listSnapshotsForClient(clientId: string): Promise<HarvestSnapshot[]> {
  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    const out: HarvestSnapshot[] = [];
    for (const f of files) {
      if (!f.startsWith(`${clientId}-`) || !f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(SNAPSHOTS_DIR, f), 'utf-8');
      out.push(JSON.parse(raw) as HarvestSnapshot);
    }
    return out.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  } catch {
    return [];
  }
}

export async function listAllSnapshots(): Promise<HarvestSnapshot[]> {
  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    const out: HarvestSnapshot[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(SNAPSHOTS_DIR, f), 'utf-8');
      out.push(JSON.parse(raw) as HarvestSnapshot);
    }
    return out;
  } catch {
    return [];
  }
}
