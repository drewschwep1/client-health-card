import type { ClientId, DimensionId } from '../constants';

export type RubricScore = 1 | 2 | 3 | 4 | 5;

// Scores Claude can honestly produce from a Fathom transcript + summary.
// Results Delivered and Capacity Fit are intentionally excluded — they
// require GSC/Ahrefs/analytics and time-tracking data, respectively.
export type FathomScorableDimension =
  | 'client-happiness'
  | 'execution-discipline'
  | 'internal-momentum';

export const FATHOM_SCORABLE_DIMENSIONS: FathomScorableDimension[] = [
  'client-happiness',
  'execution-discipline',
  'internal-momentum',
];

// Shape returned by the Claude extraction pass over a single touchpoint
// (Fathom meeting or Gmail thread). Gmail synthesizes a numeric recordingId
// from sha256(Message-Id) so the existing UI keys continue to work.
export interface Extraction {
  source?: 'fathom' | 'gmail' | 'slack'; // missing → 'fathom' (back-compat for pre-Gmail extractions)
  recordingId: number;
  meetingTitle: string;
  meetingDate: string; // ISO
  clientId: ClientId | null; // null → unmatched, needs manual triage
  matchedVia: 'domain' | 'title' | 'llm' | 'none';

  // Per-dimension scores. Each is RubricScore (1-5) if the transcript
  // supports a judgment, null if there's no evidence either way.
  scores: Partial<Record<FathomScorableDimension, RubricScore | null>>;

  // Narrative signals
  weeklyWins: string[]; // 2–5 bullets, ideally direct quotes
  proactivitySignals: string[]; // evidence of SearchTides being proactive
  concerns: string[]; // risk flags, complaint language
  rawEvidence: Array<{
    dimensionId: DimensionId;
    quote: string;
    speaker: string;
  }>;

  // Bookkeeping
  extractedAt: string; // ISO
  model: string;
  schemaVersion: number; // bump when the extraction contract changes
}
