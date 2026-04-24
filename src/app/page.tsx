'use client';

import { useEffect, useMemo, useState } from 'react';
import { startOfWeek, subWeeks, format } from 'date-fns';
import { CLIENTS } from '@/lib/constants';
import type { HealthCardEntry } from '@/lib/manifest';
import { HealthTile } from '@/components/health-tile';
import { StatusLegend } from '@/components/status-legend';
import { assetPath } from '@/lib/paths';

interface Manifest {
  generatedAt: string;
  clients: Record<string, Record<string, HealthCardEntry>>;
}

export default function Dashboard() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(assetPath('/data/fathom/signals.json'))
      .then(r => (r.ok ? r.json() : null))
      .then(data => setManifest(data))
      .catch(() => setManifest(null))
      .finally(() => setLoaded(true));
  }, []);

  const { rows, currentWeek, priorWeek, scoredCount, avgHealth } = useMemo(() => {
    if (!manifest) {
      return { rows: [], currentWeek: null, priorWeek: null, scoredCount: 0, avgHealth: null };
    }

    // Anchor "current week" to the last complete Monday (lagged by 1 week).
    // Profound lags the in-progress week, so this alignment lets every
    // client's tile show the same week with maximum data coverage.
    const lastComplete = format(
      startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    );
    const priorComplete = format(
      startOfWeek(subWeeks(new Date(), 2), { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    );
    const currentWeek = lastComplete;
    const priorWeek = priorComplete;

    const rows = CLIENTS.map(client => {
      const perWeek = manifest.clients[client.id] ?? {};
      const current = currentWeek ? perWeek[currentWeek] ?? null : null;
      const prior = priorWeek ? perWeek[priorWeek] ?? null : null;
      return { client, current, prior };
    });

    // Sort: scored first (RED > YELLOW > GREEN > unscored)
    rows.sort((a, b) => {
      const ah = a.current?.partialHealth ?? null;
      const bh = b.current?.partialHealth ?? null;
      if (ah === null && bh === null) return 0;
      if (ah === null) return 1;
      if (bh === null) return -1;
      return ah - bh; // lower health first
    });

    const healths = rows
      .map(r => r.current?.partialHealth)
      .filter((h): h is number => typeof h === 'number');
    const scoredCount = healths.length;
    const avgHealth = scoredCount
      ? Math.round(healths.reduce((a, b) => a + b, 0) / scoredCount)
      : null;

    return { rows, currentWeek, priorWeek, scoredCount, avgHealth };
  }, [manifest]);

  if (!loaded) return <div className="text-muted text-sm">Loading…</div>;

  if (!manifest) {
    return (
      <div className="border border-border rounded-lg p-8 text-center">
        <p className="text-sm text-muted">
          No signals manifest found. Run{' '}
          <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">
            npm run fathom:sync
          </code>{' '}
          to generate one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-1">
            Week of {currentWeek ?? '—'} · {CLIENTS.length} clients
            {scoredCount > 0 && <> · {scoredCount} scored</>}
            {avgHealth !== null && (
              <>
                {' '}
                · Avg partial health: <span className="font-medium">{avgHealth}</span>
              </>
            )}
          </p>
        </div>
        <span className="text-xs text-muted font-mono">
          Fathom + Profound + Harvest
        </span>
      </div>

      <StatusLegend />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(({ client, current, prior }) => (
          <HealthTile key={client.id} client={client} current={current} prior={prior} />
        ))}
      </div>

      <p className="text-[11px] text-muted mt-8 max-w-2xl">
        Partial health uses all 5 dimensions: Client Happiness, Execution Discipline, and Internal
        Momentum (Fathom transcripts), Results Delivered (Profound: share of voice, citation share,
        visibility, sentiment), and Capacity Fit (Harvest hours per $1k MRR vs portfolio median).
        Weights are renormalized across whichever dimensions have data that week.
      </p>
    </div>
  );
}
