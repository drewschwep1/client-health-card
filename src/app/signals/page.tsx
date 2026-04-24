'use client';

import { useEffect, useMemo, useState } from 'react';
import { CLIENTS } from '@/lib/constants';
import type { HealthCardEntry } from '@/lib/manifest';
import { assetPath } from '@/lib/paths';

interface Manifest {
  generatedAt: string;
  clients: Record<string, Record<string, HealthCardEntry>>;
}

export default function SignalsPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch(assetPath('/data/fathom/signals.json'))
      .then(r => (r.ok ? r.json() : null))
      .then(data => setManifest(data))
      .catch(() => setManifest(null))
      .finally(() => setLoaded(true));
  }, []);

  const perClient = useMemo(() => {
    if (!manifest) return [];
    return CLIENTS.map(c => {
      const weeks = manifest.clients[c.id] ?? {};
      const weekKeys = Object.keys(weeks).sort().reverse();
      const latest = weekKeys[0] ? weeks[weekKeys[0]] : null;
      return { client: c, latest, weekKeys, weeks };
    });
  }, [manifest]);

  if (!loaded) return <div className="text-muted text-sm">Loading signals…</div>;
  if (!manifest) {
    return (
      <div className="border border-border rounded-lg p-6 text-sm text-muted">
        No signals manifest found. Run <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">npm run fathom:sync</code> to generate one.
      </div>
    );
  }

  const withData = perClient.filter(p => p.latest !== null);
  const withoutData = perClient.filter(p => p.latest === null);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fathom Signals</h1>
          <p className="text-sm text-muted mt-1">
            {withData.length} of {CLIENTS.length} clients have recent calls &middot; manifest built{' '}
            {new Date(manifest.generatedAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {withData
          .sort((a, b) =>
            (b.latest?.weekStart ?? '').localeCompare(a.latest?.weekStart ?? '')
          )
          .map(({ client, latest, weekKeys, weeks }) => {
            const isOpen = expanded === client.id;
            return (
              <div key={client.id} className="border border-border rounded-lg bg-card overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : client.id)}
                  className="w-full text-left px-5 py-4 hover:bg-background/50 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <h2 className="font-semibold text-sm">{client.name}</h2>
                      <p className="text-xs text-muted">{client.vertical}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <Stat
                      label="Happiness"
                      value={latest!.suggestedHappinessScore?.toFixed(1) ?? '—'}
                    />
                    <Stat label="Wins" value={latest!.weeklyWins.length.toString()} />
                    <Stat label="Concerns" value={latest!.concerns.length.toString()} />
                    <Stat label="Calls" value={latest!.meetingCount.toString()} />
                    <span className="text-xs text-muted font-mono w-20 text-right">
                      {latest!.weekStart.slice(5)}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-background/30 px-5 py-4 space-y-4">
                    {weekKeys.map(wk => {
                      const w = weeks[wk];
                      return (
                        <div key={wk}>
                          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
                            Week of {wk} · {w.meetingCount} call{w.meetingCount === 1 ? '' : 's'}
                          </p>
                          {w.weekSummary && (
                            <div className="mb-3 p-3 rounded-lg bg-accent-light border border-accent/20 space-y-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-accent font-semibold mb-1">
                                  Week in a tweet
                                </p>
                                <p className="text-sm leading-relaxed">{w.weekSummary.tweet}</p>
                              </div>
                              {w.weekSummary.topWin && (
                                <div className="flex gap-2 text-sm leading-relaxed">
                                  <span className="text-green font-semibold shrink-0">Win</span>
                                  <span>{w.weekSummary.topWin}</span>
                                </div>
                              )}
                              {w.weekSummary.topRisk && (
                                <div className="flex gap-2 text-sm leading-relaxed">
                                  <span className="text-red font-semibold shrink-0">Risk</span>
                                  <span>{w.weekSummary.topRisk}</span>
                                </div>
                              )}
                            </div>
                          )}
                          <ul className="text-[11px] text-muted mb-3 space-y-0.5">
                            {w.meetings.map(m => (
                              <li key={m.recordingId}>
                                {m.date.slice(0, 10)} · {m.title}
                              </li>
                            ))}
                          </ul>
                          <Section title="Weekly wins" items={w.weeklyWins} tone="positive" />
                          <Section title="Concerns" items={w.concerns} tone="negative" />
                          <Section
                            title="Proactivity signals"
                            items={w.proactivitySignals}
                            tone="neutral"
                          />
                          {w.rawEvidence.length > 0 && (
                            <details className="mt-3">
                              <summary className="text-xs text-muted cursor-pointer hover:text-foreground">
                                Raw evidence ({w.rawEvidence.length} quotes)
                              </summary>
                              <ul className="mt-2 space-y-1.5 text-xs">
                                {w.rawEvidence.map((e, i) => (
                                  <li key={i} className="border-l-2 border-border pl-3">
                                    <p className="italic">&ldquo;{e.quote}&rdquo;</p>
                                    <p className="text-muted mt-0.5">
                                      — {e.speaker} ·{' '}
                                      <span className="font-mono">{e.dimensionId}</span>
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

        {withoutData.length > 0 && (
          <div className="mt-8 pt-6 border-t border-border">
            <p className="text-xs text-muted uppercase tracking-wide mb-3">
              No recent Fathom calls ({withoutData.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {withoutData.map(p => (
                <span
                  key={p.client.id}
                  className="text-xs px-2 py-1 rounded bg-card border border-border text-muted"
                >
                  {p.client.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right w-16">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'positive' | 'negative' | 'neutral';
}) {
  if (items.length === 0) return null;
  const styles =
    tone === 'positive'
      ? {
          heading: 'text-green',
          item: 'border-l-2 border-green/50 bg-green-bg/40 pl-3 py-1',
        }
      : tone === 'negative'
        ? {
            heading: 'text-red',
            item: 'border-l-2 border-red/50 bg-red-bg/40 pl-3 py-1',
          }
        : {
            heading: 'text-muted',
            item: 'border-l-2 border-border pl-3 py-1',
          };
  return (
    <div className="mb-4">
      <p className={`text-xs uppercase tracking-wide mb-2 font-medium ${styles.heading}`}>
        {title}
      </p>
      <ul className="text-sm space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className={`leading-relaxed rounded-r ${styles.item}`}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
