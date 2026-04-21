import { promises as fs } from 'node:fs';
import path from 'node:path';
import { startOfWeek, format, subWeeks } from 'date-fns';

import { CLIENTS, DIMENSIONS, type ClientId, type DimensionId } from './constants';
import { getClientSignals, type ClientSignals } from './fathom/rollup';
import { getProfoundSignal, type ProfoundClientSignal } from './profound/rollup';
import { FATHOM_SCORABLE_DIMENSIONS } from './fathom/extract-types';
import { generateWeekInATweet } from './tweet';

const PUBLIC_MANIFEST = path.join(process.cwd(), 'public', 'data', 'fathom', 'signals.json');

function weekIso(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

// The shape stored per (client, weekStart) in the manifest. Merges Fathom
// (3 dimensions) + Profound (Results Delivered). Capacity Fit remains
// pending until a time-tracking source is wired.
export type HealthCardEntry = Omit<ClientSignals, 'coveredDimensions' | 'partialHealth'> & {
  profound: ProfoundClientSignal | null;
  // Unified per-dimension score table merging all sources. null for
  // dimensions that are covered in principle but produced no score this
  // week; missing keys = dimension not covered by any wired data source.
  dimScores: Partial<Record<DimensionId, number | null>>;
  // Recomputed with Profound contributing Results Delivered if available.
  // Overrides the narrower Fathom-only fields of ClientSignals.
  coveredDimensions: DimensionId[];
  partialHealth: number | null;
  // One-sentence AI-generated summary of the week. null when there's no
  // signal to summarize or Anthropic isn't configured.
  weekInATweet: string | null;
};

function dimWeight(id: DimensionId): number {
  return DIMENSIONS.find(d => d.id === id)?.weight ?? 0;
}

// Merges Fathom's per-dim scores with Profound's Results Delivered score,
// normalizes weights across covered dimensions, and returns a 0-100 health.
function computeCombinedHealth(
  fathom: ClientSignals,
  profound: ProfoundClientSignal | null
): { coveredDimensions: DimensionId[]; partialHealth: number | null } {
  const perDim: Partial<Record<DimensionId, number>> = {};
  for (const d of FATHOM_SCORABLE_DIMENSIONS) {
    const s = fathom.suggestedScores[d];
    if (s !== null && s !== undefined) perDim[d] = s;
  }
  if (profound?.rubricScore !== null && profound?.rubricScore !== undefined) {
    perDim['results-delivered'] = profound.rubricScore;
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

  for (const c of CLIENTS) {
    const perWeek: Record<string, HealthCardEntry> = {};
    for (const week of weeks) {
      const fathom = await getClientSignals(c.id as ClientId, week, {
        excludeRecordingIds: opts.excludeRecordingIds,
      });
      const profound = await getProfoundSignal(c.id as ClientId, week);

      const hasAnyData = fathom.meetingCount > 0 || profound !== null;
      if (!hasAnyData) continue;

      const combined = computeCombinedHealth(fathom, profound);
      const { coveredDimensions: _drop1, partialHealth: _drop2, ...fathomRest } = fathom;
      const dimScores: Partial<Record<DimensionId, number | null>> = {
        'client-happiness': fathom.suggestedScores['client-happiness'] ?? null,
        'execution-discipline': fathom.suggestedScores['execution-discipline'] ?? null,
        'internal-momentum': fathom.suggestedScores['internal-momentum'] ?? null,
        'results-delivered': profound?.rubricScore ?? null,
      };

      const weekInATweet = await generateWeekInATweet(
        c.id as ClientId,
        week,
        fathom,
        profound,
        combined.partialHealth
      );

      perWeek[week] = {
        ...fathomRest,
        profound,
        dimScores,
        coveredDimensions: combined.coveredDimensions,
        partialHealth: combined.partialHealth,
        weekInATweet,
      };
    }
    if (Object.keys(perWeek).length > 0) manifest.clients[c.id] = perWeek;
  }

  await fs.mkdir(path.dirname(PUBLIC_MANIFEST), { recursive: true });
  await fs.writeFile(PUBLIC_MANIFEST, JSON.stringify(manifest, null, 2));
  return { clientsWithData: Object.keys(manifest.clients).length, path: PUBLIC_MANIFEST };
}
