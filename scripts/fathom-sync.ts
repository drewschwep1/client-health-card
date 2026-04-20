#!/usr/bin/env tsx
// Offline Fathom sync + extraction. Runs via `npm run fathom:sync` or as a
// scheduled GitHub Action. Writes rolled-up signals to public/data/ so the
// static-exported Next.js app can fetch them client-side.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { FATHOM_TEAMS } from '../src/lib/constants';
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
import { shouldExcludeMeeting } from '../src/lib/fathom/filter';
import { loadMeeting, listAllExtractions } from '../src/lib/fathom/store';
import { writeManifest as writeSharedManifest } from '../src/lib/manifest';

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
  const fathomOnly = all.filter(e => (e.source ?? 'fathom') === 'fathom');
  const excluded = new Set<number>();
  let checked = 0;
  for (const e of fathomOnly) {
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
  const excluded = await buildExcludedRecordingIds();
  const { clientsWithData, path: manifestPath } = await writeSharedManifest({
    excludeRecordingIds: excluded,
  });
  console.log(`\nmanifest: ${manifestPath}  (${clientsWithData} clients with data)`);
}

async function reExtractStored(): Promise<{ done: number; errors: string[] }> {
  // Re-run Claude extraction on every already-stored meeting. Used when the
  // extraction schema or prompt changes — skips the Fathom fetch, just
  // re-runs the LLM against the local transcript. Filtered (1:1) meetings
  // still get their files regenerated; the manifest-time filter drops them
  // from the final rollup either way.
  const files = await fs.readdir(path.join(process.cwd(), 'data', 'fathom', 'meetings'));
  const meetingFiles = files.filter(f => f.endsWith('.json'));
  console.log(`\n== re-extraction: ${meetingFiles.length} stored meetings ==`);

  let done = 0;
  const errors: string[] = [];

  for (const f of meetingFiles) {
    const rid = Number(f.replace('.json', ''));
    const stored = await loadMeeting(rid);
    if (!stored) continue;

    try {
      const extraction = await extractFromMeeting(stored);
      await saveExtraction(rid, extraction);
      done++;

      const s = extraction.scores;
      console.log(
        `  [${done}/${meetingFiles.length}] rid=${rid} client=${extraction.clientId ?? '(none)'} ` +
          `CH=${s['client-happiness'] ?? '-'} ED=${s['execution-discipline'] ?? '-'} IM=${s['internal-momentum'] ?? '-'} ` +
          `· ${stored.meeting.title.slice(0, 40)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`rid ${rid}: ${msg}`);
      console.error(`  rid=${rid} ERROR: ${msg}`);
    }
  }

  return { done, errors };
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

  const reExtract = process.argv.includes('--re-extract');
  const manifestOnly = process.argv.includes('--manifest-only');

  console.log(`== Fathom sync ${reExtract ? '(re-extract mode)' : manifestOnly ? '(manifest only)' : ''} ==`);
  const start = Date.now();
  const allErrors: string[] = [];

  if (reExtract) {
    const { done, errors } = await reExtractStored();
    console.log(`\n== re-extraction done: ${done} meetings, ${errors.length} errors ==`);
    allErrors.push(...errors);
  } else if (!manifestOnly) {
    const { ingested, extracted, errors } = await ingest();
    console.log(
      `\n== ingest done: ${ingested} new meetings, ${extracted} extracted, ${errors.length} errors ==`
    );
    allErrors.push(...errors);
  }

  console.log('\n== building manifest ==');
  await writeManifest();

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
