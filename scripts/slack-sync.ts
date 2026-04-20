#!/usr/bin/env tsx
// Offline Slack sync + extraction. Runs via `npm run slack:sync`. Enumerates
// channels the bot is a member of, fetches the last 30 days of messages +
// thread replies, buckets into channel × week, runs Claude extraction per
// bucket, and rebuilds the manifest at public/data/fathom/signals.json.

import { startOfWeek, format, subWeeks } from 'date-fns';
import { DOMAIN_TO_CLIENT, CLIENT_SLACK_CHANNELS, type ClientId } from '../src/lib/constants';
import { listChannels, fetchMessages } from '../src/lib/slack/client';
import {
  saveChannelWeek,
  saveUnmatchedChannel,
  saveExtraction,
  hasExtraction,
  loadState,
  saveState,
  type StoredChannelWeek,
} from '../src/lib/slack/store';
import { extractFromChannelWeek, flattenChannelWeek } from '../src/lib/slack/extract';
import { shouldExcludeChannelWeek } from '../src/lib/slack/filter';
import type { SlackChannel, SlackChannelWeek, SlackMessage } from '../src/lib/slack/types';
import { writeManifest as writeSharedManifest } from '../src/lib/manifest';

const LOOKBACK_DAYS = 30;

function weekIso(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function daysAgoTs(days: number): string {
  // Slack API `oldest` is a string "seconds.microseconds" — we only need
  // seconds-level precision for a 30-day window.
  return Math.floor((Date.now() - days * 86400 * 1000) / 1000).toFixed(6);
}

function channelToClient(channel: SlackChannel): ClientId | null {
  // Explicit map first.
  for (const [cid, names] of Object.entries(CLIENT_SLACK_CHANNELS) as Array<
    [ClientId, readonly string[]]
  >) {
    if (names?.some(n => n.toLowerCase() === channel.name.toLowerCase())) {
      return cid;
    }
  }
  // Heuristic: any external member domain → client.
  for (const email of channel.memberEmails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || domain === 'searchtides.com') continue;
    if (DOMAIN_TO_CLIENT[domain]) return DOMAIN_TO_CLIENT[domain];
  }
  return null;
}

function bucketByWeek(
  channel: SlackChannel,
  messages: SlackMessage[]
): SlackChannelWeek[] {
  const byWeek = new Map<string, SlackMessage[]>();
  for (const m of messages) {
    const wk = weekIso(new Date(m.date));
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(m);
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, msgs]) => {
      const sorted = msgs.sort((a, b) => a.ts.localeCompare(b.ts));
      const participantIds = Array.from(new Set(sorted.map(m => m.userId)));
      const participantEmails = Array.from(
        new Set(
          sorted
            .map(m => m.userEmail)
            .filter((e): e is string => Boolean(e))
            .map(e => e.toLowerCase())
        )
      );
      return {
        channel,
        weekStart,
        messages: sorted,
        participantIds,
        participantEmails,
      };
    });
}

async function ingest(opts: { force: boolean }): Promise<{
  weeksExtracted: number;
  weeksExcluded: number;
  weeksSkippedExisting: number;
  channelsUnmatched: number;
  channelsMatched: number;
  errors: string[];
}> {
  const state = await loadState();
  const errors: string[] = [];
  let weeksExtracted = 0;
  let weeksExcluded = 0;
  let weeksSkippedExisting = 0;
  let channelsUnmatched = 0;
  let channelsMatched = 0;

  console.log('\nenumerating channels the bot is a member of…');
  const channels = await listChannels();
  console.log(`  ${channels.length} channels found`);

  const oldestTs = daysAgoTs(LOOKBACK_DAYS);

  for (const ch of channels) {
    const clientId = channelToClient(ch);
    const isUnmapped = !clientId;

    if (isUnmapped) {
      await saveUnmatchedChannel(ch);
      channelsUnmatched++;
      console.log(`\n# #${ch.name} → (content-routed — Claude infers client per week)`);
    } else {
      channelsMatched++;
      console.log(`\n# #${ch.name} → ${clientId}`);
    }

    try {
      const messages = await fetchMessages(ch.id, oldestTs);
      console.log(`  fetched ${messages.length} messages`);
      const weeks = bucketByWeek(ch, messages);

      for (const w of weeks) {
        const filter = shouldExcludeChannelWeek(w, { allowInternalOnly: isUnmapped });
        const stored: StoredChannelWeek = {
          channelWeek: w,
          flattened: '',
          fetchedAt: new Date().toISOString(),
        };
        stored.flattened = flattenChannelWeek(stored);

        if (filter.exclude) {
          weeksExcluded++;
          console.log(`  ⊘ skip week ${w.weekStart}: ${filter.reason}`);
          continue;
        }

        if (!opts.force && (await hasExtraction(ch.id, w.weekStart))) {
          weeksSkippedExisting++;
          console.log(`  . dedup: ${w.weekStart} already extracted (--force to re-run)`);
          continue;
        }

        await saveChannelWeek(stored);
        try {
          const extraction = await extractFromChannelWeek(stored);
          await saveExtraction(ch.id, w.weekStart, extraction);
          weeksExtracted++;
          console.log(
            `  → week ${w.weekStart}: ${w.messages.length} msgs · extracted client=${extraction.clientId ?? '(none)'} ` +
              `wins=${extraction.weeklyWins.length} concerns=${extraction.concerns.length}`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`#${ch.name} ${w.weekStart}: ${msg}`);
          console.error(`      ERROR: ${msg}`);
        }
      }
      state.lastPollByChannel[ch.id] = new Date().toISOString();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`channel #${ch.name}: ${msg}`);
      console.error(`  CHANNEL ERROR: ${msg}`);
    }
  }

  await saveState(state);
  return { weeksExtracted, weeksExcluded, weeksSkippedExisting, channelsUnmatched, channelsMatched, errors };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — check .env.local');
    process.exit(1);
  }
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('SLACK_BOT_TOKEN not set — check .env.local');
    process.exit(1);
  }

  const manifestOnly = process.argv.includes('--manifest-only');
  const force = process.argv.includes('--force');
  console.log(`== Slack sync ${manifestOnly ? '(manifest only)' : force ? '(force re-extract)' : ''} ==`);
  const start = Date.now();
  const allErrors: string[] = [];

  if (!manifestOnly) {
    const r = await ingest({ force });
    console.log(
      `\n== ingest done: ${r.channelsMatched} matched channels, ${r.weeksExtracted} weeks extracted, ` +
        `${r.weeksSkippedExisting} weeks dedup-skipped, ${r.weeksExcluded} weeks filtered, ` +
        `${r.channelsUnmatched} unmatched channels, ${r.errors.length} errors ==`
    );
    allErrors.push(...r.errors);
  }

  console.log('\n== building manifest ==');
  const { clientsWithData, path: manifestPath } = await writeSharedManifest();
  console.log(`manifest: ${manifestPath}  (${clientsWithData} clients with data)`);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✓ done in ${elapsed}s`);
  if (allErrors.length) {
    console.log('\nErrors:');
    allErrors.forEach(e => console.log('  -', e));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
