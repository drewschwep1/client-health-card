export const CLIENTS = [
  { id: 'fanduel-sportsbook', name: 'FanDuel Sportsbook', vertical: 'Sports Betting (regulated)', icpFit: 'Y' },
  { id: 'fanduel-casino', name: 'FanDuel Casino', vertical: 'Sports Betting (regulated)', icpFit: 'Y' },
  { id: 'creditninja', name: 'CreditNinja', vertical: 'Fintech (regulated lending)', icpFit: 'Y' },
  { id: 'ninjacard', name: 'NinjaCard', vertical: 'Fintech (regulated)', icpFit: 'Y' },
  { id: 'edge', name: 'Edge', vertical: 'Fintech (Ninja Holdings)', icpFit: 'Y' },
  { id: 'cd-valet', name: 'CD Valet', vertical: 'Fintech (deposits)', icpFit: 'Y' },
  { id: 'incode', name: 'Incode', vertical: 'Identity / KYC (regulated)', icpFit: 'Y' },
  { id: 'greenvelope', name: 'Greenvelope', vertical: 'Consumer SaaS', icpFit: '?' },
  { id: 'melin', name: 'melin', vertical: 'DTC / apparel', icpFit: 'N' },
  { id: 'klass-wagen', name: 'Klass Wagen', vertical: 'Travel / rental', icpFit: '?' },
  { id: 'mighty-capital', name: 'Mighty Capital', vertical: 'Venture / financial svcs', icpFit: '?' },
  { id: 'risepoint', name: 'Risepoint', vertical: 'Higher ed (fmr Acad. Partners)', icpFit: '?' },
  { id: 'pali-adventures', name: 'Pali Adventures', vertical: 'Youth / camp', icpFit: 'N' },
  { id: 'veep', name: 'Veep', vertical: '(confirm)', icpFit: '?' },
] as const;

export type ClientId = typeof CLIENTS[number]['id'];

export const DIMENSIONS = [
  { id: 'client-happiness', name: 'Client Happiness', weight: 0.25, type: 'Subjective' as const },
  { id: 'results-delivered', name: 'Results Delivered', weight: 0.30, type: 'Objective' as const },
  { id: 'execution-discipline', name: 'Execution Discipline', weight: 0.20, type: 'Objective' as const },
  { id: 'capacity-fit', name: 'Capacity Fit', weight: 0.10, type: 'Objective' as const },
  { id: 'internal-momentum', name: 'Internal Momentum', weight: 0.15, type: 'Subjective' as const },
] as const;

export type DimensionId = typeof DIMENSIONS[number]['id'];

export const RUBRIC: Record<DimensionId, { [score: number]: string }> = {
  'client-happiness': {
    1: 'POC actively unhappy. Complaints in writing. Skipping meetings. Mentions reviewing the relationship.',
    2: 'Tension visible. Short responses, delayed replies from their side, passive disengagement.',
    3: 'Neutral to positive. Meetings on cadence. Feedback routine. No complaints, no championing.',
    4: 'POC engaged and positive. Proactive feedback. Introduces us to new internal stakeholders.',
    5: 'POC actively championing us internally. Referring peers. Expanding scope unprompted.',
  },
  'results-delivered': {
    1: 'Missing primary KPI target by >25%. Trend negative or flat 2+ months. Client noticed.',
    2: 'Missing target by 10-25%. Some progress but not enough to cite in a QBR.',
    3: 'Within ±10% of target. Trend stable or modestly positive. Incremental progress visible.',
    4: 'Beating target by 10-25%. Clear positive trend. Results visible in client metrics.',
    5: 'Beating target by >25%. Client cites our work in their own internal reporting.',
  },
  'execution-discipline': {
    1: '<70% deliverables on time. Response >24h on urgent items. Client chasing us.',
    2: '70-84% on time. Occasional response delays. Client has noticed at least once.',
    3: '85-95% on time. Responses same-day. Slips flagged proactively.',
    4: '95-99% on time. Responses within hours. Client never wonders where things stand.',
    5: '100% on time 2+ months. Proactive updates before client asks. Deliverables land early.',
  },
  'capacity-fit': {
    1: 'Hours per $1k MRR 2x+ portfolio median. Over-allocated. Losing money.',
    2: '50-100% above median. Noticeable strain on resource planning.',
    3: 'Within ±20% of portfolio median. Sustainable workload-to-revenue ratio.',
    4: '20-30% below median while maintaining results quality. Efficient.',
    5: '30%+ below median with results at or above average. Profit engine.',
  },
  'internal-momentum': {
    1: 'Behind and falling further. Reactive. Work sliding week to week. People avoiding account.',
    2: 'Slightly behind. Can recover but requires extra push. Energy low.',
    3: 'On pace. Team knows what\'s next. Not ahead, not slipping.',
    4: 'Ahead of schedule. Proactive ideas being developed. Team engaged.',
    5: 'Well ahead. Unprompted strategic recommendations. Account energizing, not draining.',
  },
};

export const DATA_SOURCES: Record<DimensionId, string> = {
  'client-happiness': 'Meeting transcripts, Slack/email tone, direct quotes, NPS check-ins',
  'results-delivered': 'GSC, Ahrefs, AI visibility tracking, client analytics, sold KPI at contract start',
  'execution-discipline': 'PM tool (committed vs actual dates), Slack/email response timestamps, reporting cadence',
  'capacity-fit': 'Time tracking (Harvest/Toggl) + monthly contract value',
  'internal-momentum': 'Standups, 1:1s, team Slack, sprint/kanban progress, direct observation',
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
