import type { ClientId } from '../constants';
import { listSnapshotsForClient } from './store';
import type { ProfoundSnapshot } from './types';

export type RubricScore = 1 | 2 | 3 | 4 | 5;

// What the manifest surfaces per client per week for Results Delivered.
export interface ProfoundClientSignal {
  clientId: ClientId;
  weekStart: string;
  snapshot: ProfoundSnapshot;
  // Per-signal 1-5 scores (null when no data).
  signalScores: {
    shareOfVoice: RubricScore | null;
    citationShare: RubricScore | null;
    visibilityScore: RubricScore | null;
    sentiment: RubricScore | null;
  };
  // Averaged 1-5 rubric score for Results Delivered.
  rubricScore: RubricScore | null;
  // Week-over-week deltas.
  wow: {
    shareOfVoice: number | null;
    citationShare: number | null;
    visibilityScore: number | null;
    citationCount: number | null;
    sentimentNet: number | null;
    rubricScore: number | null;
  };
  // 4-week avg comparison.
  trend4w: {
    shareOfVoice: number | null;
    citationShare: number | null;
    sentimentNet: number | null;
  };
}

// --- Scoring bands per signal ---
// share_of_voice (0-100 %, relative to 5 competitors in the category).
function scoreSoV(v: number | null): RubricScore | null {
  if (v === null) return null;
  if (v >= 20) return 5;
  if (v >= 10) return 4;
  if (v >= 5) return 3;
  if (v >= 2) return 2;
  return 1;
}

// citation_share (0-100 %, share of category citations attributed to client's domain).
function scoreCitationShare(v: number | null): RubricScore | null {
  if (v === null) return null;
  if (v >= 15) return 5;
  if (v >= 8) return 4;
  if (v >= 4) return 3;
  if (v >= 1.5) return 2;
  return 1;
}

// visibility_score (Profound's internal 0-1 index).
function scoreVisibility(v: number | null): RubricScore | null {
  if (v === null) return null;
  if (v >= 0.7) return 5;
  if (v >= 0.5) return 4;
  if (v >= 0.3) return 3;
  if (v >= 0.15) return 2;
  return 1;
}

// sentiment as positive-share % = positive / (positive + negative) * 100.
function sentimentNet(snap: ProfoundSnapshot): number | null {
  const pos = snap.sentimentPositive;
  const neg = snap.sentimentNegative;
  if (pos === null && neg === null) return null;
  const total = (pos ?? 0) + (neg ?? 0);
  if (total === 0) return null;
  return ((pos ?? 0) / total) * 100;
}
function scoreSentiment(snap: ProfoundSnapshot): RubricScore | null {
  const net = sentimentNet(snap);
  if (net === null) return null;
  if (net >= 70) return 5;
  if (net >= 55) return 4;
  if (net >= 40) return 3;
  if (net >= 25) return 2;
  return 1;
}

function averageScores(scores: Array<RubricScore | null>): RubricScore | null {
  const present = scores.filter((s): s is RubricScore => s !== null);
  if (present.length === 0) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  return Math.round(mean) as RubricScore;
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

export async function getProfoundSignal(
  clientId: ClientId,
  weekStart: string
): Promise<ProfoundClientSignal | null> {
  const all = await listSnapshotsForClient(clientId);
  const current = all.find(s => s.weekStart === weekStart);
  if (!current) return null;

  const idx = all.indexOf(current);
  const prior = idx > 0 ? all[idx - 1] : null;
  const last4 = all.slice(Math.max(0, idx - 4), idx);

  const signalScores = {
    shareOfVoice: scoreSoV(current.shareOfVoice),
    citationShare: scoreCitationShare(current.citationShare),
    visibilityScore: scoreVisibility(current.visibilityScore),
    sentiment: scoreSentiment(current),
  };

  const rubricScore = averageScores([
    signalScores.shareOfVoice,
    signalScores.citationShare,
    signalScores.visibilityScore,
    signalScores.sentiment,
  ]);

  const priorRubric = prior
    ? averageScores([
        scoreSoV(prior.shareOfVoice),
        scoreCitationShare(prior.citationShare),
        scoreVisibility(prior.visibilityScore),
        scoreSentiment(prior),
      ])
    : null;

  return {
    clientId,
    weekStart,
    snapshot: current,
    signalScores,
    rubricScore,
    wow: {
      shareOfVoice: diff(current.shareOfVoice, prior?.shareOfVoice ?? null),
      citationShare: diff(current.citationShare, prior?.citationShare ?? null),
      visibilityScore: diff(current.visibilityScore, prior?.visibilityScore ?? null),
      citationCount: diff(current.citationCount, prior?.citationCount ?? null),
      sentimentNet: diff(sentimentNet(current), prior ? sentimentNet(prior) : null),
      rubricScore: diff(rubricScore, priorRubric),
    },
    trend4w: {
      shareOfVoice: diff(current.shareOfVoice, avg(last4.map(s => s.shareOfVoice))),
      citationShare: diff(current.citationShare, avg(last4.map(s => s.citationShare))),
      sentimentNet: diff(sentimentNet(current), avg(last4.map(s => sentimentNet(s)))),
    },
  };
}
