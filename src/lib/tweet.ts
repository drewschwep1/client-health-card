import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CLIENTS, type ClientId } from './constants';
import type { ClientSignals } from './fathom/rollup';
import type { ProfoundClientSignal } from './profound/rollup';

const TWEET_DIR = path.join(process.cwd(), 'data', 'tweets');
const MODEL = 'claude-sonnet-4-6';

function filePath(clientId: ClientId, weekStart: string): string {
  return path.join(TWEET_DIR, `${clientId}-${weekStart}.txt`);
}

async function loadCached(clientId: ClientId, weekStart: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath(clientId, weekStart), 'utf-8');
    return raw.trim() || null;
  } catch {
    return null;
  }
}

async function saveCached(
  clientId: ClientId,
  weekStart: string,
  tweet: string
): Promise<void> {
  await fs.mkdir(TWEET_DIR, { recursive: true });
  await fs.writeFile(filePath(clientId, weekStart), tweet);
}

function clientName(clientId: ClientId): string {
  return CLIENTS.find(c => c.id === clientId)?.name ?? clientId;
}

const SYSTEM_PROMPT = `You write one-sentence "week in a tweet" summaries for SearchTides' client health card. The sentence captures what defined this week for this client — what moved, what mattered.

Rules:
- ONE sentence, max 160 characters.
- No hashtags, no emoji, no hype adjectives ("amazing", "great"). Plain declarative.
- Concrete over vague: name the budget number, the KPI delta, the specific client statement. Not "things went well."
- If the week was quiet (no wins, no concerns), say that honestly: "Quiet week, no new calls or signal movement."
- Never invent facts. If the data is thin, the sentence should be thin.
- Tone: internal business note, not marketing copy. You are summarizing for the account lead, not the client.`;

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
      sections.push('## Wins');
      fathom.weeklyWins.forEach(w => sections.push(`- ${w}`));
      sections.push('');
    }
    if (fathom.concerns.length) {
      sections.push('## Concerns');
      fathom.concerns.forEach(c => sections.push(`- ${c}`));
      sections.push('');
    }
    if (fathom.proactivitySignals.length) {
      sections.push('## Proactivity (SearchTides side)');
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
    sections.push('## Profound (AI visibility, non-branded)');
    const fmt = (v: number | null) => (v === null ? '-' : v.toFixed(1));
    const delta = (v: number | null, suffix = '') =>
      v === null
        ? ''
        : ` (${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix} WoW)`;
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

  sections.push('Write the one-sentence week-in-a-tweet now.');
  return sections.join('\n');
}

export async function generateWeekInATweet(
  clientId: ClientId,
  weekStart: string,
  fathom: ClientSignals,
  profound: ProfoundClientSignal | null,
  partialHealth: number | null
): Promise<string | null> {
  // Don't tweet empty weeks.
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
    max_tokens: 300,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: buildUserContext(clientId, weekStart, fathom, profound, partialHealth),
      },
    ],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('')
    .trim()
    .replace(/^["']|["']$/g, ''); // strip leading/trailing quotes if Claude adds them

  if (!text) return null;
  await saveCached(clientId, weekStart, text);
  return text;
}
