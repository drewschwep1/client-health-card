import { startOfWeek, format, parseISO, isWithinInterval, addDays } from 'date-fns';
import {
  CLIENT_CONTACTS,
  DIMENSIONS,
  SEARCHTIDES_BUSINESS_BLOCKLIST,
  TRANSCRIPT_NAME_FIXES,
  type ClientId,
  type DimensionId,
} from '../constants';
import { listAllExtractions } from './store';
import type { Extraction, FathomScorableDimension, NarrativeItem } from './extract-types';
import { FATHOM_SCORABLE_DIMENSIONS, resolveNarrativeItem } from './extract-types';

// Apply Fathom transcript name corrections (e.g. "mossy" → "Massi").
// Whole-word, case-insensitive; preserves capitalization of the replacement.
const NAME_FIX_ENTRIES = Object.entries(TRANSCRIPT_NAME_FIXES);
function applyNameFixes(text: string): string {
  let out = text;
  for (const [wrong, right] of NAME_FIX_ENTRIES) {
    out = out.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), right);
  }
  return out;
}

// Scan text for known client-contact first names. Returns the correct
// clientId if exactly one contact matches, or null if zero or ambiguous.
// Contacts with a last name require BOTH first+last to match (disambiguates
// collisions like multiple "Patrick").
const CONTACT_INDEX: Array<{ clientId: ClientId; firstName: string; lastName?: string }> =
  Object.entries(CLIENT_CONTACTS).flatMap(([cid, contacts]) =>
    (contacts ?? []).map(c => ({
      clientId: cid as ClientId,
      firstName: c.firstName,
      lastName: c.lastName,
    }))
  );

function reattributeByContact(text: string): ClientId | null {
  const matches = new Set<ClientId>();
  for (const c of CONTACT_INDEX) {
    const firstRe = new RegExp(`\\b${c.firstName}\\b`, 'i');
    if (!firstRe.test(text)) continue;
    if (c.lastName) {
      const lastRe = new RegExp(`\\b${c.lastName}\\b`, 'i');
      if (!lastRe.test(text)) continue;
    }
    matches.add(c.clientId);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

// Drop items whose text contains any SearchTides-business blocklist phrase.
// Per Drew's rule: SearchTides' own revenue/break-even/hiring/finances must
// never appear on any client tile.
function containsSearchTidesBusiness(text: string): boolean {
  const t = text.toLowerCase();
  return SEARCHTIDES_BUSINESS_BLOCKLIST.some(phrase => t.includes(phrase.toLowerCase()));
}

// Full post-processing pipeline for a single narrative item: name-fix,
// contact-based reattribution, biz-filter. Returns null if the item should
// be dropped entirely (SearchTides-business content).
function processNarrativeItem(
  rawText: string,
  primaryClientId: ClientId | null,
  itemClientId: ClientId | null | undefined
): { text: string; clientId: ClientId | null } | null {
  const fixedText = applyNameFixes(rawText);
  if (containsSearchTidesBusiness(fixedText)) return null;
  const contactOverride = reattributeByContact(fixedText);
  const resolvedClient = contactOverride ?? itemClientId ?? primaryClientId;
  return { text: fixedText, clientId: resolvedClient };
}

export interface ClientSignals {
  clientId: ClientId;
  weekStart: string;
  meetingCount: number;
  meetings: Array<{
    recordingId: number;
    title: string;
    date: string;
  }>;
  weeklyWins: string[];
  concerns: string[];
  proactivitySignals: string[];

  // Averaged per-dimension scores across the week's meetings. null when no
  // meeting produced a score for that dimension.
  suggestedScores: Record<FathomScorableDimension, number | null>;

  // Normalized health over the dimensions Fathom can score. 0–100, weighted
  // by each dimension's share within the Fathom-covered subset (so the
  // three covered dimensions sum to 100% of the partial health, not 70%).
  // null when no dimension had any score.
  partialHealth: number | null;

  // Which dimensions actually contributed. Used by the UI to flag that
  // results-delivered and capacity-fit are pending external data.
  coveredDimensions: FathomScorableDimension[];

  rawEvidence: Array<{
    dimensionId: DimensionId;
    quote: string;
    speaker: string;
    recordingId: number;
  }>;

  // Convenience for older callers that only read happiness.
  suggestedHappinessScore: number | null;
}

function weekStartIso(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

// Returns true if the extraction has ANY item (win/concern/proactivity/
// rawEvidence) attributed — either via its primary clientId or a per-item
// override — to the target clientId.
function extractionTouchesClient(e: Extraction, clientId: ClientId): boolean {
  if (e.clientId === clientId) return true;
  const itemMatches = (item: string | NarrativeItem): boolean => {
    if (typeof item === 'string') return false; // plain string inherits primary — already checked above
    return item.clientId === clientId;
  };
  if (e.weeklyWins.some(itemMatches)) return true;
  if (e.concerns.some(itemMatches)) return true;
  if (e.proactivitySignals.some(itemMatches)) return true;
  if (e.rawEvidence.some(r => r.clientId === clientId)) return true;
  return false;
}

export async function getClientSignals(
  clientId: ClientId,
  weekStart?: string,
  opts?: { excludeRecordingIds?: Set<number> }
): Promise<ClientSignals> {
  const week = weekStart ?? weekStartIso(new Date());
  const weekStartDate = parseISO(week);
  const weekEndDate = addDays(weekStartDate, 7);
  const excluded = opts?.excludeRecordingIds ?? new Set<number>();

  const all = await listAllExtractions();
  const relevant = all.filter(e => {
    if (!extractionTouchesClient(e, clientId)) return false;
    if (excluded.has(e.recordingId)) return false;
    try {
      return isWithinInterval(parseISO(e.meetingDate), {
        start: weekStartDate,
        end: weekEndDate,
      });
    } catch {
      return false;
    }
  });

  return aggregate(clientId, week, relevant);
}

function scoreFromExtraction(
  e: Extraction,
  dim: FathomScorableDimension
): number | null {
  // Back-compat: older extractions (schemaVersion < 2) only have
  // clientHappinessScore at the top level.
  if (e.scores && dim in e.scores) {
    const v = e.scores[dim];
    return v ?? null;
  }
  // Legacy shape
  const legacy = (e as unknown as { clientHappinessScore?: number }).clientHappinessScore;
  if (dim === 'client-happiness' && typeof legacy === 'number') return legacy;
  return null;
}

function averageNonNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (!present.length) return null;
  return Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10;
}

function aggregate(
  clientId: ClientId,
  weekStart: string,
  extractions: Extraction[]
): ClientSignals {
  const wins = new Set<string>();
  const concerns = new Set<string>();
  const proactivity = new Set<string>();
  const rawEvidence: ClientSignals['rawEvidence'] = [];
  const primaryExtractions: Extraction[] = []; // extractions whose primary client == clientId — drive meetingCount + scores

  const perDim: Record<FathomScorableDimension, Array<number | null>> = {
    'client-happiness': [],
    'execution-discipline': [],
    'internal-momentum': [],
  };

  for (const e of extractions) {
    const isPrimary = e.clientId === clientId;
    if (isPrimary) primaryExtractions.push(e);

    // Pull items whose resolved client matches. Pipeline applied per item:
    //   1. Transcript name fixes (mossy → Massi, etc.)
    //   2. Drop if item text contains SearchTides-business blocklist
    //   3. Reattribute by known contact name if unambiguous (Sam → Greenvelope)
    //   4. Otherwise fall back to the item's own clientId, then the primary clientId.
    for (const w of e.weeklyWins) {
      const resolved = resolveNarrativeItem(w, e.clientId);
      const processed = processNarrativeItem(resolved.text, e.clientId, resolved.clientId);
      if (processed && processed.clientId === clientId) wins.add(processed.text);
    }
    for (const c of e.concerns) {
      const resolved = resolveNarrativeItem(c, e.clientId);
      const processed = processNarrativeItem(resolved.text, e.clientId, resolved.clientId);
      if (processed && processed.clientId === clientId) concerns.add(processed.text);
    }
    for (const p of e.proactivitySignals) {
      const resolved = resolveNarrativeItem(p, e.clientId);
      const processed = processNarrativeItem(resolved.text, e.clientId, resolved.clientId);
      if (processed && processed.clientId === clientId) proactivity.add(processed.text);
    }
    for (const r of e.rawEvidence) {
      const resolvedClient = r.clientId ?? e.clientId;
      if (resolvedClient === clientId) {
        rawEvidence.push({
          dimensionId: r.dimensionId,
          quote: r.quote,
          speaker: r.speaker,
          recordingId: e.recordingId,
        });
      }
    }

    // Scores + meetingCount only reflect the PRIMARY client's extractions —
    // a concern routed here via per-item override does NOT imply a meeting
    // happened for this client.
    if (isPrimary) {
      for (const dim of FATHOM_SCORABLE_DIMENSIONS) {
        perDim[dim].push(scoreFromExtraction(e, dim));
      }
    }
  }

  const suggestedScores: Record<FathomScorableDimension, number | null> = {
    'client-happiness': averageNonNull(perDim['client-happiness']),
    'execution-discipline': averageNonNull(perDim['execution-discipline']),
    'internal-momentum': averageNonNull(perDim['internal-momentum']),
  };

  const coveredDimensions = FATHOM_SCORABLE_DIMENSIONS.filter(
    d => suggestedScores[d] !== null
  );

  // Normalized partial health: only covered dimensions count, reweighted so
  // their weights sum to 1. Then scale the 1-5 average to 0-100.
  const dimWeight = (id: DimensionId): number =>
    DIMENSIONS.find(d => d.id === id)?.weight ?? 0;
  const coveredWeightSum = coveredDimensions.reduce(
    (sum, d) => sum + dimWeight(d),
    0
  );
  const partialHealth =
    coveredWeightSum > 0
      ? Math.round(
          (coveredDimensions.reduce(
            (sum, d) => sum + (suggestedScores[d] ?? 0) * dimWeight(d),
            0
          ) /
            coveredWeightSum /
            5) *
            100
        )
      : null;

  return {
    clientId,
    weekStart,
    // Count only touchpoints where this client is the PRIMARY subject —
    // items routed here via per-item override (e.g., a Greenvelope concern
    // surfaced inside a Mighty Capital meeting) don't count as
    // "touchpoints" for this client, though their signals show through.
    meetingCount: primaryExtractions.length,
    meetings: primaryExtractions.map(e => ({
      recordingId: e.recordingId,
      title: e.meetingTitle,
      date: e.meetingDate,
    })),
    weeklyWins: Array.from(wins),
    concerns: Array.from(concerns),
    proactivitySignals: Array.from(proactivity),
    suggestedScores,
    partialHealth,
    coveredDimensions,
    rawEvidence,
    suggestedHappinessScore: suggestedScores['client-happiness'],
  };
}
