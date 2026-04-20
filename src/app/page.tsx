'use client';

import { useEffect, useState } from 'react';
import { CLIENTS } from '@/lib/constants';
import { getAllScores, getCurrentWeekStart, WeeklyScore } from '@/lib/store';
import { HealthTile } from '@/components/health-tile';

export default function Dashboard() {
  const [scores, setScores] = useState<WeeklyScore[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setScores(getAllScores());
    setLoaded(true);
  }, []);

  const currentWeek = getCurrentWeekStart();
  const currentScores = scores.filter(s => s.weekStart === currentWeek);
  const priorScores = scores.filter(s => s.weekStart !== currentWeek)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  const clientsWithScores = CLIENTS.map(client => {
    const current = currentScores.find(s => s.clientId === client.id);
    const prior = priorScores.find(s => s.clientId === client.id);
    return { client, current, prior };
  });

  // Scored clients sorted by risk (RED first), then unscored at the end
  const sorted = clientsWithScores.sort((a, b) => {
    const order = { RED: 0, YELLOW: 1, GREEN: 2 };
    const aRisk = a.current?.risk;
    const bRisk = b.current?.risk;
    if (!aRisk && !bRisk) return 0;
    if (!aRisk) return 1;
    if (!bRisk) return -1;
    return order[aRisk] - order[bRisk];
  });

  const scoredCount = currentScores.length;
  const avgHealth = scoredCount > 0
    ? Math.round(currentScores.reduce((s, c) => s + c.health, 0) / scoredCount)
    : null;

  if (!loaded) return <div className="text-muted text-sm">Loading...</div>;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-1">
            Week of {currentWeek} &middot; {CLIENTS.length} clients
            {scoredCount > 0 && <> &middot; {scoredCount} scored</>}
            {avgHealth !== null && <> &middot; Avg health: <span className="font-medium">{avgHealth}</span></>}
          </p>
        </div>
        <span className="text-xs text-muted font-mono">Auto-scored from Fathom, Slack, email, Profound</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map(({ client, current, prior }) => (
          <HealthTile
            key={client.id}
            client={client}
            current={current}
            prior={prior}
          />
        ))}
      </div>
    </div>
  );
}
