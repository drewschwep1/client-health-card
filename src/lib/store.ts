import { ClientId, DimensionId, DIMENSIONS, calculateHealth, getRiskColor } from './constants';
import { startOfWeek, format, subWeeks } from 'date-fns';

export interface WeeklyScore {
  clientId: ClientId;
  weekStart: string; // ISO date string (Monday)
  scores: Partial<Record<DimensionId, number>>;
  tweet: string;
  health: number;
  risk: 'GREEN' | 'YELLOW' | 'RED';
}

export interface ClientMeta {
  clientId: ClientId;
  monthlyValue: number;
}

const SCORES_KEY = 'health-card-scores';
const META_KEY = 'health-card-meta';

export function getCurrentWeekStart(): string {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function getWeekStart(weeksAgo: number): string {
  return format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function getAllScores(): WeeklyScore[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(SCORES_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function getScoresForWeek(weekStart: string): WeeklyScore[] {
  return getAllScores().filter(s => s.weekStart === weekStart);
}

export function getScoresForClient(clientId: ClientId): WeeklyScore[] {
  return getAllScores().filter(s => s.clientId === clientId);
}

export function getLatestScore(clientId: ClientId): WeeklyScore | undefined {
  const scores = getScoresForClient(clientId);
  return scores.sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
}

export function getPriorScore(clientId: ClientId): WeeklyScore | undefined {
  const scores = getScoresForClient(clientId);
  const sorted = scores.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  return sorted[1];
}

export function saveScore(
  clientId: ClientId,
  weekStart: string,
  scores: Record<DimensionId, number>,
  tweet: string
): WeeklyScore {
  const allScores = getAllScores();
  const health = calculateHealth(scores);
  const risk = getRiskColor(health);

  const existing = allScores.findIndex(
    s => s.clientId === clientId && s.weekStart === weekStart
  );

  const entry: WeeklyScore = { clientId, weekStart, scores, tweet, health, risk };

  if (existing >= 0) {
    allScores[existing] = entry;
  } else {
    allScores.push(entry);
  }

  localStorage.setItem(SCORES_KEY, JSON.stringify(allScores));
  return entry;
}

export function getClientMeta(): ClientMeta[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(META_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveClientMeta(meta: ClientMeta[]): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function getClientMonthlyValue(clientId: ClientId): number {
  const meta = getClientMeta();
  return meta.find(m => m.clientId === clientId)?.monthlyValue || 0;
}

export function getRecentWeeks(count: number = 4): string[] {
  return Array.from({ length: count }, (_, i) => getWeekStart(i));
}

export function getPortfolioStats() {
  const allScores = getAllScores();
  const currentWeek = getCurrentWeekStart();
  const currentScores = allScores.filter(s => s.weekStart === currentWeek);

  const scoredClients = currentScores.filter(s => s.health > 0);
  const avgHealth = scoredClients.length > 0
    ? scoredClients.reduce((sum, s) => sum + s.health, 0) / scoredClients.length
    : 0;

  const meta = getClientMeta();
  const totalRevenue = meta.reduce((sum, m) => sum + m.monthlyValue, 0);

  const atRisk = currentScores.filter(s => s.risk === 'RED');
  const caution = currentScores.filter(s => s.risk === 'YELLOW');
  const healthy = currentScores.filter(s => s.risk === 'GREEN');

  const revenueAtRisk = atRisk.reduce((sum, s) => {
    const m = meta.find(m => m.clientId === s.clientId);
    return sum + (m?.monthlyValue || 0);
  }, 0);

  return {
    avgHealth,
    totalRevenue,
    atRiskCount: atRisk.length,
    cautionCount: caution.length,
    healthyCount: healthy.length,
    scoredCount: scoredClients.length,
    revenueAtRisk,
  };
}
