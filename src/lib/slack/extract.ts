import Anthropic from '@anthropic-ai/sdk';
import { DOMAIN_TO_CLIENT, CLIENT_SLACK_CHANNELS, type ClientId } from '../constants';
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
import { keepMessage } from './filter';
import type { StoredChannelWeek } from './store';
import { syntheticRecordingId } from './store';

// Flatten a channel-week's messages to an LLM-ready chronological dump.
// One block per message — handle used in place of slack user IDs for
// readability. Thread replies are indented.
export function flattenChannelWeek(stored: StoredChannelWeek): string {
  const { channel, weekStart, messages } = stored.channelWeek;
  const kept = messages.filter(keepMessage);
  const lines: string[] = [
    `# #${channel.name} — week of ${weekStart}`,
    `# participants: ${stored.channelWeek.participantEmails.join(', ') || '(unknown)'}`,
    '',
  ];
  for (const m of kept) {
    const prefix = m.threadTs && m.threadTs !== m.ts ? '    └─ ' : '';
    lines.push(`${prefix}[${m.date}] @${m.userName}: ${m.text.trim()}`);
  }
  return lines.join('\n');
}

function clientFromChannel(
  channelName: string,
  memberEmails: readonly string[]
): ClientId | null {
  // Explicit map wins. Match on exact channel name or any listed alias.
  for (const [cid, names] of Object.entries(CLIENT_SLACK_CHANNELS) as Array<
    [ClientId, readonly string[]]
  >) {
    if (!names?.length) continue;
    if (names.some(n => n.toLowerCase() === channelName.toLowerCase())) {
      return cid;
    }
  }
  // Fallback: inspect member emails, match the first external domain.
  for (const addr of memberEmails) {
    const domain = addr.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    if (domain === 'searchtides.com') continue;
    if (DOMAIN_TO_CLIENT[domain]) return DOMAIN_TO_CLIENT[domain];
  }
  return null;
}

const SYSTEM_PROMPT = `You read a week of SearchTides ↔ client Slack conversation and produce structured signals for our automated Client Health Card. Output is consumed by software, not humans — accuracy and restraint matter more than completeness. If the week doesn't support a score, return 0 for that dimension. Never fabricate.

Score three dimensions (client-happiness, execution-discipline, internal-momentum) per the rubric. Do NOT attempt to score results-delivered or capacity-fit.

## Cross-client attribution (IMPORTANT)

Each item in weeklyWins / concerns / proactivitySignals / rawEvidence has an optional \`clientId\` field. A single week in a channel can mention multiple clients — use \`clientId\` to route each item correctly:
- Leave \`clientId\` null for items about the PRIMARY client of this channel-week.
- Set \`clientId\` to a different client's ID when the item is genuinely about that client (e.g., an internal prep channel primarily discussing Mighty Capital where a Greenvelope issue surfaces — tag that concern \`clientId: "greenvelope"\`).

## Rules specific to Slack

- weeklyWins: concrete positive outcomes — client praise, approvals, KPI hits referenced in Slack, scope expansions. Internal-only cheer-leading does NOT count.
- proactivitySignals: evidence of SearchTides being proactive — unprompted updates, flagging risks before the client asked, taking initiative.
- concerns: risk flags — "any update?" / "still waiting on…" from the client, frustration, missed deadlines referenced, unresolved blockers.
- rawEvidence: direct quotes, attributed to the sending user's email (or @handle), tagged with the dimensionId.
- clientId (top-level): pick PRIMARY client. Match external (non-@searchtides.com) participants to the domain map. If internal-only: infer from content — a client name mentioned repeatedly, a project, the \`searchtides\` meta-client for SearchTides' own AI visibility / SEO work. Return null if no single client dominates.
- Slack is often low-signal (one-liners, emoji reactions, logistics). Score 0 generously.`;

export async function extractFromChannelWeek(
  stored: StoredChannelWeek
): Promise<Extraction> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const preMatched = clientFromChannel(
    stored.channelWeek.channel.name,
    stored.channelWeek.channel.memberEmails
  );

  const dynamicBlock = [
    `## Channel-week metadata`,
    `- channel: #${stored.channelWeek.channel.name} (${stored.channelWeek.channel.id})`,
    `- week start (Monday): ${stored.channelWeek.weekStart}`,
    `- participant emails this week: ${stored.channelWeek.participantEmails.join(', ') || '(none resolved)'}`,
    `- message count (after filtering system events): ${
      stored.channelWeek.messages.filter(keepMessage).length
    }`,
    preMatched
      ? `- heuristic-matched client: ${preMatched}`
      : '- no heuristic client match',
    '',
    `## Messages (chronological)`,
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
        description: 'Emit the structured scorecard signals for this channel-week.',
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
      `No tool_use in Claude response for #${stored.channelWeek.channel.name} week ${stored.channelWeek.weekStart}`
    );
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
    source: 'slack',
    recordingId: syntheticRecordingId(
      stored.channelWeek.channel.id,
      stored.channelWeek.weekStart
    ),
    meetingTitle: `#${stored.channelWeek.channel.name}`,
    // Attribute to the midpoint of the week (Wednesday) so it buckets cleanly.
    meetingDate: wednesdayOf(stored.channelWeek.weekStart),
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

function wednesdayOf(weekStartIso: string): string {
  const d = new Date(weekStartIso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 2); // Mon → Wed
  return d.toISOString();
}
