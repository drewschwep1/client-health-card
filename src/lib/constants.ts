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

// Fathom team names whose meetings feed the scorecard. These are the exact
// names returned by GET /teams on our Fathom org — "Client Service" (not
// "Client Success") is intentional.
export const FATHOM_TEAMS = ['Client Service', 'Customer Success'] as const;

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
