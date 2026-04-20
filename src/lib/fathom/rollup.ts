import { startOfWeek, format, parseISO, isWithinInterval, addDays } from 'date-fns';
import type { ClientId, DimensionId } from '../constants';
import { listAllExtractions } from './store';
import type { Extraction } from './extract-types';

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
  // Avg of Claude's per-meeting happiness scores for the week, or null.
  suggestedHappinessScore: number | null;
  rawEvidence: Array<{ dimensionId: DimensionId; quote: string; speaker: string; recordingId: number }>;
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

function aggregate(clientId: ClientId, weekStart: string, extractions: Extraction[]): ClientSignals {
  const wins = new Set<string>();
  const concerns = new Set<string>();
  const proactivity = new Set<string>();
  const rawEvidence: ClientSignals['rawEvidence'] = [];
  const happinessScores: number[] = [];

  for (const e of extractions) {
    e.weeklyWins.forEach(w => wins.add(w));
    e.concerns.forEach(c => concerns.add(c));
    e.proactivitySignals.forEach(p => proactivity.add(p));
    happinessScores.push(e.clientHappinessScore);
    for (const r of e.rawEvidence) {
      rawEvidence.push({ ...r, recordingId: e.recordingId });
    }
  }

  const suggestedHappinessScore = happinessScores.length
    ? Math.round((happinessScores.reduce((a, b) => a + b, 0) / happinessScores.length) * 10) / 10
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
    suggestedHappinessScore,
    rawEvidence,
  };
}
