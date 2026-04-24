'use client';

import { useEffect, useMemo, useState } from 'react';
import { startOfWeek, subWeeks, format, parseISO, differenceInDays } from 'date-fns';
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

const STATUS_BADGE: Record<HealthStatus, { dot: string; text: string }> = {
  GREEN: { dot: 'bg-green', text: 'text-green' },
  YELLOW: { dot: 'bg-yellow', text: 'text-yellow' },
  RED: { dot: 'bg-red', text: 'text-red' },
  BLUE: { dot: 'bg-accent', text: 'text-accent' },
  EMPTY: { dot: 'bg-border', text: 'text-muted' },
};

export default function ClientsPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(assetPath('/data/fathom/signals.json'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => setManifest(d))
      .catch(() => setManifest(null))
      .finally(() => setLoaded(true));
  }, []);

  const rows = useMemo(() => {
    const currentWeek = format(
      startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }),
      'yyyy-MM-dd'
    );
    return CLIENTS.map(c => {
      const perWeek = manifest?.clients[c.id] ?? {};
      const entry = perWeek[currentWeek] ?? null;
      const meta = CLIENT_METADATA[c.id as ClientId] ?? {};
      const health = entry?.partialHealth ?? null;
      const covered = entry?.coveredDimensions.length ?? 0;
      const status = getHealthStatus(health, covered);
      return { client: c, entry, meta, status };
    });
  }, [manifest]);

  if (!loaded) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted mt-1">
          {CLIENTS.length} active · Contract + QBR metadata populated via{' '}
          <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">
            CLIENT_METADATA
          </code>{' '}
          in constants.ts
        </p>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <Th>Client</Th>
              <Th>Vertical</Th>
              <Th align="center">ICP</Th>
              <Th align="center">Health</Th>
              <Th align="center">Status</Th>
              {DIMENSIONS.map(d => (
                <Th key={d.id} align="center" title={d.name}>
                  {SHORT_DIM[d.id] ?? d.name.slice(0, 4)}
                </Th>
              ))}
              <Th align="right">MRR</Th>
              <Th align="center">Next QBR</Th>
              <Th>Lead</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ client, entry, meta, status }) => {
              const badge = STATUS_BADGE[status];
              const meaning = STATUS_MEANING[status];
              const nextQBR = meta.nextQBR ? daysUntil(meta.nextQBR) : null;
              return (
                <tr
                  key={client.id}
                  className="border-b border-border last:border-0 hover:bg-background/50 transition-colors"
                >
                  <Td>
                    <span className="font-medium">{client.name}</span>
                    {meta.contractStatus && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                        {meta.contractStatus}
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted text-xs">{client.vertical}</Td>
                  <Td align="center">
                    <span
                      className={`inline-block w-6 h-6 rounded text-xs font-medium leading-6 ${
                        client.icpFit === 'Y'
                          ? 'bg-green-bg text-green'
                          : client.icpFit === 'N'
                            ? 'bg-red-bg text-red'
                            : 'bg-background text-muted'
                      }`}
                    >
                      {client.icpFit}
                    </span>
                  </Td>
                  <Td align="center" className="font-mono tabular-nums font-semibold">
                    {entry?.partialHealth ?? '—'}
                  </Td>
                  <Td align="center">
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={meaning.description}
                    >
                      <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                      <span className={`text-[10px] font-medium ${badge.text}`}>
                        {meaning.label}
                      </span>
                    </span>
                  </Td>
                  {DIMENSIONS.map(d => {
                    const s = entry?.dimScores?.[d.id];
                    const display = typeof s === 'number' ? s.toFixed(1) : '—';
                    const color =
                      typeof s !== 'number'
                        ? 'text-muted'
                        : s >= 3.5
                          ? 'text-green'
                          : s >= 2.5
                            ? 'text-yellow'
                            : 'text-red';
                    return (
                      <Td key={d.id} align="center">
                        <span className={`font-mono tabular-nums text-xs ${color}`}>
                          {display}
                        </span>
                      </Td>
                    );
                  })}
                  <Td align="right" className="font-mono tabular-nums text-xs">
                    {meta.monthlyValue ? `$${(meta.monthlyValue / 1000).toFixed(1)}k` : '—'}
                  </Td>
                  <Td align="center" className="text-xs">
                    {meta.nextQBR ? (
                      <span
                        className={`font-mono ${
                          nextQBR !== null && nextQBR < 0
                            ? 'text-red'
                            : nextQBR !== null && nextQBR < 30
                              ? 'text-yellow'
                              : 'text-muted'
                        }`}
                        title={`QBR scheduled for ${meta.nextQBR}`}
                      >
                        {nextQBR !== null
                          ? nextQBR < 0
                            ? `${Math.abs(nextQBR)}d overdue`
                            : `${nextQBR}d`
                          : '—'}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{meta.accountLead ?? '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted mt-4 max-w-2xl">
        MRR, Next QBR, and Account Lead come from{' '}
        <code className="font-mono text-xs bg-background px-1 rounded">CLIENT_METADATA</code>{' '}
        — populate it per client to light up these columns.
      </p>
    </div>
  );
}

const SHORT_DIM: Record<DimensionId, string> = {
  'client-happiness': 'Happy',
  'results-delivered': 'Results',
  'execution-discipline': 'Exec',
  'capacity-fit': 'Capacity',
  'internal-momentum': 'Momentum',
};

function daysUntil(iso: string): number | null {
  try {
    return differenceInDays(parseISO(iso), new Date());
  } catch {
    return null;
  }
}

function Th({
  children,
  align,
  title,
}: {
  children: React.ReactNode;
  align?: 'center' | 'right';
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-3 py-3 font-medium text-muted text-[10px] uppercase tracking-wide ${
        align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className = '',
}: {
  children: React.ReactNode;
  align?: 'center' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-3 ${
        align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </td>
  );
}
