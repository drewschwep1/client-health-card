#!/usr/bin/env tsx
// Offline Gmail sync + extraction. Runs via `npm run gmail:sync`. Iterates
// SEARCHTIDES_MAILBOXES (via service-account DWD) OR falls back to a single
// user-OAuth mailbox if no service account is configured. Runs Claude
// extraction on client-domain threads and rebuilds the manifest at
// public/data/fathom/signals.json.

import {
  CLIENT_EMAIL_DOMAINS,
  SEARCHTIDES_MAILBOXES,
  type ClientId,
} from '../src/lib/constants';
import { fetchThread, listThreadIds, hasServiceAccountAuth } from '../src/lib/gmail/client';
import {
  saveThread,
  saveUnmatchedThread,
  saveExtraction,
  loadState,
  saveState,
  hasThread,
  type StoredThread,
} from '../src/lib/gmail/store';
import { extractFromThread, flattenThread } from '../src/lib/gmail/extract';
import { shouldExcludeThread } from '../src/lib/gmail/filter';
import { writeManifest as writeSharedManifest } from '../src/lib/manifest';

function buildQueryForClient(domains: readonly string[]): string {
  // (from:@d1 OR to:@d1 OR cc:@d1 OR from:@d2 …) newer_than:30d
  const parts = domains.flatMap(d => [`from:@${d}`, `to:@${d}`, `cc:@${d}`]);
  return `(${parts.join(' OR ')}) newer_than:30d`;
}

async function ingestForMailbox(
  mailbox: string | undefined,
  seenKeys: Set<string>
): Promise<{
  fetched: number;
  extracted: number;
  excluded: number;
  unmatched: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let fetched = 0;
  let extracted = 0;
  let excluded = 0;
  let unmatched = 0;

  const mailboxLabel = mailbox ?? '(user-oauth)';

  for (const [clientId, domains] of Object.entries(CLIENT_EMAIL_DOMAINS) as Array<
    [ClientId, readonly string[]]
  >) {
    if (!domains?.length) continue;
    const query = buildQueryForClient(domains);
    console.log(`\n[${mailboxLabel}] # ${clientId}  (${query})`);

    try {
      for await (const threadIds of listThreadIds(query, mailbox)) {
        for (const tid of threadIds) {
          try {
            const thread = await fetchThread(tid, mailbox);
            if (seenKeys.has(thread.dedupKey) || (await hasThread(thread.dedupKey))) {
              console.log(`  . dup skip: ${thread.subject.slice(0, 50)}`);
              seenKeys.add(thread.dedupKey);
              continue;
            }

            const filter = shouldExcludeThread(thread);
            const stored: StoredThread = {
              thread,
              flattened: flattenThread(thread),
              fetchedAt: new Date().toISOString(),
            };

            if (filter.exclude) {
              if (filter.reason?.startsWith('no known client-domain')) {
                await saveUnmatchedThread(stored);
                unmatched++;
                console.log(`  ? unmatched: ${thread.subject.slice(0, 50)}`);
              } else {
                excluded++;
                console.log(`  ⊘ filter skip: ${thread.subject.slice(0, 50)} (${filter.reason})`);
              }
              seenKeys.add(thread.dedupKey);
              continue;
            }

            await saveThread(stored);
            fetched++;
            console.log(`  → ${thread.subject.slice(0, 60)} (${thread.messages.length} msgs)`);

            const extraction = await extractFromThread(stored);
            await saveExtraction(thread.dedupKey, extraction);
            extracted++;
            console.log(
              `      extracted: client=${extraction.clientId ?? '(none)'} via=${extraction.matchedVia} ` +
                `wins=${extraction.weeklyWins.length} concerns=${extraction.concerns.length}`
            );
            seenKeys.add(thread.dedupKey);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`[${mailboxLabel}] thread ${tid}: ${msg}`);
            console.error(`      ERROR (thread ${tid}): ${msg}`);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${mailboxLabel}] client ${clientId}: ${msg}`);
      console.error(`  CLIENT ERROR: ${msg}`);
    }
  }

  return { fetched, extracted, excluded, unmatched, errors };
}

async function ingest(): Promise<{
  fetched: number;
  extracted: number;
  excluded: number;
  unmatched: number;
  errors: string[];
}> {
  const state = await loadState();
  const seenKeys = new Set<string>(state.seenDedupKeys);

  const useServiceAccount = hasServiceAccountAuth();
  // CLI: --mailbox <email> narrows iteration to one mailbox. Useful for
  // retrying a single user after fixing a wrong address.
  const mailboxFlagIdx = process.argv.indexOf('--mailbox');
  const mailboxOverride =
    mailboxFlagIdx >= 0 ? process.argv[mailboxFlagIdx + 1] : undefined;
  const mailboxes: (string | undefined)[] = useServiceAccount
    ? mailboxOverride
      ? [mailboxOverride]
      : Array.from(SEARCHTIDES_MAILBOXES)
    : [undefined]; // fallback to single-user OAuth (mailbox = whoever authorized)

  console.log(
    useServiceAccount
      ? `\nauth: service-account DWD · iterating ${mailboxes.length} mailboxes`
      : `\nauth: user-oauth · single mailbox (pre-DWD mode)`
  );

  let totals = { fetched: 0, extracted: 0, excluded: 0, unmatched: 0, errors: [] as string[] };

  for (const mb of mailboxes) {
    try {
      const r = await ingestForMailbox(mb, seenKeys);
      totals.fetched += r.fetched;
      totals.extracted += r.extracted;
      totals.excluded += r.excluded;
      totals.unmatched += r.unmatched;
      totals.errors.push(...r.errors);
      if (mb) state.lastPollByClient[mb] = new Date().toISOString();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      totals.errors.push(`mailbox ${mb ?? '(user-oauth)'}: ${msg}`);
      console.error(`MAILBOX ERROR (${mb}): ${msg}`);
    }
  }

  state.seenDedupKeys = Array.from(seenKeys);
  await saveState(state);

  return totals;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — check .env.local');
    process.exit(1);
  }

  const useServiceAccount = hasServiceAccountAuth();

  if (!useServiceAccount) {
    // User-OAuth fallback mode: same env-var guards as before.
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      console.error(
        'Missing auth. Either set GOOGLE_SERVICE_ACCOUNT_KEY_PATH for multi-mailbox mode, OR set GOOGLE_OAUTH_CLIENT_ID/SECRET and GOOGLE_OAUTH_REFRESH_TOKEN for single-mailbox mode.'
      );
      process.exit(1);
    }
    if (!process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
      console.error('GOOGLE_OAUTH_REFRESH_TOKEN not set — run `npm run gmail:auth` first');
      process.exit(1);
    }
  }

  const manifestOnly = process.argv.includes('--manifest-only');

  console.log(`== Gmail sync ${manifestOnly ? '(manifest only)' : ''} ==`);
  const start = Date.now();
  const allErrors: string[] = [];

  if (!manifestOnly) {
    const { fetched, extracted, excluded, unmatched, errors } = await ingest();
    console.log(
      `\n== ingest done: ${fetched} threads, ${extracted} extracted, ${excluded} filtered, ${unmatched} unmatched, ${errors.length} errors ==`
    );
    allErrors.push(...errors);
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
