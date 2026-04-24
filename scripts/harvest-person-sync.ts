#!/usr/bin/env tsx
// Per-person, per-week hour totals across ALL Harvest projects (not
// just SearchTides-tracked clients). Needed because the salaried cost
// model caps a person at 40h/week and allocates that cost across
// clients by share — if a salaried person also logs time to internal
// or non-tracked projects, those hours belong in the denominator.
//
// Usage:
//   npm run harvest:person-sync -- --from 2025-09-01 --to 2026-04-20
//   (if --from/--to omitted, defaults to last 8 complete weeks)
//
// Output: data/harvest/person-weeks/{userId}-{weekStart}.json
// Idempotent — rerunning a (user, week) overwrites.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { format, startOfWeek, addDays, subWeeks, isBefore, isEqual } from 'date-fns';

import { listUsers, listTimeEntriesByUser } from '../src/lib/harvest/client';
import type { HarvestPersonWeek, HarvestTimeEntry } from '../src/lib/harvest/types';

// Names must match Harvest's `first_name + ' ' + last_name`. These are
// the salaried people whose hours need share-based allocation. Hourly
// folks don't need person-week denominators (cost = hours × rate
// directly), so we skip them.
const SALARIED_USER_NAMES: readonly string[] = [
  'Casey O’Connor', // curly apostrophe — matches Harvest full_name
  'Sofia Volynets',
  'Baldwin Diep',
  'Nicholas Bradman',
  'Ricardo Bravo',
];

const OUT_DIR = path.join(process.cwd(), 'data', 'harvest', 'person-weeks');

function weekStartIso(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

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
    console.error('person-sync: --from and --to must both be provided, or neither.');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error('person-sync: --from/--to must be YYYY-MM-DD.');
    process.exit(1);
  }
  return { from, to };
}

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

function bucketByWeek(
  entries: HarvestTimeEntry[],
  weeks: readonly string[]
): Map<string, HarvestTimeEntry[]> {
  const weekSet = new Set(weeks);
  const map = new Map<string, HarvestTimeEntry[]>();
  for (const week of weeks) map.set(week, []);
  for (const e of entries) {
    const wk = weekStartIso(new Date(`${e.spent_date}T00:00:00`));
    if (!weekSet.has(wk)) continue;
    map.get(wk)!.push(e);
  }
  return map;
}

function buildPersonWeek(
  userId: number,
  userName: string,
  weekStart: string,
  weekEnd: string,
  entries: HarvestTimeEntry[]
): HarvestPersonWeek {
  const byProject: Record<string, number> = {};
  let totalHours = 0;
  for (const e of entries) {
    totalHours += e.hours;
    byProject[e.project.name] = (byProject[e.project.name] ?? 0) + e.hours;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    userId,
    userName,
    weekStart,
    weekEnd,
    fetchedAt: new Date().toISOString(),
    totalHours: round2(totalHours),
    entryCount: entries.length,
    byProject: Object.fromEntries(
      Object.entries(byProject).map(([k, v]) => [k, round2(v)])
    ),
  };
}

async function savePersonWeek(pw: HarvestPersonWeek): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${pw.userId}-${pw.weekStart}.json`);
  await fs.writeFile(file, JSON.stringify(pw, null, 2));
}

async function main(): Promise<void> {
  if (!process.env.HARVEST_ACCESS_TOKEN || !process.env.HARVEST_ACCOUNT_ID) {
    console.error('person-sync: HARVEST_ACCESS_TOKEN or HARVEST_ACCOUNT_ID missing.');
    process.exit(1);
  }

  const range = parseDateRangeArgs();
  const weeks = range
    ? weeksInRange(range.from, range.to)
    : (() => {
        const w: string[] = [];
        for (let i = 1; i <= 8; i++) {
          w.push(weekStartIso(subWeeks(new Date(), i)));
        }
        return w.reverse();
      })();

  const fromDate = weeks[0];
  const toDate = format(
    addDays(new Date(`${weeks[weeks.length - 1]}T00:00:00`), 6),
    'yyyy-MM-dd'
  );

  console.log(`== person-sync: ${SALARIED_USER_NAMES.length} people × ${weeks.length} weeks ==`);
  console.log(`   window: ${fromDate} → ${toDate}\n`);

  const allUsers = await listUsers();
  const userMap = new Map<string, { id: number; name: string }>();
  for (const u of allUsers) {
    const full = `${u.first_name} ${u.last_name}`;
    userMap.set(full, { id: u.id, name: full });
  }

  const missing: string[] = [];
  const resolved: Array<{ id: number; name: string }> = [];
  for (const name of SALARIED_USER_NAMES) {
    const hit = userMap.get(name);
    if (hit) resolved.push(hit);
    else missing.push(name);
  }
  if (missing.length) {
    console.error(
      `person-sync: could not resolve Harvest user(s): ${missing.join(', ')}\n` +
        `   (compare against Harvest UI — name must match first + ' ' + last exactly, ` +
        `including curly apostrophes)`
    );
    process.exit(1);
  }

  const start = Date.now();
  let written = 0;
  const errors: string[] = [];

  for (const u of resolved) {
    console.log(`# ${u.name} (user_id=${u.id})`);
    try {
      const entries = await listTimeEntriesByUser({
        userId: u.id,
        from: fromDate,
        to: toDate,
      });
      const bucketed = bucketByWeek(entries, weeks);
      for (const week of weeks) {
        const weekEnd = format(addDays(new Date(`${week}T00:00:00`), 6), 'yyyy-MM-dd');
        const pw = buildPersonWeek(u.id, u.name, week, weekEnd, bucketed.get(week) ?? []);
        await savePersonWeek(pw);
        written++;
        const projects = Object.keys(pw.byProject).length;
        console.log(
          `  ${week}  ${pw.totalHours.toFixed(1).padStart(6)}h  ` +
            `(${pw.entryCount} entries across ${projects} project${projects === 1 ? '' : 's'})`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${u.name}: ${msg}`);
      console.error(`  ERROR: ${msg}`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n== done: ${written} person-weeks in ${elapsed}s, ${errors.length} errors ==`);
  if (errors.length) errors.forEach(e => console.log('  -', e));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
