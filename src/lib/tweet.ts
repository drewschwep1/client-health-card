import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CLIENTS, type ClientId } from './constants';
import type { ClientSignals } from './fathom/rollup';
import type { ProfoundClientSignal } from './profound/rollup';

const CACHE_DIR = path.join(process.cwd(), 'data', 'tweets');
const MODEL = 'claude-sonnet-4-6';

// Cache version — bump when the summary shape or prompt changes so stale
// caches get regenerated instead of silently reused.
const CACHE_VERSION = 3;

export interface WeekSummary {
  tweet: string; // one-sentence recap (the original "week in a tweet")
  topWin: string | null; // single biggest win, one bullet. null if nothing meaningful.
  topRisk: string | null; // single biggest risk/concern, one bullet. null if nothing.
}

interface CachedSummary extends WeekSummary {
  _v: number;
}

function filePath(clientId: ClientId, weekStart: string): string {
  return path.join(CACHE_DIR, `${clientId}-${weekStart}.json`);
}

async function loadCached(
  clientId: ClientId,
  weekStart: string
): Promise<WeekSummary | null> {
  try {
    const raw = await fs.readFile(filePath(clientId, weekStart), 'utf-8');
    const parsed = JSON.parse(raw) as CachedSummary;
    if (parsed._v !== CACHE_VERSION) return null;
    return { tweet: parsed.tweet, topWin: parsed.topWin, topRisk: parsed.topRisk };
  } catch {
    return null;
  }
}

async function saveCached(
  clientId: ClientId,
  weekStart: string,
  summary: WeekSummary
): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const payload: CachedSummary = { _v: CACHE_VERSION, ...summary };
  await fs.writeFile(filePath(clientId, weekStart), JSON.stringify(payload, null, 2));
}

function clientName(clientId: ClientId): string {
  return CLIENTS.find(c => c.id === clientId)?.name ?? clientId;
}

const SYSTEM_PROMPT = `You write weekly client-health summaries for SearchTides. Each summary has three parts:

1. **tweet** — one sentence, max 160 characters, capturing what defined the week. Plain declarative, no hashtags or hype. Concrete over vague: name budget numbers, KPI deltas, specific statements. If the week was quiet, say so honestly.

2. **topWin** — the SINGLE biggest win of the week, as one bullet. Pick the most material positive outcome — budget approved, KPI hit, client praise, scope expansion, content landed with impact. Phrase it as a terse bullet (≤140 chars). If the week has no meaningful win, return null. Do not pad with soft "wins."

3. **topRisk** — the SINGLE biggest risk or concern of the week, as one bullet. Pick the thing most likely to hurt the relationship or results if left alone — missed deliverable, unresolved complaint, stalled pipeline, client frustration, overdue invoice, unaddressed drop in AI visibility. Phrase as a terse bullet (≤140 chars). If there is no meaningful risk, return null.

Rules:
- Never invent facts. If the data doesn't support a field, return null for that field.
- Tone: internal account-lead note, not marketing copy.
- No emoji, no hashtags, no "great" / "amazing" / "solid."
- Be specific: "NinjaCard budget approved from $2.8k to $5k/mo" beats "budget expanded."

ABSOLUTE PROHIBITION — NEVER mention SearchTides' own business state in any field:
- No references to SearchTides' revenue, break-even, profitability, financial runway.
- No references to SearchTides' hiring, team growth, staffing, or internal dynamics.
- No references to SearchTides' sales pipeline, renewal risk (as it affects SearchTides), or commercial strategy.
- No phrasing like "this would push SearchTides past break-even" or "SearchTides' best revenue year" or "SearchTides near X".
- A client winning or losing is about THE CLIENT, not about what it means for SearchTides internally.
- Even for the SearchTides tile itself, discuss only SearchTides' AI visibility (share of voice, citations, sentiment) — never SearchTides' business.`;

function buildUserContext(
  clientId: ClientId,
  weekStart: string,
  fathom: ClientSignals,
  profound: ProfoundClientSignal | null,
  partialHealth: number | null
): string {
  const sections: string[] = [];

  sections.push(`Client: ${clientName(clientId)}`);
  sections.push(`Week of: ${weekStart}`);
  sections.push(`Partial health: ${partialHealth ?? '(no score)'}`);
  sections.push('');

  if (fathom.meetingCount > 0) {
    sections.push(`## Fathom meetings this week (${fathom.meetingCount})`);
    for (const m of fathom.meetings) sections.push(`- ${m.title}`);
    sections.push('');

    if (fathom.weeklyWins.length) {
      sections.push('## Wins (source material — pick the single biggest)');
      fathom.weeklyWins.forEach(w => sections.push(`- ${w}`));
      sections.push('');
    }
    if (fathom.concerns.length) {
      sections.push('## Concerns (source material — pick the single biggest)');
      fathom.concerns.forEach(c => sections.push(`- ${c}`));
      sections.push('');
    }
    if (fathom.proactivitySignals.length) {
      sections.push('## Proactivity (SearchTides being proactive — context, usually not wins themselves)');
      fathom.proactivitySignals.forEach(p => sections.push(`- ${p}`));
      sections.push('');
    }
  } else {
    sections.push('## Fathom: no client calls this week.');
    sections.push('');
  }

  if (profound) {
    const s = profound.snapshot;
    const wow = profound.wow;
    const fmt = (v: number | null) => (v === null ? '-' : v.toFixed(1));
    const delta = (v: number | null, suffix = '') =>
      v === null ? '' : ` (${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix} WoW)`;
    sections.push('## Profound (AI visibility, non-branded)');
    sections.push(
      `- Share of voice: ${fmt(s.shareOfVoice)}%${delta(wow.shareOfVoice, 'pp')}`
    );
    sections.push(
      `- Citation share: ${fmt(s.citationShare)}%${delta(wow.citationShare, 'pp')}`
    );
    sections.push(
      `- Visibility score: ${fmt(s.visibilityScore)}${delta(wow.visibilityScore)}`
    );
    if (s.sentimentPositive !== null || s.sentimentNegative !== null) {
      sections.push(
        `- Sentiment: ${s.sentimentPositive ?? 0} positive / ${s.sentimentNegative ?? 0} negative mentions`
      );
    }
    sections.push('');
  } else {
    sections.push('## Profound: not tracked or no data this week.');
    sections.push('');
  }

  sections.push('Emit the structured summary now.');
  return sections.join('\n');
}

const summarySchema = {
  type: 'object' as const,
  properties: {
    tweet: {
      type: 'string' as const,
      description:
        'One sentence, max 160 characters, capturing what defined the week. Plain declarative, no hype.',
    },
    topWin: {
      type: ['string', 'null'] as ('string' | 'null')[],
      description:
        'SINGLE biggest win this week, as a terse bullet (≤140 chars). null if no meaningful win.',
    },
    topRisk: {
      type: ['string', 'null'] as ('string' | 'null')[],
      description:
        'SINGLE biggest risk/concern this week, as a terse bullet (≤140 chars). null if no meaningful risk.',
    },
  },
  required: ['tweet', 'topWin', 'topRisk'],
};

export async function generateWeekSummary(
  clientId: ClientId,
  weekStart: string,
  fathom: ClientSignals,
  profound: ProfoundClientSignal | null,
  partialHealth: number | null
): Promise<WeekSummary | null> {
  const hasAnySignal =
    fathom.meetingCount > 0 ||
    profound !== null ||
    fathom.weeklyWins.length > 0 ||
    fathom.concerns.length > 0;
  if (!hasAnySignal) return null;

  const cached = await loadCached(clientId, weekStart);
  if (cached) return cached;

  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [
      {
        name: 'emit_week_summary',
        description: 'Emit the three-part weekly summary for this client.',
        input_schema: summarySchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_week_summary' },
    messages: [
      {
        role: 'user',
        content: buildUserContext(clientId, weekStart, fathom, profound, partialHealth),
      },
    ],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return null;

  const raw = toolUse.input as { tweet?: unknown; topWin?: unknown; topRisk?: unknown };
  const summary: WeekSummary = {
    tweet: typeof raw.tweet === 'string' ? raw.tweet.trim() : '',
    topWin: typeof raw.topWin === 'string' && raw.topWin.trim() ? raw.topWin.trim() : null,
    topRisk:
      typeof raw.topRisk === 'string' && raw.topRisk.trim() ? raw.topRisk.trim() : null,
  };
  if (!summary.tweet) return null;

  await saveCached(clientId, weekStart, summary);
  return summary;
}
