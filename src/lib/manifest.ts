import { promises as fs } from 'node:fs';
import path from 'node:path';
import { startOfWeek, format, subWeeks } from 'date-fns';

import { CLIENTS, DIMENSIONS, type ClientId, type DimensionId } from './constants';
import { getClientSignals, type ClientSignals } from './fathom/rollup';
import { getProfoundSignal, type ProfoundClientSignal } from './profound/rollup';
import { getHarvestSignal, type HarvestClientSignal } from './harvest/rollup';
import { FATHOM_SCORABLE_DIMENSIONS } from './fathom/extract-types';
import { generateWeekSummary, type WeekSummary } from './tweet';

const PUBLIC_MANIFEST = path.join(process.cwd(), 'public', 'data', 'fathom', 'signals.json');

function weekIso(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

// The shape stored per (client, weekStart) in the manifest. Merges Fathom
// (3 dimensions) + Profound (Results Delivered). Capacity Fit remains
// pending until a time-tracking source is wired.
export type HealthCardEntry = Omit<ClientSignals, 'coveredDimensions' | 'partialHealth'> & {
  profound: ProfoundClientSignal | null;
  // Harvest weekly hours per client. Informational only in this pass —
  // does NOT contribute to partialHealth until MRR (CLIENT_METADATA.monthlyValue)
  // is populated and the Capacity Fit scoring is flipped on in
  // computeCombinedHealth below.
  harvest: HarvestClientSignal | null;
  // Unified per-dimension score table merging all sources. null for
  // dimensions that are covered in principle but produced no score this
  // week; missing keys = dimension not covered by any wired data source.
  dimScores: Partial<Record<DimensionId, number | null>>;
  // Recomputed with Profound contributing Results Delivered if available.
  // Overrides the narrower Fathom-only fields of ClientSignals.
  coveredDimensions: DimensionId[];
  partialHealth: number | null;
  // AI-generated weekly summary: one-sentence tweet + one top win + one
  // top risk. Each field null when data doesn't support it. Whole object
  // null when no signal to summarize or Anthropic isn't configured.
  weekSummary: WeekSummary | null;
};

function dimWeight(id: DimensionId): number {
  return DIMENSIONS.find(d => d.id === id)?.weight ?? 0;
}

// Merges Fathom's per-dim scores with Profound (Results Delivered) and
// Harvest (Capacity Fit, portfolio-relative), normalizes weights across
// covered dimensions, and returns a 0-100 health.
function computeCombinedHealth(
  fathom: ClientSignals,
  profound: ProfoundClientSignal | null,
  capacityScore: number | null
): { coveredDimensions: DimensionId[]; partialHealth: number | null } {
  const perDim: Partial<Record<DimensionId, number>> = {};
  for (const d of FATHOM_SCORABLE_DIMENSIONS) {
    const s = fathom.suggestedScores[d];
    if (s !== null && s !== undefined) perDim[d] = s;
  }
  if (profound?.rubricScore !== null && profound?.rubricScore !== undefined) {
    perDim['results-delivered'] = profound.rubricScore;
  }
  if (capacityScore !== null) {
    perDim['capacity-fit'] = capacityScore;
  }

  const covered = Object.keys(perDim) as DimensionId[];
  if (covered.length === 0) return { coveredDimensions: [], partialHealth: null };

  const weightSum = covered.reduce((sum, d) => sum + dimWeight(d), 0);
  if (weightSum === 0) return { coveredDimensions: covered, partialHealth: null };

  const weighted = covered.reduce(
    (sum, d) => sum + (perDim[d] ?? 0) * dimWeight(d),
    0
  );
  return {
    coveredDimensions: covered,
    partialHealth: Math.round((weighted / weightSum / 5) * 100),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Bands mirror the Capacity Fit rubric in constants.ts:78–84. `ratio` is
// client's hours-per-$1k-MRR divided by the portfolio median for the week.
// Lower ratio = more efficient = higher score.
function scoreCapacity(ratio: number): number {
  if (ratio >= 2.0) return 1;
  if (ratio > 1.2) return 2;
  if (ratio >= 0.8) return 3;
  if (ratio >= 0.7) return 4;
  return 5;
}

// Rolls up the last 8 weeks per client across all sources. Written to
// public/data/fathom/signals.json for the static-exported Next.js app.
export async function writeManifest(opts: {
  excludeRecordingIds?: Set<number>;
} = {}): Promise<{ clientsWithData: number; path: string }> {
  const weeks = Array.from({ length: 8 }, (_, i) => weekIso(subWeeks(new Date(), i)));
  const manifest: {
    generatedAt: string;
    clients: Record<string, Record<string, HealthCardEntry>>;
  } = {
    generatedAt: new Date().toISOString(),
    clients: {},
  };

  // Pass 1: gather raw signals for every (client, week). We need a second
  // pass to assign Capacity Fit scores, which are portfolio-relative.
  interface Staged {
    clientId: ClientId;
    week: string;
    fathom: ClientSignals;
    profound: ProfoundClientSignal | null;
    harvest: HarvestClientSignal | null;
  }
  const staged: Staged[] = [];

  for (const c of CLIENTS) {
    for (const week of weeks) {
      // SearchTides on the health card = self-tracked AI visibility only.
      // Internal business Fathom content (team ops, HR, finance, internal
      // dashboards) must never surface on its tile, so we skip the Fathom
      // rollup entirely for this client and lean on Profound alone.
      const fathomRaw =
        c.id === 'searchtides'
          ? null
          : await getClientSignals(c.id as ClientId, week, {
              excludeRecordingIds: opts.excludeRecordingIds,
            });
      const fathom =
        fathomRaw ??
        ({
          clientId: c.id as ClientId,
          weekStart: week,
          meetingCount: 0,
          meetings: [],
          weeklyWins: [],
          concerns: [],
          proactivitySignals: [],
          suggestedScores: {
            'client-happiness': null,
            'execution-discipline': null,
            'internal-momentum': null,
          },
          partialHealth: null,
          coveredDimensions: [],
          rawEvidence: [],
          suggestedHappinessScore: null,
        } satisfies ClientSignals);
      const profound = await getProfoundSignal(c.id as ClientId, week);
      const harvest = await getHarvestSignal(c.id as ClientId, week);

      const hasAnyData = fathom.meetingCount > 0 || profound !== null || harvest !== null;
      if (!hasAnyData) continue;

      staged.push({ clientId: c.id as ClientId, week, fathom, profound, harvest });
    }
  }

  // Pass 2: per-week portfolio median of hours-per-$1k-MRR. Only clients
  // with both MRR and non-zero hours participate — zero-hour weeks would
  // make the median misleading. Require at least 3 clients with data to
  // compute a median; otherwise capacity stays unscored (not enough signal).
  const weekMedians = new Map<string, number | null>();
  for (const week of weeks) {
    const ratios: number[] = [];
    for (const s of staged) {
      if (s.week !== week) continue;
      const r = s.harvest?.hoursPerThousandMrr;
      if (typeof r === 'number') ratios.push(r);
    }
    weekMedians.set(week, ratios.length >= 3 ? median(ratios) : null);
  }

  // Assign Capacity Fit rubric scores on each staged signal. Mutate the
  // harvest object in place so the persisted entry carries it.
  for (const s of staged) {
    if (!s.harvest) continue;
    const hPer1k = s.harvest.hoursPerThousandMrr;
    const med = weekMedians.get(s.week) ?? null;
    s.harvest.rubricScore =
      hPer1k !== null && med !== null && med > 0 ? scoreCapacity(hPer1k / med) : null;
  }

  // Pass 3: assemble entries with combined health + week summaries.
  for (const s of staged) {
    const { clientId, week, fathom, profound, harvest } = s;
    const capacityScore = harvest?.rubricScore ?? null;
    const combined = computeCombinedHealth(fathom, profound, capacityScore);
    const { coveredDimensions: _drop1, partialHealth: _drop2, ...fathomRest } = fathom;
    const dimScores: Partial<Record<DimensionId, number | null>> = {
      'client-happiness': fathom.suggestedScores['client-happiness'] ?? null,
      'execution-discipline': fathom.suggestedScores['execution-discipline'] ?? null,
      'internal-momentum': fathom.suggestedScores['internal-momentum'] ?? null,
      'results-delivered': profound?.rubricScore ?? null,
      'capacity-fit': capacityScore,
    };

    const weekSummary = await generateWeekSummary(
      clientId,
      week,
      fathom,
      profound,
      combined.partialHealth
    );

    const entry: HealthCardEntry = {
      ...fathomRest,
      profound,
      harvest,
      dimScores,
      coveredDimensions: combined.coveredDimensions,
      partialHealth: combined.partialHealth,
      weekSummary,
    };

    const perWeek = manifest.clients[clientId] ?? (manifest.clients[clientId] = {});
    perWeek[week] = entry;
  }

  await fs.mkdir(path.dirname(PUBLIC_MANIFEST), { recursive: true });
  await fs.writeFile(PUBLIC_MANIFEST, JSON.stringify(manifest, null, 2));
  return { clientsWithData: Object.keys(manifest.clients).length, path: PUBLIC_MANIFEST };
}
