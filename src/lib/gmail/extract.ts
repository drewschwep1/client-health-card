import Anthropic from '@anthropic-ai/sdk';
import { DOMAIN_TO_CLIENT, type ClientId } from '../constants';
import {
  MODEL,
  SCHEMA_VERSION,
  extractionSchema,
  extractionZod,
  buildStaticContext,
  normalizeScore,
} from '../fathom/extract';
import type {
  Extraction,
  FathomScorableDimension,
  RubricScore,
} from '../fathom/extract-types';
import type { GmailThread } from './types';
import type { StoredThread } from './store';
import { syntheticRecordingId } from './store';

// Build the LLM-ready plain-text dump of a thread. Mirrors the shape of
// flattenTranscript() in scripts/fathom-sync.ts — one block per message,
// chronological.
export function flattenThread(thread: GmailThread): string {
  return thread.messages
    .map(m => {
      const to = m.to.join(', ');
      const cc = m.cc.length ? `\n  Cc: ${m.cc.join(', ')}` : '';
      return [
        `[${m.date}] ${m.from} → ${to}${cc}`,
        `  Subject: ${m.subject}`,
        '',
        m.bodyPlain.trim(),
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

function clientFromParticipants(thread: GmailThread): ClientId | null {
  for (const addr of thread.participants) {
    const domain = addr.split('@')[1]?.toLowerCase();
    if (domain && DOMAIN_TO_CLIENT[domain]) return DOMAIN_TO_CLIENT[domain];
  }
  return null;
}

const SYSTEM_PROMPT = `You read SearchTides ↔ client email threads and produce structured signals for our automated Client Health Card. Output is consumed by software, not humans — accuracy and restraint matter more than completeness. If the thread doesn't support a score, return 0 for that dimension. Never fabricate.

Score three dimensions (client-happiness, execution-discipline, internal-momentum) per the rubric. Do NOT attempt to score results-delivered or capacity-fit — those come from GSC/Ahrefs/time-tracking.

Rules specific to email:
- weeklyWins: client statements of praise, budget approvals, KPI hits, scope expansions, positive outcomes. Internal SearchTides discussion does NOT count.
- proactivitySignals: evidence US (SearchTides) are being proactive — unprompted recommendations, early deliverables, risks flagged to the client before they asked. Client-side proactivity does NOT count.
- concerns: specific risk flags in the thread — frustrated tone, missed deadlines referenced, complaints, "circling back" or "any update?" type chase-ups from the client, unresolved blockers.
- rawEvidence: exact quoted fragments (can be partial sentences), attributed to the sending email address, tagged with the dimensionId they support.
- clientId: pick from the active-clients list by matching the non-SearchTides participants to the domain map. If the thread is fully internal or has no clear external client, return null.
- execution-discipline in email context: heavy "any update?" / "circling back" from the client → lower; SearchTides replying quickly with concrete progress → higher. No-ops (logistics-only, single auto-reply) usually return 0.
- Score 0 on any dimension the thread genuinely gives no signal for — especially common on logistics-only threads ("moving our 3pm to 4pm"), one-line confirmations, or calendar invites.`;

export async function extractFromThread(stored: StoredThread): Promise<Extraction> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const preMatched = clientFromParticipants(stored.thread);

  const participantsLine = stored.thread.participants.join(', ');

  const dynamicBlock = [
    `## Thread metadata`,
    `- subject: ${stored.thread.subject}`,
    `- earliest message: ${stored.thread.earliestDate}`,
    `- latest message: ${stored.thread.latestDate}`,
    `- message count: ${stored.thread.messages.length}`,
    `- participants: ${participantsLine || '(none)'}`,
    preMatched
      ? `- heuristic-matched client: ${preMatched} (via domain)`
      : '- no heuristic client match',
    '',
    `## Full thread (chronological)`,
    stored.flattened || '(empty)',
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
        description: 'Emit the structured scorecard signals for this email thread.',
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
    throw new Error(`No tool_use in Claude response for thread ${stored.thread.dedupKey}`);
  }

  const parsed = extractionZod.parse(toolUse.input);

  const matchedVia: Extraction['matchedVia'] = preMatched
    ? 'domain'
    : parsed.clientId
      ? 'llm'
      : 'none';

  const scores: Partial<Record<FathomScorableDimension, RubricScore | null>> = {
    'client-happiness': normalizeScore(parsed.clientHappinessScore),
    'execution-discipline': normalizeScore(parsed.executionDisciplineScore),
    'internal-momentum': normalizeScore(parsed.internalMomentumScore),
  };

  return {
    source: 'gmail',
    recordingId: syntheticRecordingId(stored.thread.dedupKey),
    meetingTitle: stored.thread.subject,
    meetingDate: stored.thread.latestDate, // attribute to the most recent message
    clientId: preMatched ?? parsed.clientId,
    matchedVia,
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
