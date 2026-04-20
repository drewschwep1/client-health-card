#!/usr/bin/env tsx
// Pulls per-client Profound metrics (visibility, share-of-voice, citation
// share/count, sentiment) for the last 8 weeks, one snapshot per
// (client, week). Rolls forward idempotently — rerunning the same week
// overwrites the snapshot with fresher data.

import { format, startOfWeek, addDays, subWeeks } from 'date-fns';

import {
  CLIENTS,
  CLIENT_PROFOUND_ASSET,
  type ClientId,
  type ProfoundAssetMapping,
} from '../src/lib/constants';
import {
  listTagsForCategory,
  queryCitations,
  querySentiment,
  queryVisibility,
} from '../src/lib/profound/client';
import { saveSnapshot } from '../src/lib/profound/store';
import type { ProfoundReportRow, ProfoundSnapshot } from '../src/lib/profound/types';

function weekStartIso(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

// Per-category non-branded filter. Cached once per sync run to avoid
// re-fetching tags for every week.
interface TagFilter {
  field: 'tag_name';
  operator: 'is' | 'not_is';
  value: string;
}
const tagFilterCache = new Map<string, TagFilter | null>();

async function getNonBrandedTagFilter(categoryId: string): Promise<TagFilter | null> {
  if (tagFilterCache.has(categoryId)) return tagFilterCache.get(categoryId) ?? null;

  const tags = await listTagsForCategory(categoryId);
  const nonBranded = tags.find(t => t.name.toLowerCase().replace(/[-_\s]/g, '') === 'nonbranded');
  const branded = tags.find(t => t.name.toLowerCase().replace(/[-_\s]/g, '') === 'branded');

  let filter: TagFilter | null = null;
  if (nonBranded) {
    filter = { field: 'tag_name', operator: 'is', value: nonBranded.name };
  } else if (branded) {
    filter = { field: 'tag_name', operator: 'not_is', value: branded.name };
  }
  tagFilterCache.set(categoryId, filter);
  return filter;
}

// Profound reorders the `metrics` array alphabetically in the response.
// Always look up the index via the echoed `info.query.metrics`, not the
// position we asked for.
function metricByName(
  response: { info: { query: unknown }; data: ProfoundReportRow[] } | null,
  name: string
): number | null {
  if (!response) return null;
  const q = response.info.query as { metrics?: string[] } | null | undefined;
  const idx = q?.metrics?.indexOf(name) ?? -1;
  if (idx < 0) return null;
  for (const r of response.data) {
    const v = r.metrics[idx];
    if (typeof v === 'number') return v;
  }
  return null;
}

async function snapshotWeek(
  clientId: ClientId,
  mapping: ProfoundAssetMapping,
  weekStart: string
): Promise<ProfoundSnapshot> {
  const weekEnd = format(addDays(new Date(weekStart), 6), 'yyyy-MM-dd');
  const start = `${weekStart}T00:00:00Z`;
  const end = `${weekEnd}T23:59:59Z`;

  const tagFilter = await getNonBrandedTagFilter(mapping.categoryId);

  // Visibility + Sentiment support `asset_name` with operator `is`.
  const assetNameFilter = [
    { field: 'asset_name', operator: 'is', value: mapping.assetName },
    ...(tagFilter ? [tagFilter] : []),
  ];
  // Citations don't support asset filtering — filter by hostname instead.
  const hostnameFilter = [
    { field: 'root_domain', operator: 'is', value: mapping.assetWebsite },
    ...(tagFilter ? [tagFilter] : []),
  ];

  const [vis, sen, cit] = await Promise.all([
    queryVisibility({
      category_id: mapping.categoryId,
      start_date: start,
      end_date: end,
      metrics: ['visibility_score', 'share_of_voice', 'mentions_count'],
      filters: assetNameFilter,
    }).catch(err => {
      console.error(`    visibility error for ${clientId} ${weekStart}: ${err.message}`);
      return null;
    }),
    querySentiment({
      category_id: mapping.categoryId,
      start_date: start,
      end_date: end,
      metrics: ['positive', 'negative', 'occurrences'],
      filters: assetNameFilter,
    }).catch(err => {
      console.error(`    sentiment error for ${clientId} ${weekStart}: ${err.message}`);
      return null;
    }),
    queryCitations({
      category_id: mapping.categoryId,
      start_date: start,
      end_date: end,
      metrics: ['count', 'citation_share'],
      // Profound requires any filtered field to also be a dimension.
      dimensions: ['root_domain'],
      filters: hostnameFilter,
    }).catch(err => {
      console.error(`    citations error for ${clientId} ${weekStart}: ${err.message}`);
      return null;
    }),
  ]);

  // Profound returns share_of_voice and citation_share as fractions (0-1).
  // Convert to 0-100 percentage for UI consistency.
  const toPercent = (v: number | null) => (v === null ? null : v * 100);

  const snap: ProfoundSnapshot = {
    clientId,
    assetId: mapping.assetId,
    categoryId: mapping.categoryId,
    weekStart,
    weekEnd,
    fetchedAt: new Date().toISOString(),
    visibilityScore: metricByName(vis, 'visibility_score'),
    shareOfVoice: toPercent(metricByName(vis, 'share_of_voice')),
    mentionsCount: metricByName(vis, 'mentions_count'),
    sentimentPositive: metricByName(sen, 'positive'),
    sentimentNegative: metricByName(sen, 'negative'),
    sentimentOccurrences: metricByName(sen, 'occurrences'),
    citationCount: metricByName(cit, 'count'),
    citationShare: toPercent(metricByName(cit, 'citation_share')),
  };

  await saveSnapshot(snap);
  return snap;
}

async function main(): Promise<void> {
  if (!process.env.PROFOUND_API_KEY) {
    console.error('PROFOUND_API_KEY not set — check .env.local');
    process.exit(1);
  }

  // 8 complete weeks back. Skip the current week — Profound rejects
  // date ranges that end today or later.
  const weeks: string[] = [];
  for (let i = 1; i <= 8; i++) {
    weeks.push(weekStartIso(subWeeks(new Date(), i)));
  }
  weeks.reverse();

  const mapped = CLIENTS.filter(c => CLIENT_PROFOUND_ASSET[c.id as ClientId]);
  console.log(`== Profound sync: ${mapped.length} mapped clients × ${weeks.length} weeks ==\n`);

  const start = Date.now();
  let count = 0;
  const errors: string[] = [];

  for (const c of mapped) {
    const mapping = CLIENT_PROFOUND_ASSET[c.id as ClientId]!;
    console.log(`# ${c.name} (category=${mapping.categoryName})`);
    for (const week of weeks) {
      try {
        const snap = await snapshotWeek(c.id as ClientId, mapping, week);
        count++;
        console.log(
          `  ${week}  vis=${fmt(snap.visibilityScore)} sov=${fmt(snap.shareOfVoice)}% ` +
            `cite=${fmt(snap.citationShare)}% cnt=${fmt(snap.citationCount)} ` +
            `sent+=${fmt(snap.sentimentPositive)}/-=${fmt(snap.sentimentNegative)}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.id} ${week}: ${msg}`);
        console.error(`  ${week}  ERROR: ${msg}`);
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n== done: ${count} snapshots in ${elapsed}s, ${errors.length} errors ==`);
  if (errors.length) errors.forEach(e => console.log('  -', e));
}

function fmt(v: number | null): string {
  if (v === null) return '-';
  return typeof v === 'number' ? v.toFixed(1) : String(v);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
