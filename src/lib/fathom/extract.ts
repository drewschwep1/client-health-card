import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  CLIENTS,
  DIMENSIONS,
  RUBRIC,
  DOMAIN_TO_CLIENT,
  type ClientId,
  type DimensionId,
} from '../constants';
import type { StoredMeeting } from './store';
import type { Extraction, FathomScorableDimension, RubricScore } from './extract-types';

export const MODEL = 'claude-sonnet-4-6';
export const SCHEMA_VERSION = 2;

const DIMENSION_IDS: DimensionId[] = DIMENSIONS.map(d => d.id);
const CLIENT_IDS: ClientId[] = CLIENTS.map(c => c.id);

// Claude returns 0-5 for each scorable dimension: 0 = no evidence in
// transcript (honest pass), 1-5 = rubric score. 0 is normalized to null
// after parsing.
const scoreField = (dimensionLabel: string, rule: string) => ({
  type: 'integer' as const,
  enum: [0, 1, 2, 3, 4, 5],
  description: `${dimensionLabel} — score per the rubric (1..5). Return 0 ONLY if the transcript offers no evidence either way; do not guess. ${rule}`,
});

export const extractionSchema = {
  type: 'object' as const,
  properties: {
    clientId: {
      type: ['string', 'null'] as ('string' | 'null')[],
      enum: [...CLIENT_IDS, null],
      description: 'Which client this meeting is about, or null if unclear.',
    },
    clientHappinessScore: scoreField(
      'Client Happiness',
      'Base on CLIENT tone, engagement, complaints, praise — not internal sentiment.'
    ),
    executionDisciplineScore: scoreField(
      'Execution Discipline',
      'Base on visible deliverable cadence, response-time references, whether the client is chasing us, proactive slip-flagging. No-ops/internal calls usually return 0.'
    ),
    internalMomentumScore: scoreField(
      'Internal Momentum',
      'Base on whether the team seems ahead/on-pace/behind on this account — unprompted strategic recommendations, energy, proactive ideas.'
    ),
    weeklyWins: {
      type: 'array' as const,
      items: { type: 'string' as const },
      minItems: 0,
      maxItems: 6,
      description:
        'Concrete wins — budget approvals, KPI hits, client praise, scope expansions. Direct quotes preferred.',
    },
    proactivitySignals: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        'Evidence of US (SearchTides) being proactive: unprompted recommendations, early deliverables, flagging risks before the client notices.',
    },
    concerns: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Risk flags, complaints, missed deliverables, tension.',
    },
    rawEvidence: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          dimensionId: { type: 'string' as const, enum: DIMENSION_IDS },
          quote: { type: 'string' as const },
          speaker: { type: 'string' as const },
        },
        required: ['dimensionId', 'quote', 'speaker'],
      },
      description: 'Supporting quotes per dimension. Up to 8.',
      maxItems: 8,
    },
  },
  required: [
    'clientId',
    'clientHappinessScore',
    'executionDisciplineScore',
    'internalMomentumScore',
    'weeklyWins',
    'proactivitySignals',
    'concerns',
    'rawEvidence',
  ],
};

const scoreZod = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const extractionZod = z.object({
  clientId: z.enum(CLIENT_IDS as [ClientId, ...ClientId[]]).nullable(),
  clientHappinessScore: scoreZod,
  executionDisciplineScore: scoreZod,
  internalMomentumScore: scoreZod,
  weeklyWins: z.array(z.string()).max(6),
  proactivitySignals: z.array(z.string()),
  concerns: z.array(z.string()),
  rawEvidence: z
    .array(
      z.object({
        dimensionId: z.enum(DIMENSION_IDS as [DimensionId, ...DimensionId[]]),
        quote: z.string(),
        speaker: z.string(),
      })
    )
    .max(8),
});

function domainMatch(meeting: StoredMeeting): ClientId | null {
  const invitees = meeting.meeting.calendar_invitees ?? [];
  for (const inv of invitees) {
    const domain = (inv.email ?? '').split('@')[1]?.toLowerCase();
    if (domain && DOMAIN_TO_CLIENT[domain]) return DOMAIN_TO_CLIENT[domain];
  }
  return null;
}

function titleMatch(meeting: StoredMeeting): ClientId | null {
  const title = (meeting.meeting.title ?? '').toLowerCase();
  for (const c of CLIENTS) {
    const name = c.name.toLowerCase();
    if (title.includes(name)) return c.id;
  }
  return null;
}

export function buildStaticContext(): string {
  const rubricLines: string[] = [];
  for (const dim of DIMENSIONS) {
    rubricLines.push(`### ${dim.name} (${dim.id}, weight ${dim.weight})`);
    for (const [score, desc] of Object.entries(RUBRIC[dim.id])) {
      rubricLines.push(`- ${score}: ${desc}`);
    }
    rubricLines.push('');
  }

  const clientLines = CLIENTS.map(
    c => `- ${c.id}: ${c.name} (${c.vertical}, ICP fit=${c.icpFit})`
  );

  return [
    '# Scoring rubric (authoritative — use these exact thresholds)',
    '',
    rubricLines.join('\n'),
    '# Active clients',
    '',
    clientLines.join('\n'),
  ].join('\n');
}

const SYSTEM_PROMPT = `You read SearchTides client-call transcripts from Fathom and produce structured signals for our automated Client Health Card.

Output is consumed by software, not humans — accuracy and restraint matter more than completeness. If the transcript doesn't support a score, return 0 for that dimension. Never fabricate.

Score three dimensions (client-happiness, execution-discipline, internal-momentum) per the rubric. Do NOT attempt to score results-delivered or capacity-fit — those come from GSC/Ahrefs/time-tracking, not transcripts.

Rules:
- weeklyWins: paraphrased client statements or meeting outcomes. Budget approvals, KPI hits, client praise, scope expansions count. Internal SearchTides discussion does NOT count.
- proactivitySignals: evidence US (SearchTides) are being proactive. Client being proactive does NOT count.
- concerns: specific risk flags. "Client tense at 12:03" is useful; "call had issues" is not.
- rawEvidence: exact quotes, attributed to a speaker, tagged with the dimensionId they support.
- clientId: pick from the active-clients list. Internal meetings (no external client) return null.
- Score 0 on any dimension where the transcript genuinely gives no signal — especially common on internal meetings, short tactical calls, or AEO training sessions.`;

export function normalizeScore(s: number): RubricScore | null {
  return s === 0 ? null : (s as RubricScore);
}

export async function extractFromMeeting(meeting: StoredMeeting): Promise<Extraction> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const preMatchedByDomain = domainMatch(meeting);
  const preMatchedByTitle = preMatchedByDomain ? null : titleMatch(meeting);
  const preMatched = preMatchedByDomain ?? preMatchedByTitle;
  const matchedVia: Extraction['matchedVia'] = preMatchedByDomain
    ? 'domain'
    : preMatchedByTitle
      ? 'title'
      : 'none';

  const invitees = (meeting.meeting.calendar_invitees ?? [])
    .map(i => `${i.name ?? '?'} <${i.email ?? '?'}>`)
    .join(', ');

  const dynamicBlock = [
    `## Meeting metadata`,
    `- title: ${meeting.meeting.title}`,
    `- date: ${meeting.meeting.scheduled_start_time}`,
    `- invitees: ${invitees || '(none)'}`,
    preMatched
      ? `- heuristic-matched client: ${preMatched} (via ${matchedVia})`
      : '- no heuristic client match',
    '',
    `## Fathom auto-summary (markdown)`,
    meeting.summaryMarkdown || '(no summary available)',
    '',
    `## Full transcript`,
    meeting.transcript || '(no transcript available)',
  ].join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'emit_extraction',
        description: 'Emit the structured scorecard signals for this meeting.',
        input_schema: extractionSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_extraction' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildStaticContext(),
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: dynamicBlock },
        ],
      },
    ],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(
      `No tool_use in Claude response for recording ${meeting.meeting.recording_id}`
    );
  }

  const parsed = extractionZod.parse(toolUse.input);

  const finalMatchedVia: Extraction['matchedVia'] = preMatched
    ? matchedVia
    : parsed.clientId
      ? 'llm'
      : 'none';

  const scores: Partial<Record<FathomScorableDimension, RubricScore | null>> = {
    'client-happiness': normalizeScore(parsed.clientHappinessScore),
    'execution-discipline': normalizeScore(parsed.executionDisciplineScore),
    'internal-momentum': normalizeScore(parsed.internalMomentumScore),
  };

  return {
    recordingId: meeting.meeting.recording_id,
    meetingTitle: meeting.meeting.title,
    meetingDate: meeting.meeting.scheduled_start_time,
    clientId: preMatched ?? parsed.clientId,
    matchedVia: finalMatchedVia,
    scores,
    weeklyWins: parsed.weeklyWins,
    proactivitySignals: parsed.proactivitySignals,
    concerns: parsed.concerns,
    rawEvidence: parsed.rawEvidence,
    extractedAt: new Date().toISOString(),
    model: MODEL,
    schemaVersion: SCHEMA_VERSION,
  };
}
