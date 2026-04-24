// Team cost rates for cost-to-service reporting. Data lives in
// data/team-costs.json (gitignored). Keys are Harvest full_name
// (first + ' ' + last), must match exactly.
//
// Model: salaried people are capped at 40h/week at (annualSalary/2080);
// hourly people bill (hours × hourlyRate) with no cap. Applied in
// src/lib/harvest/cost.ts.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export type TeamMemberCost =
  | { type: 'salaried'; annualSalary: number }
  | { type: 'hourly'; hourlyRate: number };

export interface TeamCostsFile {
  people: Record<
    string,
    | { type: 'salaried'; annualSalary: number | null; note?: string }
    | { type: 'hourly'; hourlyRate: number | null; note?: string }
  >;
}

const FILE_PATH = path.join(process.cwd(), 'data', 'team-costs.json');

// Standard full-time working hours per year. Used to convert salary
// into an effective hourly rate when computing capped costs.
export const ANNUAL_WORK_HOURS = 2080;

// Weekly cap — the "free overtime" pivot. Hours beyond this are sunk
// salary and don't inflate client cost.
export const WEEKLY_HOUR_CAP = 40;

export async function loadTeamCosts(): Promise<Record<string, TeamMemberCost>> {
  const raw = await fs.readFile(FILE_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as TeamCostsFile;

  const out: Record<string, TeamMemberCost> = {};
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(parsed.people)) {
    if (entry.type === 'salaried') {
      if (typeof entry.annualSalary !== 'number') {
        missing.push(`${name} (salaried, annualSalary)`);
        continue;
      }
      out[name] = { type: 'salaried', annualSalary: entry.annualSalary };
    } else {
      if (typeof entry.hourlyRate !== 'number') {
        missing.push(`${name} (hourly, hourlyRate)`);
        continue;
      }
      out[name] = { type: 'hourly', hourlyRate: entry.hourlyRate };
    }
  }
  if (missing.length) {
    throw new Error(
      `team-costs.json is missing rate values for: ${missing.join('; ')}. ` +
        `Fill them in before running a cost report.`
    );
  }
  return out;
}

export function effectiveHourlyRate(cost: TeamMemberCost): number {
  return cost.type === 'salaried'
    ? cost.annualSalary / ANNUAL_WORK_HOURS
    : cost.hourlyRate;
}
