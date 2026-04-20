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
import type { Extraction } from './extract-types';

const MODEL = 'claude-sonnet-4-6';

const DIMENSION_IDS: DimensionId[] = DIMENSIONS.map(d => d.id);
const CLIENT_IDS: ClientId[] = CLIENTS.map(c => c.id);

// Tool schema — Claude returns structured data via a forced tool call.
const extractionSchema = {
  type: 'object' as const,
  properties: {
    clientId: {
      type: ['string', 'null'] as ('string' | 'null')[],
      enum: [...CLIENT_IDS, null],
      description: 'Which client this meeting is about, or null if unclear.',
    },
    weeklyWins: {
      type: 'array' as const,
      items: { type: 'string' as const },
      minItems: 0,
      maxItems: 6,
      description:
        'Concrete wins or positive outcomes mentioned — budget approvals, KPI hits, client praise, scope expansions. Direct quotes preferred.',
    },
    clientHappinessScore: {
      type: 'integer' as const,
      enum: [1, 2, 3, 4, 5],
      description:
        'Score the client-happiness rubric (1 actively unhappy … 5 actively championing). Base ONLY on tone, engagement, complaints, praise in this transcript.',
    },
    proactivitySignals: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        'Evidence we (SearchTides) are being proactive: unprompted recommendations, early deliverables, flagging risks before client notices.',
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
    'weeklyWins',
    'clientHappinessScore',
    'proactivitySignals',
    'concerns',
    'rawEvidence',
  ],
};

const extractionZod = z.object({
  clientId: z.enum(CLIENT_IDS as [ClientId, ...ClientId[]]).nullable(),
  weeklyWins: z.array(z.string()).max(6),
  clientHappinessScore: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
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
    // Require whole-word-ish match — guards against "edge" matching random mentions.
    const name = c.name.toLowerCase();
    if (title.includes(name)) return c.id;
  }
  return null;
}

// Static, cacheable block — rubric + clients list. Claude prompt-caches
// this so subsequent extractions only pay for the transcript tokens.
function buildStaticContext(): string {
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

const SYSTEM_PROMPT = `You read SearchTides client-call transcripts from Fathom and extract structured signals for our weekly Client Health Card.

Your output feeds a human scorecard — accuracy and direct evidence matter more than cleverness. When the transcript is thin, return fewer/shorter items; never fabricate wins or happiness.

Rules:
- weeklyWins: prefer paraphrased direct statements over editorial summaries. Budget approvals, KPI hits, client praise, scope expansions count. Internal SearchTides chit-chat does not.
- clientHappinessScore: score the CLIENT's happiness with SearchTides, not overall call sentiment. If the transcript contains no client engagement signal, return 3.
- proactivitySignals: evidence of US being proactive (unprompted recommendations, early deliverables, flagging risks). Client being proactive does not count.
- concerns: anything that would make the scorer lower a dimension. Be specific — "client seemed tense at 12:03" is useful, "call had issues" is not.
- rawEvidence: exact quotes, attributed to a speaker, tagged with the dimensionId they support.
- clientId: pick from the active-clients list. If the meeting is clearly internal (no external client), or you cannot tell, return null.`;

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
    preMatched ? `- heuristic-matched client: ${preMatched} (via ${matchedVia})` : '- no heuristic client match',
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
    throw new Error(`No tool_use in Claude response for recording ${meeting.meeting.recording_id}`);
  }

  const parsed = extractionZod.parse(toolUse.input);

  // If the LLM picked a clientId and the heuristic didn't, that's an LLM match.
  const finalMatchedVia: Extraction['matchedVia'] = preMatched
    ? matchedVia
    : parsed.clientId
      ? 'llm'
      : 'none';

  return {
    recordingId: meeting.meeting.recording_id,
    meetingTitle: meeting.meeting.title,
    meetingDate: meeting.meeting.scheduled_start_time,
    clientId: preMatched ?? parsed.clientId,
    matchedVia: finalMatchedVia,
    weeklyWins: parsed.weeklyWins,
    clientHappinessScore: parsed.clientHappinessScore,
    proactivitySignals: parsed.proactivitySignals,
    concerns: parsed.concerns,
    rawEvidence: parsed.rawEvidence,
    extractedAt: new Date().toISOString(),
    model: MODEL,
  };
}
