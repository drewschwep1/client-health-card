import type { ClientId, DimensionId } from '../constants';

// Shape returned by the Claude extraction pass over a single meeting.
export interface Extraction {
  recordingId: number;
  meetingTitle: string;
  meetingDate: string; // ISO
  clientId: ClientId | null; // null → unmatched, needs manual triage
  matchedVia: 'domain' | 'title' | 'llm' | 'none';

  // Scorecard signals
  weeklyWins: string[]; // 2–5 bullets, ideally direct quotes
  clientHappinessScore: 1 | 2 | 3 | 4 | 5; // maps to RUBRIC['client-happiness']
  proactivitySignals: string[]; // evidence for execution-discipline / internal-momentum
  concerns: string[]; // risk flags, complaint language
  rawEvidence: Array<{
    dimensionId: DimensionId;
    quote: string;
    speaker: string;
  }>;

  // Bookkeeping
  extractedAt: string; // ISO
  model: string;
}
