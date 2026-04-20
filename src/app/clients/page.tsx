'use client';

import { useEffect, useState } from 'react';
import { CLIENTS } from '@/lib/constants';
import { getLatestScore, WeeklyScore } from '@/lib/store';

export default function ClientsPage() {
  const [latestScores, setLatestScores] = useState<Record<string, WeeklyScore | undefined>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const scores: Record<string, WeeklyScore | undefined> = {};
    CLIENTS.forEach(c => {
      scores[c.id] = getLatestScore(c.id);
    });
    setLatestScores(scores);
    setLoaded(true);
  }, []);

  if (!loaded) return <div className="text-muted text-sm">Loading...</div>;

  const riskDotStyles = {
    GREEN: 'bg-green',
    YELLOW: 'bg-yellow',
    RED: 'bg-red',
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted mt-1">{CLIENTS.length} active clients</p>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wide">Client</th>
              <th className="text-left px-4 py-3 font-medium text-muted text-xs uppercase tracking-wide">Vertical</th>
              <th className="text-center px-4 py-3 font-medium text-muted text-xs uppercase tracking-wide">ICP</th>
              <th className="text-center px-4 py-3 font-medium text-muted text-xs uppercase tracking-wide">Health</th>
              <th className="text-center px-4 py-3 font-medium text-muted text-xs uppercase tracking-wide">Risk</th>
            </tr>
          </thead>
          <tbody>
            {CLIENTS.map(client => {
              const score = latestScores[client.id];
              return (
                <tr key={client.id} className="border-b border-border last:border-0 hover:bg-background/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{client.name}</td>
                  <td className="px-4 py-3 text-muted">{client.vertical}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-6 h-6 rounded text-xs font-medium leading-6 ${
                      client.icpFit === 'Y' ? 'bg-green-bg text-green'
                        : client.icpFit === 'N' ? 'bg-red-bg text-red'
                        : 'bg-background text-muted'
                    }`}>
                      {client.icpFit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono tabular-nums">
                    {score ? Math.round(score.health) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {score ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${riskDotStyles[score.risk]}`} />
                        <span className="text-xs">{score.risk}</span>
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
