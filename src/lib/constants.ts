export const CLIENTS = [
  { id: 'fanduel-sportsbook', name: 'FanDuel Sportsbook', vertical: 'Sports Betting (regulated)', icpFit: 'Y' },
  { id: 'fanduel-casino', name: 'FanDuel Casino', vertical: 'Sports Betting (regulated)', icpFit: 'Y' },
  { id: 'creditninja', name: 'CreditNinja', vertical: 'Fintech (regulated lending)', icpFit: 'Y' },
  { id: 'ninjacard', name: 'NinjaCard', vertical: 'Fintech (regulated)', icpFit: 'Y' },
  { id: 'edge', name: 'Edge', vertical: 'Fintech (Ninja Holdings)', icpFit: 'Y' },
  { id: 'cd-valet', name: 'CD Valet', vertical: 'Fintech (deposits)', icpFit: 'Y' },
  { id: 'incode', name: 'Incode', vertical: 'Identity / KYC (regulated)', icpFit: 'Y' },
  { id: 'greenvelope', name: 'Greenvelope', vertical: 'Digital invitations', icpFit: 'N' },
  { id: 'melin', name: 'melin', vertical: 'DTC / apparel', icpFit: 'N' },
  { id: 'klass-wagen', name: 'Klass Wagen', vertical: 'Car rentals / travel', icpFit: 'N' },
  { id: 'mighty-capital', name: 'Mighty Capital', vertical: 'Regulated finance / venture', icpFit: 'Y' },
  { id: 'risepoint', name: 'Risepoint', vertical: 'Higher ed (fmr Acad. Partners)', icpFit: 'N' },
  { id: 'pali-adventures', name: 'Pali Adventures', vertical: 'Youth / camp', icpFit: 'N' },
  { id: 'veep', name: 'Veep', vertical: 'Fintech', icpFit: 'Y' },
  { id: 'carafem', name: 'Carafem', vertical: 'Healthcare (reproductive)', icpFit: 'Y' },
  { id: 'searchtides', name: 'SearchTides', vertical: 'Internal — SearchTides own AI visibility / SEO', icpFit: 'Y' },
] as const;

export type ClientId = typeof CLIENTS[number]['id'];

export const DIMENSIONS = [
  {
    id: 'client-happiness',
    name: 'Client Happiness',
    weight: 0.25,
    signal: 'Sentiment analysis of Fathom transcripts, email tone, Slack message patterns, meeting attendance rate, response latency from client POC.',
  },
  {
    id: 'results-delivered',
    name: 'Results Delivered',
    weight: 0.30,
    signal: 'KPI delta vs. targets set at contract start. Pulled from GSC, Ahrefs, Profound AI visibility tracking, client analytics.',
  },
  {
    id: 'execution-discipline',
    name: 'Execution Discipline',
    weight: 0.20,
    signal: 'On-time delivery rate from PM tool (committed vs. actual dates), average response time from Slack/email timestamps, reporting cadence.',
  },
  {
    id: 'capacity-fit',
    name: 'Capacity Fit',
    weight: 0.10,
    signal: 'Hours logged per $1k MRR from time tracking vs. portfolio median. Over/under-service ratio.',
  },
  {
    id: 'internal-momentum',
    name: 'Internal Momentum',
    weight: 0.15,
    signal: 'Sprint velocity from PM tool, backlog growth rate, proactive vs. reactive task ratio, internal Slack activity on account channel.',
  },
] as const;

export type DimensionId = typeof DIMENSIONS[number]['id'];

export const RUBRIC: Record<DimensionId, { [score: number]: string }> = {
  'client-happiness': {
    1: 'Negative sentiment in >50% of recent communications. Meeting no-shows. Explicit dissatisfaction language in transcripts.',
    2: 'Mixed signals. Response latency increasing. Shorter meeting durations. Declining engagement frequency.',
    3: 'Neutral-to-positive tone. Meetings on cadence. Standard response times. No escalation signals detected.',
    4: 'Positive sentiment dominant. Client initiating contact. Introducing new stakeholders. Scope expansion discussions.',
    5: 'Strong advocacy language in transcripts. Referral activity detected. Unprompted scope expansion. Peak engagement signals.',
  },
  'results-delivered': {
    1: 'Primary KPI >25% below target. Negative or flat trend for 2+ consecutive reporting periods.',
    2: 'Primary KPI 10-25% below target. Marginal forward movement insufficient for QBR-level reporting.',
    3: 'Primary KPI within +/-10% of target. Trend stable or modestly positive across reporting periods.',
    4: 'Primary KPI 10-25% above target. Consistent positive trend. Results attributable in client reporting.',
    5: 'Primary KPI >25% above target. Sustained positive trajectory. Client citing results in their internal reporting.',
  },
  'execution-discipline': {
    1: '<70% on-time delivery rate. Response times regularly >24h on flagged items. Reporting gaps detected.',
    2: '70-84% on-time. Intermittent response delays. At least one client-initiated follow-up on overdue items.',
    3: '85-95% on-time. Same-day response median. Slips flagged proactively before client detection.',
    4: '95-99% on-time. Response median under 4 hours. Zero client-initiated follow-ups on delivery status.',
    5: '100% on-time 2+ consecutive periods. Proactive updates preceding client requests. Deliverables ahead of schedule.',
  },
  'capacity-fit': {
    1: 'Hours per $1k MRR at 2x+ portfolio median. Resource allocation exceeding sustainable threshold.',
    2: '50-100% above portfolio median. Measurable strain on team capacity planning.',
    3: 'Within +/-20% of portfolio median. Sustainable workload-to-revenue ratio maintained.',
    4: '20-30% below median with results quality maintained. Efficient resource utilization.',
    5: '>30% below median with results at or above average. Optimal margin contribution.',
  },
  'internal-momentum': {
    1: 'Sprint velocity declining. Backlog growing faster than completion rate. Reactive task ratio >70%.',
    2: 'Velocity flat. Backlog stable but not decreasing. Proactive task ratio below team average.',
    3: 'Velocity on target. Backlog managed. Proactive/reactive ratio at team baseline.',
    4: 'Velocity above target. Backlog shrinking. Proactive recommendations generated ahead of schedule.',
    5: 'Velocity significantly above baseline. Strategic recommendations flowing. Account generating reusable methodologies.',
  },
};

export const DATA_SOURCES: Record<DimensionId, string> = {
  'client-happiness': 'Fathom transcripts (sentiment), email tone scoring, Slack message frequency/tone, meeting attendance logs',
  'results-delivered': 'GSC, Ahrefs, Profound AI visibility tracking, client analytics, contracted KPI targets',
  'execution-discipline': 'PM tool (committed vs. actual dates), Slack/email response timestamps, reporting cadence logs',
  'capacity-fit': 'Time tracking (Harvest/Toggl), monthly contract value, portfolio median benchmarks',
  'internal-momentum': 'PM tool sprint data, backlog metrics, internal Slack channel activity, task type classification',
};

export function calculateHealth(scores: Record<DimensionId, number>): number {
  const weighted = DIMENSIONS.reduce((sum, dim) => {
    return sum + (scores[dim.id] || 0) * dim.weight;
  }, 0);
  return (weighted / 5) * 100;
}

export function getRiskColor(health: number): 'GREEN' | 'YELLOW' | 'RED' {
  if (health >= 80) return 'GREEN';
  if (health >= 60) return 'YELLOW';
  return 'RED';
}

export type HealthStatus = 'GREEN' | 'YELLOW' | 'RED' | 'BLUE' | 'EMPTY';

// Derive the full health status label with coverage awareness.
// BLUE = "partial data — can't score yet" (< 3 of 5 dims covered).
// EMPTY = no data at all this week.
export function getHealthStatus(
  health: number | null,
  coveredDims: number
): HealthStatus {
  if (health === null) return 'EMPTY';
  if (coveredDims < 3) return 'BLUE';
  return getRiskColor(health);
}

// Human-readable meaning of each status — shown in the legend on the
// Dashboard so viewers don't read YELLOW as "bad" when it means "on track."
export const STATUS_MEANING: Record<HealthStatus, { label: string; description: string }> = {
  GREEN: { label: 'Healthy', description: 'Performing at or above expectations — 80+ partial health.' },
  YELLOW: { label: 'On Track', description: 'Meeting baseline, not ahead. This is fine — 60–79 partial health.' },
  RED: { label: 'Needs Attention', description: 'One or more dimensions flagged — below 60 partial health.' },
  BLUE: { label: 'Partial Data', description: 'Fewer than 3 of 5 dimensions scored — insufficient signal to judge.' },
  EMPTY: { label: 'No Data', description: 'No Fathom calls, Profound data, or other signal this week.' },
};

// Per-client metadata (QBR cadence, contract dates, MRR).
// Values populated by Drew. Unknown fields stay empty — they'll show as
// "—" in the UI rather than triggering a null-check failure.
export interface ClientMetadata {
  contractStart?: string; // ISO date
  contractEnd?: string; // ISO date, null = month-to-month
  monthlyValue?: number; // USD
  lastQBR?: string; // ISO date
  nextQBR?: string; // ISO date
  pointOfContact?: { name?: string; email?: string; role?: string };
  accountLead?: string; // SearchTides person
  contractStatus?: 'active' | 'renewing' | 'at-risk' | 'offboarding';
  notes?: string;
}

// Populate as data becomes available. Clients not in this map surface
// their metadata as "—" in the Clients tab.
// monthlyValue source: Drew's Avg Monthly Revenue table (2026-04-24).
// FanDuel: table shows FanDuel Inc at $348,842 total. Split 50/50 between
// sportsbook and casino here because the two are tracked as one contract
// on Drew's side — adjust the split if a more accurate allocation emerges.
export const CLIENT_METADATA: Partial<Record<ClientId, ClientMetadata>> = {
  'fanduel-sportsbook': { monthlyValue: 174421 },
  'fanduel-casino': { monthlyValue: 174421 },
  'creditninja': { monthlyValue: 76050 },
  'greenvelope': { monthlyValue: 18700, nextQBR: '2026-05-04' },
  'incode': { monthlyValue: 12142.86 },
  'cd-valet': { monthlyValue: 9285 },
  'melin': { monthlyValue: 8571 },
  'klass-wagen': { monthlyValue: 8333, nextQBR: '2026-05-08' },
  'risepoint': { monthlyValue: 6750 },
  'carafem': { monthlyValue: 6000 },
  'ninjacard': { monthlyValue: 2765 },
  'veep': { monthlyValue: 2500 },
  // Missing MRR (Capacity Fit will stay unscored for these):
  //   pali-adventures — seasonal; MRR not yet provided
  //   edge, mighty-capital, searchtides — unmapped to Harvest (see CLIENT_HARVEST_PROJECT)
};

// Fathom team names whose meetings feed the scorecard. These are the exact
// names returned by GET /teams on our Fathom org — "Client Service" (not
// "Client Success") is intentional.
export const FATHOM_TEAMS = ['Client Service', 'Customer Success'] as const;

// SearchTides mailboxes the Gmail sync iterates (via service-account DWD).
// If any address is wrong, DWD auth fails per-mailbox and the sync logs a
// "USER_NOT_FOUND" or "delegation denied" error — update this list then.
export const SEARCHTIDES_MAILBOXES = [
  'drew@searchtides.com',
  'casey@searchtides.com',
  'keegan@searchtides.com',
  'nicholas@searchtides.com',
  'sofiavolynets@searchtides.com',
  'baldwin@searchtides.com',
  'derek.iwasiuk@searchtides.com',
] as const;

// Maps a Fathom meeting to a client via attendee email domain. Add entries
// as new domains appear in unmatched meetings — the poller writes those to
// data/fathom/extractions/_unmatched/.
export const CLIENT_EMAIL_DOMAINS: Partial<Record<ClientId, readonly string[]>> = {
  'fanduel-sportsbook': ['fanduel.com'],
  'fanduel-casino': ['fanduel.com'],
  'creditninja': ['creditninja.com'],
  'ninjacard': ['ninjacard.com', 'ninjaholdings.com'],
  'edge': ['edge-fintech.com', 'ninjaholdings.com'],
  'cd-valet': ['cdvalet.com'],
  'incode': ['incode.com'],
  'greenvelope': ['greenvelope.com'],
  'melin': ['melin.com'],
  'mighty-capital': ['mightycapital.com'],
  'risepoint': ['risepoint.com'],
  'pali-adventures': ['paliadventures.com'],
};

// The inverse map — built once at module load. Useful for O(1) domain → clientId.
export const DOMAIN_TO_CLIENT: Record<string, ClientId> = Object.entries(
  CLIENT_EMAIL_DOMAINS
).reduce((acc, [clientId, domains]) => {
  for (const d of domains ?? []) acc[d.toLowerCase()] = clientId as ClientId;
  return acc;
}, {} as Record<string, ClientId>);

// Explicit Slack channel-name → client map. Used by the Slack sync to attribute
// channel-week extractions when member-email heuristics don't resolve
// cleanly (e.g., Slack Connect channels where client users use a guest
// email domain). Names are matched case-insensitive on the exact channel
// name (no `#` prefix). Leave empty to rely fully on heuristic matching.
export const CLIENT_SLACK_CHANNELS: Partial<Record<ClientId, readonly string[]>> = {
  'creditninja': ['creditninja'],
  'ninjacard': ['ninjacard'],
  'fanduel-sportsbook': ['fd-sportsbook'],
  'fanduel-casino': ['fd-casino'],
  'cd-valet': ['cdvalet'],
  'melin': ['melin'],
  'incode': ['incode'],
  'greenvelope': ['greenvelope'],
  'klass-wagen': ['klass-wagen'],
  'veep': ['veep'],
  'mighty-capital': ['mighty-capital'],
  'risepoint': ['academic-partnerships'],
};

// Profound "asset" (brand) IDs per client. Clients absent from this map are
// skipped by the Profound sync — Results Delivered stays pending until another
// data source (GSC/Ahrefs/etc.) covers them.
// Source: `GET /v1/org/assets?limit=500` filtered by `is_owned: true` on 2026-04-20.
export interface ProfoundAssetMapping {
  assetId: string;
  assetName: string; // exact string from Profound — used in filter (only accepts asset_name, not asset_id)
  assetWebsite: string; // hostname Profound reports citations against
  categoryId: string;
  categoryName: string;
}

export const CLIENT_PROFOUND_ASSET: Partial<Record<ClientId, ProfoundAssetMapping>> = {
  'creditninja': {
    assetId: '055c74c4-57eb-4b93-97a7-228f3814dee1',
    assetName: 'CreditNinja',
    assetWebsite: 'creditninja.com',
    categoryId: '19c952d6-ad78-484b-aabb-7a7d727c284f',
    categoryName: 'FinTech',
  },
  'incode': {
    assetId: '21e0019a-2711-44a3-9781-d243e51c08d8',
    assetName: 'Incode',
    assetWebsite: 'incode.com',
    categoryId: '3c8ee32e-14cc-4de2-8ea3-8300eb21463b',
    categoryName: 'Digital identity verification',
  },
  'cd-valet': {
    assetId: 'a62e547e-c92f-4bb8-bc66-afae175fe3b3',
    assetName: 'CD Valet',
    assetWebsite: 'cdvalet.com',
    categoryId: '89c9b9a7-b76d-4eba-ac8a-843cfeb95c1a',
    categoryName: 'Certificate of Deposit',
  },
  'greenvelope': {
    assetId: '132e9177-6b6f-48a6-b771-983634b01013',
    assetName: 'Greenvelope',
    assetWebsite: 'greenvelope.com',
    categoryId: '9a697758-c84c-43d6-8e0d-f04b85145661',
    categoryName: 'Digital invitations',
  },
  'melin': {
    assetId: '2bbfe51d-3e29-41db-911c-c0fa91464532',
    assetName: 'Melin',
    assetWebsite: 'melin.com',
    categoryId: '9cfc7908-3268-4158-9957-2374ec877c93',
    categoryName: 'Headwear',
  },
  'klass-wagen': {
    assetId: 'ca4c5afb-5924-47bd-930b-6f25068c13ec',
    assetName: 'Klass Wagen',
    assetWebsite: 'klasswagen.com',
    categoryId: '9ef203d9-9919-4a8a-bb8d-7d851e68bc3d',
    categoryName: 'Car Rentals',
  },
  'mighty-capital': {
    assetId: '865f4d0c-bd03-4291-8979-1a8a2ee0ec1b',
    assetName: 'Mighty Capital',
    assetWebsite: 'mighty.capital',
    categoryId: '9f1a1e1a-e9e6-4675-86aa-a6191bf763c2',
    categoryName: 'Venture Capital',
  },
  'fanduel-sportsbook': {
    assetId: '65d2da87-efc2-46b4-8948-f97b80e269f0',
    assetName: 'FanDuel',
    assetWebsite: 'fanduel.com',
    categoryId: '9ff0dd8c-c312-43ee-8dfb-9a36ffe344b5',
    categoryName: 'Online Sports Betting',
  },
  'fanduel-casino': {
    assetId: '65d2da87-efc2-46b4-8948-f97b80e269f0',
    assetName: 'FanDuel',
    assetWebsite: 'fanduel.com',
    categoryId: '9ff0dd8c-c312-43ee-8dfb-9a36ffe344b5',
    categoryName: 'Online Sports Betting',
  },
  // SearchTides tracks its own AI visibility as a self-client. Per the
  // "SearchTides = AI visibility only" feedback rule, the searchtides tile
  // is Profound-sourced only; Fathom content about internal ops is filtered
  // out in manifest.ts.
  'searchtides': {
    assetId: 'dd6a52b5-9b44-4fe9-8622-6246411a9341',
    assetName: 'SearchTides',
    assetWebsite: 'searchtides.com',
    categoryId: '5a294057-b717-4364-a9a4-9586039ba8be',
    categoryName: 'Marketing',
  },
};

// Harvest project IDs per SearchTides client. Harvest layout: the Harvest
// *Client* named "SearchTides Clients" contains one *Project* per
// SearchTides client (hours are logged against that project's tasks —
// tasks are work-categories like "Research", "Reporting", etc., not per-
// client). Unmapped clients are skipped by harvest-sync.
// projectName is stored for debugging — only projectId is used for matching.
// Source: GET /v2/projects?is_active=true on 2026-04-24.
export interface HarvestProjectMapping {
  projectId: number;
  projectName: string;
}

// Harvest users whose hours feed Capacity Fit scoring (strategy + account
// team). Everyone else — link-building team, ops, admin — is excluded so
// the hours-per-$1k-MRR signal reflects strategic time only.
// Names must match the full_name (`first_name + ' ' + last_name`) that
// Harvest returns on time entries. Casey's name uses a curly apostrophe.
// Source: Drew 2026-04-24.
export const CAPACITY_COUNTED_USERS: readonly string[] = [
  "Casey O’Connor",
  'Sofia Volynets',
  'Baldwin Diep',
  'Nicholas Bradman',
  'Chris Wyatt',
  'Ricardo Bravo',
  'Madeline Schwappach',
  'Alex Giatrakas',
  'Scott Moses',
];

export const CLIENT_HARVEST_PROJECT: Partial<Record<ClientId, HarvestProjectMapping>> = {
  'fanduel-sportsbook': { projectId: 26892765, projectName: 'FanDuel Sportsbook' },
  'fanduel-casino': { projectId: 32390961, projectName: 'FanDuel Casino' },
  'creditninja': { projectId: 26892764, projectName: 'CreditNinja' },
  'ninjacard': { projectId: 29535013, projectName: 'NinjaCard' },
  'cd-valet': { projectId: 46198042, projectName: 'CD Valet' },
  'incode': { projectId: 47232176, projectName: 'InCode' },
  'greenvelope': { projectId: 47504752, projectName: 'Greenvelope' },
  'melin': { projectId: 46287737, projectName: 'Melin' },
  'klass-wagen': { projectId: 47605364, projectName: 'Klass Wagon' },
  'risepoint': { projectId: 35864555, projectName: 'Risepoint' },
  'pali-adventures': { projectId: 45117734, projectName: 'Pali Adventures' },
  'veep': { projectId: 47630675, projectName: 'VeepSoftware' },
  'carafem': { projectId: 46223819, projectName: 'Carafem' },
  // Unmapped:
  //   edge — intentional: Ninja Holdings offshoot, hours fold into
  //          NinjaCard/CreditNinja until a dedicated project exists
  //   mighty-capital — no Harvest project exists yet (should be created)
  //   searchtides — intentionally excluded per "SearchTides = AI visibility only" rule
};

// Known client contacts — used by the rollup to override LLM attribution
// when a narrative item mentions a contact's first name. Add entries as
// real contacts appear. Ambiguous first names should be disambiguated with
// a last name so the matcher requires both.
export interface ClientContact {
  firstName: string; // required for matching
  lastName?: string; // optional — add when first name is ambiguous across clients
  role?: string;
  email?: string;
}

export const CLIENT_CONTACTS: Partial<Record<ClientId, readonly ClientContact[]>> = {
  'greenvelope': [{ firstName: 'Sam', role: 'POC' }],
  'creditninja': [{ firstName: 'Patrick', lastName: 'Shipman', role: 'POC' }],
  // Populate as contacts become known. Last names are preferred when
  // first names might collide (e.g. multiple "Chris" across clients).
};

// Fathom transcribes certain names inconsistently. Corrections are applied
// to narrative-item text before client attribution and before the tweet
// prompt, so the LLM sees the right spelling and contact-matching works.
// Keys are matched case-insensitively against whole words.
export const TRANSCRIPT_NAME_FIXES: Record<string, string> = {
  mossy: 'Massi',
  massy: 'Massi',
};

// Phrases that indicate SearchTides' own business state, which must never
// appear in any client tile. Matched case-insensitively against item text.
// Items where any phrase appears are dropped from the rollup.
export const SEARCHTIDES_BUSINESS_BLOCKLIST: readonly string[] = [
  'break-even',
  'breakeven',
  'searchtides revenue',
  "searchtides' revenue",
  'searchtides hiring',
  "searchtides' hiring",
  'searchtides finance',
  "searchtides' finance",
  'searchtides near',
  'push searchtides',
  "searchtides' best",
  'searchtides will have its best',
  'highest-revenue year',
  'searchtides projections',
];
