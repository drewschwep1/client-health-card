#!/usr/bin/env tsx
// Pulls per-client Harvest hours. Default: last 8 complete weeks. Pass
// --from YYYY-MM-DD --to YYYY-MM-DD to backfill an arbitrary window —
// any Monday-start week that overlaps [from, to] is pulled. Each
// SearchTides client is its own Harvest project under the "SearchTides
// Clients" Harvest Client. One snapshot per (client, week) written to
// data/harvest/snapshots/. Idempotent — rerunning a week overwrites the
// prior snapshot.

import { format, startOfWeek, addDays, subWeeks, isBefore, isEqual } from 'date-fns';

import {
  CLIENTS,
  CLIENT_HARVEST_PROJECT,
  type ClientId,
} from '../src/lib/constants';
import { listTimeEntries } from '../src/lib/harvest/client';
import { saveSnapshot } from '../src/lib/harvest/store';
import type { HarvestSnapshot, HarvestTimeEntry } from '../src/lib/harvest/types';

function weekStartIso(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

// Parse --from/--to from argv. Returns null if neither flag was given.
function parseDateRangeArgs(): { from: string; to: string } | null {
  const args = process.argv.slice(2);
  let from: string | null = null;
  let to: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) from = args[i + 1];
    if (args[i] === '--to' && args[i + 1]) to = args[i + 1];
  }
  if (from === null && to === null) return null;
  if (from === null || to === null) {
    console.error('Harvest sync: --from and --to must both be provided, or neither.');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error('Harvest sync: --from/--to must be YYYY-MM-DD.');
    process.exit(1);
  }
  return { from, to };
}

// Monday-starting week starts that overlap [from, to], inclusive.
function weeksInRange(from: string, to: string): string[] {
  const start = startOfWeek(new Date(`${from}T00:00:00`), { weekStartsOn: 1 });
  const end = new Date(`${to}T00:00:00`);
  const out: string[] = [];
  let cursor = start;
  while (isBefore(cursor, end) || isEqual(cursor, end)) {
    out.push(format(cursor, 'yyyy-MM-dd'));
    cursor = addDays(cursor, 7);
  }
  return out;
}

function buildSnapshot(
  clientId: ClientId,
  projectId: number,
  projectName: string,
  weekStart: string,
  weekEnd: string,
  entries: HarvestTimeEntry[]
): HarvestSnapshot {
  const byUser: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  let totalHours = 0;
  for (const e of entries) {
    totalHours += e.hours;
    byUser[e.user.name] = (byUser[e.user.name] ?? 0) + e.hours;
    byTask[e.task.name] = (byTask[e.task.name] ?? 0) + e.hours;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    clientId,
    projectId,
    projectName,
    weekStart,
    weekEnd,
    fetchedAt: new Date().toISOString(),
    totalHours: round2(totalHours),
    entryCount: entries.length,
    byUser: Object.fromEntries(Object.entries(byUser).map(([k, v]) => [k, round2(v)])),
    byTask: Object.fromEntries(Object.entries(byTask).map(([k, v]) => [k, round2(v)])),
  };
}

async function main(): Promise<void> {
  const missing: string[] = [];
  if (!process.env.HARVEST_ACCESS_TOKEN) missing.push('HARVEST_ACCESS_TOKEN');
  if (!process.env.HARVEST_ACCOUNT_ID) missing.push('HARVEST_ACCOUNT_ID');
  if (missing.length) {
    console.error(`Harvest sync: missing env ${missing.join(', ')} — check .env.local`);
    process.exit(1);
  }

  const range = parseDateRangeArgs();
  const weeks: string[] = range
    ? weeksInRange(range.from, range.to)
    : (() => {
        const w: string[] = [];
        for (let i = 1; i <= 8; i++) {
          w.push(weekStartIso(subWeeks(new Date(), i)));
        }
        return w.reverse();
      })();

  const mapped = CLIENTS.filter(c => CLIENT_HARVEST_PROJECT[c.id as ClientId]);
  if (mapped.length === 0) {
    console.error(
      'Harvest sync: CLIENT_HARVEST_PROJECT is empty — populate at least one ' +
        'client in src/lib/constants.ts before running.'
    );
    process.exit(1);
  }

  console.log(
    `== Harvest sync: ${mapped.length} mapped clients × ${weeks.length} weeks ==\n`
  );

  const start = Date.now();
  let snapshotCount = 0;
  const errors: string[] = [];

  for (const c of mapped) {
    const mapping = CLIENT_HARVEST_PROJECT[c.id as ClientId]!;
    console.log(`# ${c.name} (project=${mapping.projectId} "${mapping.projectName}")`);
    for (const week of weeks) {
      // Parse as local midnight (T00:00:00). new Date('YYYY-MM-DD') alone
      // parses as UTC midnight, and addDays+format in a non-UTC tz then
      // drops a day — silently losing every Sunday's entries.
      const weekEnd = format(addDays(new Date(`${week}T00:00:00`), 6), 'yyyy-MM-dd');
      try {
        const entries = await listTimeEntries({
          projectId: String(mapping.projectId),
          from: week,
          to: weekEnd,
        });
        const snap = buildSnapshot(
          c.id as ClientId,
          mapping.projectId,
          mapping.projectName,
          week,
          weekEnd,
          entries
        );
        await saveSnapshot(snap);
        snapshotCount++;
        const users = Object.keys(snap.byUser).length;
        console.log(
          `  ${week}  ${snap.totalHours.toFixed(1).padStart(6)}h  ` +
            `(${snap.entryCount} entries, ${users} user${users === 1 ? '' : 's'})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.id} ${week}: ${msg}`);
        console.error(`  ${week}  ERROR: ${msg}`);
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\n== done: ${snapshotCount} snapshots in ${elapsed}s, ${errors.length} errors ==`
  );
  if (errors.length) errors.forEach(e => console.log('  -', e));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
