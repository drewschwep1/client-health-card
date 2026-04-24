// Cost attribution engine. Turns hour snapshots into dollar costs
// per (client, week) using the capped-40h salaried model confirmed
// with Drew on 2026-04-24:
//
//   salaried: rate = annualSalary / 2080
//             billableHours = min(personTotalHoursThatWeek, 40)
//             costToClient  = billableHours × (clientHours / personTotalHours) × rate
//             hours > 40 are sunk salary — zero marginal cost
//
//   hourly:   costToClient = clientHours × hourlyRate (no cap)
//
// The person-week denominator must include ALL projects, not just the
// ones in CLIENT_HARVEST_PROJECT. Otherwise we'd over-allocate to
// tracked clients when salaried people also log internal/untracked
// time. That denominator is produced by scripts/harvest-person-sync.ts.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ClientId } from '../constants';
import { CLIENT_METADATA } from '../constants';
import {
  loadTeamCosts,
  effectiveHourlyRate,
  WEEKLY_HOUR_CAP,
  type TeamMemberCost,
} from '../team-costs';
import { listSnapshotsForClient } from './store';
import type { HarvestPersonWeek, HarvestSnapshot } from './types';

const PERSON_WEEKS_DIR = path.join(process.cwd(), 'data', 'harvest', 'person-weeks');

export interface PersonCostContribution {
  userName: string;
  hours: number; // hours for this client this week
  cost: number;  // dollars attributed to this client
  type: 'salaried' | 'hourly';
  // For salaried: person's total hours across ALL projects that week.
  // For hourly: same as `hours` (no cross-project interaction).
  personWeekTotal: number;
}

export interface WeeklyClientCost {
  clientId: ClientId;
  weekStart: string;
  totalHours: number;
  totalCost: number;
  byPerson: PersonCostContribution[];
  // People in the week's snapshot who aren't in team-costs.json — we
  // surface them so nothing silently drops out.
  unmappedPeople: Array<{ userName: string; hours: number }>;
}

export interface ClientCostSummary {
  clientId: ClientId;
  clientName: string;
  monthlyRevenue: number | null;
  weeks: WeeklyClientCost[];
  totalHours: number;
  totalCost: number;
  // Sum of MRR × (months covered). Months = distinct YYYY-MM in weeks range.
  revenueInWindow: number | null;
  marginDollars: number | null;
  marginPct: number | null;
}

// Per-(userName, weekStart) lookup of total hours across ALL projects.
// Only salaried people need this; hourly people aren't in the map.
export type PersonWeekIndex = Map<string, number>;

function personWeekKey(userName: string, weekStart: string): string {
  return `${userName}||${weekStart}`;
}

export async function loadPersonWeekIndex(): Promise<PersonWeekIndex> {
  const idx: PersonWeekIndex = new Map();
  let files: string[];
  try {
    files = await fs.readdir(PERSON_WEEKS_DIR);
  } catch {
    return idx;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(PERSON_WEEKS_DIR, f), 'utf-8');
    const pw = JSON.parse(raw) as HarvestPersonWeek;
    idx.set(personWeekKey(pw.userName, pw.weekStart), pw.totalHours);
  }
  return idx;
}

// Compute dollar cost for one (client, week) given the weekly hour
// snapshot and pre-loaded team costs + person-week totals.
export function computeWeeklyCost(
  snapshot: HarvestSnapshot,
  teamCosts: Record<string, TeamMemberCost>,
  personWeekIndex: PersonWeekIndex
): WeeklyClientCost {
  const byPerson: PersonCostContribution[] = [];
  const unmapped: Array<{ userName: string; hours: number }> = [];

  for (const [userName, clientHours] of Object.entries(snapshot.byUser)) {
    const cost = teamCosts[userName];
    if (!cost) {
      unmapped.push({ userName, hours: clientHours });
      continue;
    }

    const rate = effectiveHourlyRate(cost);

    if (cost.type === 'hourly') {
      byPerson.push({
        userName,
        hours: clientHours,
        cost: clientHours * rate,
        type: 'hourly',
        personWeekTotal: clientHours,
      });
      continue;
    }

    // salaried: need the week's total across all projects
    const personTotal = personWeekIndex.get(personWeekKey(userName, snapshot.weekStart));
    // If we don't have a person-week denominator, fall back to this
    // client's hours — strictly more conservative: caps at 40 directly.
    // We'll log this in the report so the user knows.
    const denom = personTotal ?? clientHours;
    if (denom <= 0) {
      byPerson.push({
        userName,
        hours: clientHours,
        cost: 0,
        type: 'salaried',
        personWeekTotal: denom,
      });
      continue;
    }
    const billableHours = Math.min(denom, WEEKLY_HOUR_CAP);
    const share = clientHours / denom;
    const dollars = billableHours * share * rate;
    byPerson.push({
      userName,
      hours: clientHours,
      cost: dollars,
      type: 'salaried',
      personWeekTotal: denom,
    });
  }

  const totalCost = byPerson.reduce((s, p) => s + p.cost, 0);
  const totalHours = byPerson.reduce((s, p) => s + p.hours, 0) +
    unmapped.reduce((s, u) => s + u.hours, 0);

  return {
    clientId: snapshot.clientId,
    weekStart: snapshot.weekStart,
    totalHours: round2(totalHours),
    totalCost: round2(totalCost),
    byPerson: byPerson.map(p => ({ ...p, hours: round2(p.hours), cost: round2(p.cost) })),
    unmappedPeople: unmapped.map(u => ({ ...u, hours: round2(u.hours) })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Months (YYYY-MM) that any week in the list touches. Used for
// revenue-in-window = MRR × months_covered.
function monthsCovered(weekStarts: readonly string[]): Set<string> {
  const months = new Set<string>();
  for (const wk of weekStarts) {
    // A week starting on Monday can span 2 months. Count both.
    const start = new Date(`${wk}T00:00:00`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }
  return months;
}

export async function aggregateClientCost(
  clientId: ClientId,
  from: string,
  to: string
): Promise<ClientCostSummary> {
  const teamCosts = await loadTeamCosts();
  const personWeekIndex = await loadPersonWeekIndex();
  const allSnapshots = await listSnapshotsForClient(clientId);
  const snapshots = allSnapshots.filter(
    s => s.weekStart >= from && s.weekStart <= to
  );

  const weeks = snapshots.map(s => computeWeeklyCost(s, teamCosts, personWeekIndex));

  const totalHours = weeks.reduce((s, w) => s + w.totalHours, 0);
  const totalCost = weeks.reduce((s, w) => s + w.totalCost, 0);

  const meta = CLIENT_METADATA[clientId];
  const mrr = meta?.monthlyValue ?? null;
  const months = monthsCovered(weeks.map(w => w.weekStart));
  const revenueInWindow = mrr !== null ? mrr * months.size : null;
  const marginDollars = revenueInWindow !== null ? revenueInWindow - totalCost : null;
  const marginPct =
    revenueInWindow !== null && revenueInWindow > 0
      ? (marginDollars! / revenueInWindow) * 100
      : null;

  return {
    clientId,
    clientName: clientId,
    monthlyRevenue: mrr,
    weeks,
    totalHours: round2(totalHours),
    totalCost: round2(totalCost),
    revenueInWindow: revenueInWindow !== null ? round2(revenueInWindow) : null,
    marginDollars: marginDollars !== null ? round2(marginDollars) : null,
    marginPct: marginPct !== null ? round2(marginPct) : null,
  };
}
