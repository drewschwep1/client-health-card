'use client';

import { useEffect, useState } from 'react';
import { CLIENTS } from '@/lib/constants';
import { getPortfolioStats, getScoresForWeek, getCurrentWeekStart, getRecentWeeks, WeeklyScore, getAllScores } from '@/lib/store';

export default function PortfolioPage() {
  const [stats, setStats] = useState<ReturnType<typeof getPortfolioStats> | null>(null);
  const [weeklyTrend, setWeeklyTrend] = useState<{ week: string; avg: number; count: number }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setStats(getPortfolioStats());

    const weeks = getRecentWeeks(4);
    const allScores = getAllScores();
    const trend = weeks.map(week => {
      const weekScores = allScores.filter(s => s.weekStart === week && s.health > 0);
      const avg = weekScores.length > 0
        ? Math.round(weekScores.reduce((sum, s) => sum + s.health, 0) / weekScores.length)
        : 0;
      return { week, avg, count: weekScores.length };
    }).reverse();
    setWeeklyTrend(trend);
    setLoaded(true);
  }, []);

  if (!loaded || !stats) return <div className="text-muted text-sm">Loading...</div>;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted mt-1">Aggregate health metrics across all clients</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Avg Health"
          value={stats.scoredCount > 0 ? Math.round(stats.avgHealth).toString() : '-'}
          subtitle={`${stats.scoredCount} clients scored`}
        />
        <StatCard
          label="At Risk"
          value={stats.atRiskCount.toString()}
          subtitle="RED status"
          color="red"
        />
        <StatCard
          label="Caution"
          value={stats.cautionCount.toString()}
          subtitle="YELLOW status"
          color="yellow"
        />
        <StatCard
          label="Healthy"
          value={stats.healthyCount.toString()}
          subtitle="GREEN status"
          color="green"
        />
      </div>

      {weeklyTrend.some(w => w.count > 0) && (
        <div className="border border-border rounded-lg p-6 bg-card mb-8">
          <h2 className="text-sm font-medium mb-4">Weekly Trend</h2>
          <div className="flex items-end gap-3 h-32">
            {weeklyTrend.map(({ week, avg, count }) => (
              <div key={week} className="flex-1 flex flex-col items-center gap-2">
                {count > 0 ? (
                  <>
                    <span className="text-xs font-mono tabular-nums">{avg}</span>
                    <div
                      className={`w-full rounded-t transition-all ${
                        avg >= 80 ? 'bg-green' : avg >= 60 ? 'bg-yellow' : 'bg-red'
                      }`}
                      style={{ height: `${(avg / 100) * 100}%`, minHeight: '8px' }}
                    />
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs text-muted">-</span>
                  </div>
                )}
                <span className="text-[10px] text-muted font-mono">{week.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg p-6 bg-card">
        <h2 className="text-sm font-medium mb-4">Distribution</h2>
        <div className="space-y-3">
          <DistBar label="GREEN (80+)" count={stats.healthyCount} total={CLIENTS.length} color="bg-green" />
          <DistBar label="YELLOW (60-79)" count={stats.cautionCount} total={CLIENTS.length} color="bg-yellow" />
          <DistBar label="RED (<60)" count={stats.atRiskCount} total={CLIENTS.length} color="bg-red" />
          <DistBar label="Unscored" count={CLIENTS.length - stats.scoredCount} total={CLIENTS.length} color="bg-border" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle, color }: { label: string; value: string; subtitle: string; color?: string }) {
  const colorStyles = {
    red: 'border-red/20 bg-red-bg',
    yellow: 'border-yellow/20 bg-yellow-bg',
    green: 'border-green/20 bg-green-bg',
  };

  return (
    <div className={`border rounded-lg p-4 ${color ? colorStyles[color as keyof typeof colorStyles] : 'border-border bg-card'}`}>
      <p className="text-xs text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted mt-1">{subtitle}</p>
    </div>
  );
}

function DistBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted w-28 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-background rounded overflow-hidden">
        <div className={`h-full rounded ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums w-8 text-right">{count}</span>
    </div>
  );
}
