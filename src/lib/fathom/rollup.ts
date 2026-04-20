import { startOfWeek, format, parseISO, isWithinInterval, addDays } from 'date-fns';
import { DIMENSIONS, type ClientId, type DimensionId } from '../constants';
import { listAllExtractions } from './store';
import type { Extraction, FathomScorableDimension } from './extract-types';
import { FATHOM_SCORABLE_DIMENSIONS } from './extract-types';

export interface ClientSignals {
  clientId: ClientId;
  weekStart: string;
  meetingCount: number;
  meetings: Array<{
    recordingId: number;
    title: string;
    date: string;
  }>;
  weeklyWins: string[];
  concerns: string[];
  proactivitySignals: string[];

  // Averaged per-dimension scores across the week's meetings. null when no
  // meeting produced a score for that dimension.
  suggestedScores: Record<FathomScorableDimension, number | null>;

  // Normalized health over the dimensions Fathom can score. 0–100, weighted
  // by each dimension's share within the Fathom-covered subset (so the
  // three covered dimensions sum to 100% of the partial health, not 70%).
  // null when no dimension had any score.
  partialHealth: number | null;

  // Which dimensions actually contributed. Used by the UI to flag that
  // results-delivered and capacity-fit are pending external data.
  coveredDimensions: FathomScorableDimension[];

  rawEvidence: Array<{
    dimensionId: DimensionId;
    quote: string;
    speaker: string;
    recordingId: number;
  }>;

  // Convenience for older callers that only read happiness.
  suggestedHappinessScore: number | null;
}

function weekStartIso(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export async function getClientSignals(
  clientId: ClientId,
  weekStart?: string,
  opts?: { excludeRecordingIds?: Set<number> }
): Promise<ClientSignals> {
  const week = weekStart ?? weekStartIso(new Date());
  const weekStartDate = parseISO(week);
  const weekEndDate = addDays(weekStartDate, 7);
  const excluded = opts?.excludeRecordingIds ?? new Set<number>();

  const all = await listAllExtractions();
  const relevant = all.filter(e => {
    if (e.clientId !== clientId) return false;
    if (excluded.has(e.recordingId)) return false;
    try {
      return isWithinInterval(parseISO(e.meetingDate), {
        start: weekStartDate,
        end: weekEndDate,
      });
    } catch {
      return false;
    }
  });

  return aggregate(clientId, week, relevant);
}

function scoreFromExtraction(
  e: Extraction,
  dim: FathomScorableDimension
): number | null {
  // Back-compat: older extractions (schemaVersion < 2) only have
  // clientHappinessScore at the top level.
  if (e.scores && dim in e.scores) {
    const v = e.scores[dim];
    return v ?? null;
  }
  // Legacy shape
  const legacy = (e as unknown as { clientHappinessScore?: number }).clientHappinessScore;
  if (dim === 'client-happiness' && typeof legacy === 'number') return legacy;
  return null;
}

function averageNonNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (!present.length) return null;
  return Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10;
}

function aggregate(
  clientId: ClientId,
  weekStart: string,
  extractions: Extraction[]
): ClientSignals {
  const wins = new Set<string>();
  const concerns = new Set<string>();
  const proactivity = new Set<string>();
  const rawEvidence: ClientSignals['rawEvidence'] = [];

  const perDim: Record<FathomScorableDimension, Array<number | null>> = {
    'client-happiness': [],
    'execution-discipline': [],
    'internal-momentum': [],
  };

  for (const e of extractions) {
    e.weeklyWins.forEach(w => wins.add(w));
    e.concerns.forEach(c => concerns.add(c));
    e.proactivitySignals.forEach(p => proactivity.add(p));
    for (const dim of FATHOM_SCORABLE_DIMENSIONS) {
      perDim[dim].push(scoreFromExtraction(e, dim));
    }
    for (const r of e.rawEvidence) {
      rawEvidence.push({ ...r, recordingId: e.recordingId });
    }
  }

  const suggestedScores: Record<FathomScorableDimension, number | null> = {
    'client-happiness': averageNonNull(perDim['client-happiness']),
    'execution-discipline': averageNonNull(perDim['execution-discipline']),
    'internal-momentum': averageNonNull(perDim['internal-momentum']),
  };

  const coveredDimensions = FATHOM_SCORABLE_DIMENSIONS.filter(
    d => suggestedScores[d] !== null
  );

  // Normalized partial health: only covered dimensions count, reweighted so
  // their weights sum to 1. Then scale the 1-5 average to 0-100.
  const dimWeight = (id: DimensionId): number =>
    DIMENSIONS.find(d => d.id === id)?.weight ?? 0;
  const coveredWeightSum = coveredDimensions.reduce(
    (sum, d) => sum + dimWeight(d),
    0
  );
  const partialHealth =
    coveredWeightSum > 0
      ? Math.round(
          (coveredDimensions.reduce(
            (sum, d) => sum + (suggestedScores[d] ?? 0) * dimWeight(d),
            0
          ) /
            coveredWeightSum /
            5) *
            100
        )
      : null;

  return {
    clientId,
    weekStart,
    meetingCount: extractions.length,
    meetings: extractions.map(e => ({
      recordingId: e.recordingId,
      title: e.meetingTitle,
      date: e.meetingDate,
    })),
    weeklyWins: Array.from(wins),
    concerns: Array.from(concerns),
    proactivitySignals: Array.from(proactivity),
    suggestedScores,
    partialHealth,
    coveredDimensions,
    rawEvidence,
    suggestedHappinessScore: suggestedScores['client-happiness'],
  };
}
