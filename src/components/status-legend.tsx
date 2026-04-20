'use client';

import { STATUS_MEANING, type HealthStatus } from '@/lib/constants';

const STATUS_BADGE: Record<HealthStatus, { dot: string; label: string }> = {
  GREEN: { dot: 'bg-green', label: 'text-green' },
  YELLOW: { dot: 'bg-yellow', label: 'text-yellow' },
  RED: { dot: 'bg-red', label: 'text-red' },
  BLUE: { dot: 'bg-accent', label: 'text-accent' },
  EMPTY: { dot: 'bg-border', label: 'text-muted' },
};

const ORDERED: HealthStatus[] = ['GREEN', 'YELLOW', 'RED', 'BLUE', 'EMPTY'];

export function StatusLegend() {
  return (
    <div className="border border-border rounded-lg bg-card px-4 py-3 mb-6">
      <p className="text-[10px] uppercase tracking-wide text-muted mb-2 font-medium">
        What these colors mean
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {ORDERED.map(status => {
          const meta = STATUS_MEANING[status];
          const badge = STATUS_BADGE[status];
          return (
            <div key={status} className="flex items-start gap-2 text-xs">
              <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${badge.dot}`} />
              <div>
                <p className={`font-semibold ${badge.label}`}>{meta.label}</p>
                <p className="text-[11px] text-muted leading-snug">{meta.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
