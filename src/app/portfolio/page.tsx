'use client';

import { useEffect, useMemo, useState } from 'react';
import { startOfWeek, subWeeks, format } from 'date-fns';
import {
  CLIENTS,
  CLIENT_METADATA,
  DIMENSIONS,
  getHealthStatus,
  STATUS_MEANING,
  type ClientId,
  type DimensionId,
  type HealthStatus,
} from '@/lib/constants';
import type { HealthCardEntry } from '@/lib/manifest';
import { assetPath } from '@/lib/paths';

interface Manifest {
  generatedAt: string;
  clients: Record<string, Record<string, HealthCardEntry>>;
}

const STATUS_ORDER: HealthStatus[] = ['RED', 'YELLOW', 'GREEN', 'BLUE', 'EMPTY'];
const STATUS_BAR: Record<HealthStatus, string> = {
  GREEN: 'bg-green',
  YELLOW: 'bg-yellow',
  RED: 'bg-red',
  BLUE: 'bg-accent',
  EMPTY: 'bg-border',
};

export default function PortfolioPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(assetPath('/data/fathom/signals.json'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => setManifest(d))
      .catch(() => setManifest(null))
      .finally(() => setLoaded(true));
  }, []);

  const data = useMemo(() => {
    if (!manifest) return null;

    const currentWeek = format(
      startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    );
    const weeks = Array.from({ length: 6 }, (_, i) =>
      format(startOfWeek(subWeeks(new Date(), i + 1), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    ).reverse();

    const rows = CLIENTS.map(c => {
      const perWeek = manifest.clients[c.id] ?? {};
      const entry = perWeek[currentWeek] ?? null;
      return { client: c, entry };
    });

    // Status distribution
    const statusCount: Record<HealthStatus, number> = {
      GREEN: 0,
      YELLOW: 0,
      RED: 0,
      BLUE: 0,
      EMPTY: 0,
    };
    for (const r of rows) {
      const h = r.entry?.partialHealth ?? null;
      const covered = r.entry?.coveredDimensions.length ?? 0;
      statusCount[getHealthStatus(h, covered)]++;
    }

    // Portfolio-avg health across clients with any data
    const healths = rows
      .map(r => r.entry?.partialHealth)
      .filter((h): h is number => typeof h === 'number');
    const avgHealth = healths.length
      ? Math.round(healths.reduce((a, b) => a + b, 0) / healths.length)
      : null;

    // Per-dimension portfolio avg
    const dimAvg: Partial<Record<DimensionId, number | null>> = {};
    for (const dim of DIMENSIONS) {
      const vals = rows
        .map(r => r.entry?.dimScores?.[dim.id])
        .filter((v): v is number => typeof v === 'number');
      dimAvg[dim.id] = vals.length
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : null;
    }

    // Weekly trend — portfolio avg health per week
    const trend = weeks.map(wk => {
      const vals: number[] = [];
      for (const c of CLIENTS) {
        const h = manifest.clients[c.id]?.[wk]?.partialHealth;
        if (typeof h === 'number') vals.push(h);
      }
      return {
        week: wk,
        avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        count: vals.length,
      };
    });

    // Revenue-at-risk: sum of monthlyValue for RED clients
    let totalMRR = 0;
    let revenueAtRisk = 0;
    for (const r of rows) {
      const meta = CLIENT_METADATA[r.client.id as ClientId];
      if (!meta?.monthlyValue) continue;
      totalMRR += meta.monthlyValue;
      const status = getHealthStatus(
        r.entry?.partialHealth ?? null,
        r.entry?.coveredDimensions.length ?? 0
      );
      if (status === 'RED') revenueAtRisk += meta.monthlyValue;
    }

    return {
      currentWeek,
      rows,
      statusCount,
      avgHealth,
      dimAvg,
      trend,
      totalMRR,
      revenueAtRisk,
    };
  }, [manifest]);

  if (!loaded) return <div className="text-muted text-sm">Loading…</div>;
  if (!manifest || !data) {
    return (
      <div className="border border-border rounded-lg p-8 text-center text-sm text-muted">
        No manifest. Run <code className="font-mono">npm run fathom:sync</code> first.
      </div>
    );
  }

  const total = CLIENTS.length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted mt-1">
          Aggregate view — week of {data.currentWeek}
        </p>
      </div>

      {/* Top-line stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Avg Health"
          value={data.avgHealth !== null ? data.avgHealth.toString() : '—'}
          subtitle={`${CLIENTS.length} clients tracked`}
        />
        <StatCard
          label="At Risk"
          value={data.statusCount.RED.toString()}
          subtitle={`${pct(data.statusCount.RED, total)}% of portfolio`}
          accent="red"
        />
        <StatCard
          label="On Track"
          value={(data.statusCount.YELLOW + data.statusCount.GREEN).toString()}
          subtitle={`${data.statusCount.GREEN} healthy, ${data.statusCount.YELLOW} yellow`}
          accent="green"
        />
        <StatCard
          label="Partial Data"
          value={(data.statusCount.BLUE + data.statusCount.EMPTY).toString()}
          subtitle={`${data.statusCount.BLUE} partial, ${data.statusCount.EMPTY} empty`}
          accent="blue"
        />
      </div>

      {data.totalMRR > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <StatCard
            label="Total MRR tracked"
            value={`$${(data.totalMRR / 1000).toFixed(1)}k`}
            subtitle="Across clients with contract value set"
          />
          <StatCard
            label="Revenue at Risk"
            value={`$${(data.revenueAtRisk / 1000).toFixed(1)}k`}
            subtitle={`${pct(data.revenueAtRisk, data.totalMRR)}% of tracked MRR in RED`}
            accent={data.revenueAtRisk > 0 ? 'red' : undefined}
          />
        </div>
      )}

      {/* Distribution bars */}
      <div className="border border-border rounded-lg bg-card p-5 mb-8">
        <h2 className="text-sm font-semibold mb-3">Distribution</h2>
        <div className="space-y-2">
          {STATUS_ORDER.map(status => {
            const count = data.statusCount[status];
            return (
              <DistBar
                key={status}
                label={STATUS_MEANING[status].label}
                count={count}
                total={total}
                colorClass={STATUS_BAR[status]}
              />
            );
          })}
        </div>
      </div>

      {/* Per-dimension portfolio avg */}
      <div className="border border-border rounded-lg bg-card p-5 mb-8">
        <h2 className="text-sm font-semibold mb-4">Portfolio scores by dimension</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {DIMENSIONS.map(dim => {
            const avg = data.dimAvg[dim.id];
            const score = typeof avg === 'number' ? avg : null;
            const colorClass =
              score === null
                ? 'bg-background text-muted'
                : score >= 4
                  ? 'bg-green-bg text-green'
                  : score >= 3
                    ? 'bg-yellow-bg text-yellow'
                    : 'bg-red-bg text-red';
            return (
              <div
                key={dim.id}
                className={`rounded-lg p-3 text-center ${colorClass}`}
                title={dim.signal}
              >
                <p className="text-[10px] uppercase tracking-wide opacity-70">{dim.name}</p>
                <p className="text-2xl font-bold tabular-nums mt-1">
                  {score !== null ? score.toFixed(1) : '—'}
                </p>
                <p className="text-[10px] opacity-60 mt-0.5">avg · weight {Math.round(dim.weight * 100)}%</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trend */}
      <div className="border border-border rounded-lg bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">6-week portfolio trend</h2>
        <div className="flex items-end gap-3 h-32">
          {data.trend.map(({ week, avg, count }) => (
            <div key={week} className="flex-1 flex flex-col items-center gap-2">
              {avg !== null ? (
                <>
                  <span className="text-xs font-mono tabular-nums">{avg}</span>
                  <div
                    className={`w-full rounded-t ${
                      avg >= 80 ? 'bg-green' : avg >= 60 ? 'bg-yellow' : 'bg-red'
                    }`}
                    style={{ height: `${(avg / 100) * 100}%`, minHeight: '8px' }}
                    title={`${count} clients`}
                  />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs text-muted">—</span>
                </div>
              )}
              <span className="text-[10px] text-muted font-mono">{week.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function pct(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 100);
}

function StatCard({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle: string;
  accent?: 'red' | 'yellow' | 'green' | 'blue';
}) {
  const accentStyles: Record<string, string> = {
    red: 'border-red/20 bg-red-bg',
    yellow: 'border-yellow/20 bg-yellow-bg',
    green: 'border-green/20 bg-green-bg',
    blue: 'border-accent/20 bg-accent-light',
  };
  return (
    <div
      className={`border rounded-lg p-4 ${
        accent ? accentStyles[accent] : 'border-border bg-card'
      }`}
    >
      <p className="text-xs text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted mt-1">{subtitle}</p>
    </div>
  );
}

function DistBar({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const p = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted w-28 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-background rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${colorClass}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums w-8 text-right">{count}</span>
    </div>
  );
}
