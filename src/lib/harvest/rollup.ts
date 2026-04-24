import { CAPACITY_COUNTED_USERS, CLIENT_METADATA, type ClientId } from '../constants';
import { listSnapshotsForClient } from './store';
import type { HarvestSnapshot } from './types';

const COUNTED = new Set<string>(CAPACITY_COUNTED_USERS);

// Sum hours across only the whitelisted strategy/account-team users.
// Everyone else (link-building team, ops, admin) is excluded per the
// CAPACITY_COUNTED_USERS rule in constants.ts.
function countedHours(snap: HarvestSnapshot): number {
  let total = 0;
  for (const [name, hrs] of Object.entries(snap.byUser)) {
    if (COUNTED.has(name)) total += hrs;
  }
  return Math.round(total * 100) / 100;
}

// What the manifest surfaces per client per week for Capacity Fit. The
// rubric is portfolio-relative (hours-per-$1k-MRR vs. portfolio median),
// so rubricScore is NOT set here — the rollup only sees one client's
// data. Manifest.ts fills rubricScore after collecting every client's
// signal for the week and computing the median.
export interface HarvestClientSignal {
  clientId: ClientId;
  weekStart: string;
  snapshot: HarvestSnapshot;
  hoursThisWeek: number;
  hoursPriorWeek: number | null;
  hoursWowDelta: number | null;
  hours4wAvg: number | null;
  // Hours per $1k MRR this week. null when MRR is unknown or hours are 0
  // (zero-hour weeks don't contribute to the median or a capacity score).
  hoursPerThousandMrr: number | null;
  // Assigned by manifest.ts once the portfolio median for the week is
  // known. Stays null when MRR/hours are missing or the portfolio doesn't
  // have enough covered clients that week.
  rubricScore: number | null;
}

function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

function avg(vals: Array<number | null>): number | null {
  const present = vals.filter((v): v is number => typeof v === 'number');
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export async function getHarvestSignal(
  clientId: ClientId,
  weekStart: string
): Promise<HarvestClientSignal | null> {
  const all = await listSnapshotsForClient(clientId);
  const current = all.find(s => s.weekStart === weekStart);
  if (!current) return null;

  const idx = all.indexOf(current);
  const prior = idx > 0 ? all[idx - 1] : null;
  const last4 = all.slice(Math.max(0, idx - 4), idx);

  // All downstream values (UI hours, WoW delta, capacity scoring) use
  // strategy-only hours — link-building team time is excluded.
  const thisWeek = countedHours(current);
  const priorWeek = prior ? countedHours(prior) : null;

  const mrr = CLIENT_METADATA[clientId]?.monthlyValue ?? null;
  const hoursPerThousandMrr =
    mrr !== null && mrr > 0 && thisWeek > 0 ? thisWeek / (mrr / 1000) : null;

  return {
    clientId,
    weekStart,
    snapshot: current,
    hoursThisWeek: thisWeek,
    hoursPriorWeek: priorWeek,
    hoursWowDelta: diff(thisWeek, priorWeek),
    hours4wAvg: avg(last4.map(s => countedHours(s))),
    hoursPerThousandMrr,
    rubricScore: null,
  };
}
