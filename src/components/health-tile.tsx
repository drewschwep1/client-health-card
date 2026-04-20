'use client';

import { WeeklyScore } from '@/lib/store';
import { CLIENTS } from '@/lib/constants';

type Client = typeof CLIENTS[number];

interface Props {
  client: Client;
  current?: WeeklyScore;
  prior?: WeeklyScore;
}

export function HealthTile({ client, current, prior }: Props) {
  const riskStyles = {
    GREEN: 'border-green/20 bg-green-bg',
    YELLOW: 'border-yellow/20 bg-yellow-bg',
    RED: 'border-red/20 bg-red-bg',
  };

  const riskDotStyles = {
    GREEN: 'bg-green',
    YELLOW: 'bg-yellow',
    RED: 'bg-red',
  };

  const riskTextStyles = {
    GREEN: 'text-green',
    YELLOW: 'text-yellow',
    RED: 'text-red',
  };

  const delta = current && prior ? Math.round(current.health - prior.health) : null;

  return (
    <div className={`border rounded-lg p-5 transition-all ${
      current ? riskStyles[current.risk] : 'border-border bg-card'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm">{client.name}</h3>
          <p className="text-xs text-muted mt-0.5">{client.vertical}</p>
        </div>
        {current && (
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${riskDotStyles[current.risk]}`} />
            <span className={`text-xs font-medium ${riskTextStyles[current.risk]}`}>
              {current.risk}
            </span>
          </div>
        )}
      </div>

      {current ? (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-semibold tabular-nums">{Math.round(current.health)}</span>
            <span className="text-xs text-muted">/100</span>
            {delta !== null && delta !== 0 && (
              <span className={`text-xs font-medium ${delta > 0 ? 'text-green' : 'text-red'}`}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            )}
          </div>
          {current.tweet && (
            <p className="text-xs text-muted leading-relaxed line-clamp-2">{current.tweet}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted italic">Not scored this week</p>
      )}
    </div>
  );
}
