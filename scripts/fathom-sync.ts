#!/usr/bin/env tsx
// Offline Fathom sync + extraction. Runs via `npm run fathom:sync` or as a
// scheduled GitHub Action. Writes rolled-up signals to public/data/ so the
// static-exported Next.js app can fetch them client-side.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CLIENTS, FATHOM_TEAMS, type ClientId } from '../src/lib/constants';
import { getSummary, getTranscript, listMeetings } from '../src/lib/fathom/client';
import {
  listStoredMeetingKeys,
  loadState,
  saveExtraction,
  saveMeeting,
  saveState,
  type StoredMeeting,
} from '../src/lib/fathom/store';
import { extractFromMeeting } from '../src/lib/fathom/extract';
import type { FathomTranscriptLine } from '../src/lib/fathom/types';
import { getClientSignals } from '../src/lib/fathom/rollup';
import { shouldExcludeMeeting } from '../src/lib/fathom/filter';
import { loadMeeting, listAllExtractions } from '../src/lib/fathom/store';
import { startOfWeek, format, subWeeks } from 'date-fns';

const PUBLIC_MANIFEST = path.join(process.cwd(), 'public', 'data', 'fathom', 'signals.json');

function flattenTranscript(lines: FathomTranscriptLine[]): string {
  return lines
    .map(l => `[${l.timestamp}] ${l.speaker.display_name}: ${l.text}`)
    .join('\n');
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function weekIso(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

async function ingest(): Promise<{ ingested: number; extracted: number; errors: string[] }> {
  const state = await loadState();
  const seen = await listStoredMeetingKeys();
  const runSeen = new Set<string>(seen);
  let ingested = 0;
  let extracted = 0;
  const errors: string[] = [];

  for (const team of FATHOM_TEAMS) {
    const since = state.lastPollByTeam[team] ?? isoDaysAgo(30);
    console.log(`\n# ${team} (since ${since})`);

    try {
      for await (const page of listMeetings({ team, createdAfter: since })) {
        for (const meeting of page) {
          const key = `${meeting.title}|${meeting.scheduled_start_time}`;
          if (runSeen.has(key)) {
            console.log(`  . dup skip: ${meeting.title.slice(0, 50)}`);
            continue;
          }
          runSeen.add(key);

          const filter = shouldExcludeMeeting(meeting);
          if (filter.exclude) {
            console.log(`  ⊘ filter skip: ${meeting.title.slice(0, 50)} (${filter.reason})`);
            continue;
          }

          try {
            console.log(`  → ${meeting.title.slice(0, 60)} (rid=${meeting.recording_id})`);
            const [transcript, summary] = await Promise.all([
              getTranscript(meeting.recording_id),
              getSummary(meeting.recording_id),
            ]);

            const stored: StoredMeeting = {
              meeting,
              transcript: flattenTranscript(transcript.transcript),
              summaryMarkdown: summary.summary.markdown_formatted,
              fetchedAt: new Date().toISOString(),
            };
            await saveMeeting(stored);
            ingested++;

            const extraction = await extractFromMeeting(stored);
            await saveExtraction(meeting.recording_id, extraction);
            extracted++;
            console.log(
              `      extracted: client=${extraction.clientId ?? '(none)'} via=${extraction.matchedVia} ` +
                `wins=${extraction.weeklyWins.length} concerns=${extraction.concerns.length}`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`rid ${meeting.recording_id}: ${msg}`);
            console.error(`      ERROR: ${msg}`);
          }
        }
      }

      state.lastPollByTeam[team] = new Date().toISOString();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`team ${team}: ${msg}`);
      console.error(`  TEAM ERROR: ${msg}`);
    }
  }

  await saveState(state);
  return { ingested, extracted, errors };
}

async function buildExcludedRecordingIds(): Promise<Set<number>> {
  // Apply the Drew/Derek 1:1 filter at manifest time so the rule can change
  // without re-extracting transcripts. Already-extracted meetings that now
  // match the filter just get dropped from the manifest.
  const all = await listAllExtractions();
  const excluded = new Set<number>();
  let checked = 0;
  for (const e of all) {
    checked++;
    const stored = await loadMeeting(e.recordingId);
    if (!stored) continue;
    const filter = shouldExcludeMeeting(stored.meeting);
    if (filter.exclude) {
      excluded.add(e.recordingId);
    }
  }
  console.log(`  filter: excluded ${excluded.size} of ${checked} extractions (1:1 rule)`);
  return excluded;
}

async function writeManifest(): Promise<void> {
  // Roll up the last 8 weeks per client — plenty of history for the UI,
  // small enough to ship as a static JSON.
  const weeks = Array.from({ length: 8 }, (_, i) => weekIso(subWeeks(new Date(), i)));
  const excluded = await buildExcludedRecordingIds();
  const manifest: {
    generatedAt: string;
    clients: Record<string, Record<string, unknown>>;
  } = {
    generatedAt: new Date().toISOString(),
    clients: {},
  };

  for (const c of CLIENTS) {
    const perWeek: Record<string, unknown> = {};
    for (const week of weeks) {
      const signals = await getClientSignals(c.id as ClientId, week, {
        excludeRecordingIds: excluded,
      });
      if (signals.meetingCount > 0) perWeek[week] = signals;
    }
    if (Object.keys(perWeek).length > 0) manifest.clients[c.id] = perWeek;
  }

  await fs.mkdir(path.dirname(PUBLIC_MANIFEST), { recursive: true });
  await fs.writeFile(PUBLIC_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(
    `\nmanifest: ${PUBLIC_MANIFEST}  (${Object.keys(manifest.clients).length} clients with data)`
  );
}

async function main(): Promise<void> {
  if (!process.env.FATHOM_API_KEY) {
    console.error('FATHOM_API_KEY not set — check .env.local');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — check .env.local');
    process.exit(1);
  }

  console.log('== Fathom sync ==');
  const start = Date.now();
  const { ingested, extracted, errors } = await ingest();
  console.log(`\n== ingest done: ${ingested} new meetings, ${extracted} extracted, ${errors.length} errors ==`);

  console.log('\n== building manifest ==');
  await writeManifest();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✓ done in ${elapsed}s`);
  if (errors.length) {
    console.log('\nErrors:');
    errors.forEach(e => console.log('  -', e));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
