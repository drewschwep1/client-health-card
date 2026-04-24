'use client';

import {
  CLIENTS,
  DIMENSIONS,
  getHealthStatus,
  STATUS_MEANING,
  type DimensionId,
  type HealthStatus,
} from '@/lib/constants';
import type { HealthCardEntry } from '@/lib/manifest';

type Client = typeof CLIENTS[number];

interface Props {
  client: Client;
  current: HealthCardEntry | null;
  prior: HealthCardEntry | null;
}

const DIM_LABEL: Record<DimensionId, string> = Object.fromEntries(
  DIMENSIONS.map(d => [d.id, d.name])
) as Record<DimensionId, string>;

const DIM_SHORT: Record<DimensionId, string> = {
  'client-happiness': 'Happy',
  'results-delivered': 'Results',
  'execution-discipline': 'Exec',
  'capacity-fit': 'Capacity',
  'internal-momentum': 'Momentum',
};

// Empty — every dimension now has a wired data source. Clients without a
// score for a given dim render as "—" via the null-handling below.
const PENDING_DIMS: readonly DimensionId[] = [] as const;

// 1-5 score → color band. Matches the rubric's narrative: 1-2 = bad (red),
// 3 = neutral (yellow), 4-5 = strong (green). The 2-tone split on either
// side gives a visible gradient within red/green bands.
function scoreColor(score: number | null | undefined): {
  text: string;
  bg: string;
  dot: string;
} {
  if (score === null || score === undefined) {
    return { text: 'text-muted', bg: 'bg-background', dot: 'bg-border' };
  }
  if (score >= 4.5) return { text: 'text-green', bg: 'bg-green-bg', dot: 'bg-green' };
  if (score >= 3.5) return { text: 'text-green', bg: 'bg-green-bg/60', dot: 'bg-green' };
  if (score >= 2.5) return { text: 'text-yellow', bg: 'bg-yellow-bg', dot: 'bg-yellow' };
  if (score >= 1.5) return { text: 'text-red', bg: 'bg-red-bg/60', dot: 'bg-red' };
  return { text: 'text-red', bg: 'bg-red-bg', dot: 'bg-red' };
}

const STATUS_TILE: Record<HealthStatus, { border: string; dot: string; text: string }> = {
  GREEN: { border: 'border-green/20 bg-green-bg', dot: 'bg-green', text: 'text-green' },
  YELLOW: { border: 'border-yellow/20 bg-yellow-bg', dot: 'bg-yellow', text: 'text-yellow' },
  RED: { border: 'border-red/20 bg-red-bg', dot: 'bg-red', text: 'text-red' },
  BLUE: { border: 'border-accent/20 bg-accent-light', dot: 'bg-accent', text: 'text-accent' },
  EMPTY: { border: 'border-border bg-card', dot: 'bg-border', text: 'text-muted' },
};

export function HealthTile({ client, current, prior }: Props) {
  const health = current?.partialHealth ?? null;
  const coveredCount = current?.coveredDimensions.length ?? 0;
  const status: HealthStatus = getHealthStatus(health, coveredCount);
  const tile = STATUS_TILE[status];

  const priorHealth = prior?.partialHealth ?? null;
  const delta =
    health !== null && priorHealth !== null ? Math.round(health - priorHealth) : null;

  const topWin = current?.weeklyWins?.[0] ?? null;

  return (
    <div
      className={`border rounded-lg p-5 transition-all ${tile.border}`}
      title={STATUS_MEANING[status].description}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm">{client.name}</h3>
          <p className="text-xs text-muted mt-0.5">{client.vertical}</p>
        </div>
        {status !== 'EMPTY' && (
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${tile.dot}`} />
            <span className={`text-xs font-medium ${tile.text}`}>
              {STATUS_MEANING[status].label}
            </span>
          </div>
        )}
      </div>

      {health !== null && current ? (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-semibold tabular-nums">{health}</span>
            <span className="text-xs text-muted">/100</span>
            {delta !== null && delta !== 0 && (
              <span className={`text-xs font-medium ${delta > 0 ? 'text-green' : 'text-red'}`}>
                {delta > 0 ? '+' : ''}
                {delta}
              </span>
            )}
            <span className="ml-auto text-[10px] uppercase tracking-wide text-muted font-mono">
              {coveredCount}/5 dims
            </span>
          </div>

          <DimScoreRow current={current} />

          {current.profound && (
            <ProfoundCallout current={current} />
          )}

          {current.harvest && current.harvest.hoursThisWeek > 0 && (
            <HarvestCallout current={current} />
          )}

          {current.weekSummary ? (
            <div className="mt-3 pt-2 border-t border-border/60 space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted mb-1">
                  Week in a tweet
                </p>
                <p className="text-xs leading-relaxed">{current.weekSummary.tweet}</p>
              </div>
              {current.weekSummary.topWin && (
                <div className="flex gap-2 text-xs leading-relaxed">
                  <span className="text-green font-semibold shrink-0">Win</span>
                  <span>{current.weekSummary.topWin}</span>
                </div>
              )}
              {current.weekSummary.topRisk && (
                <div className="flex gap-2 text-xs leading-relaxed">
                  <span className="text-red font-semibold shrink-0">Risk</span>
                  <span>{current.weekSummary.topRisk}</span>
                </div>
              )}
            </div>
          ) : (
            topWin && (
              <p className="text-xs text-muted leading-relaxed line-clamp-2 mt-2">
                &ldquo;{topWin}&rdquo;
              </p>
            )
          )}

          <p className="text-[10px] text-muted mt-2">
            {current.meetingCount} call{current.meetingCount === 1 ? '' : 's'} this week ·{' '}
            <span className={(current.weeklyWins?.length ?? 0) > 0 ? 'text-green' : ''}>
              {(current.weeklyWins?.length ?? 0)} win{(current.weeklyWins?.length ?? 0) === 1 ? '' : 's'}
            </span>{' '}
            ·{' '}
            <span className={(current.concerns?.length ?? 0) > 0 ? 'text-red' : ''}>
              {(current.concerns?.length ?? 0)} concern{(current.concerns?.length ?? 0) === 1 ? '' : 's'}
            </span>
          </p>
        </>
      ) : (
        <p className="text-xs text-muted italic">No data this week</p>
      )}
    </div>
  );
}

function DimScoreRow({ current }: { current: HealthCardEntry }) {
  return (
    <div className="flex gap-1.5 mt-2 text-[10px] font-mono tabular-nums">
      {DIMENSIONS.map(dim => {
        const score = current.dimScores?.[dim.id];
        const hasScore = typeof score === 'number';
        const pending = (PENDING_DIMS as readonly string[]).includes(dim.id);
        const label = DIM_SHORT[dim.id] ?? DIM_LABEL[dim.id];
        const colors = pending ? scoreColor(null) : scoreColor(hasScore ? (score as number) : null);
        const display = hasScore ? (score as number).toFixed(1) : '—';
        return (
          <div
            key={dim.id}
            title={
              pending
                ? `${DIM_LABEL[dim.id]} — pending external data source`
                : hasScore
                  ? `${DIM_LABEL[dim.id]}: ${display}/5`
                  : `${DIM_LABEL[dim.id]}: no data`
            }
            className={`flex flex-col items-center rounded px-1 py-1 flex-1 ${colors.bg} ${
              pending ? 'opacity-50' : ''
            }`}
          >
            <span className={`${colors.text} opacity-80`}>{label}</span>
            <span className={`font-bold text-[11px] ${colors.text}`}>{display}</span>
            <ScoreScale score={hasScore ? (score as number) : null} pending={pending} />
          </div>
        );
      })}
    </div>
  );
}

// 5-dot mini-scale showing where the score lands on 1-5.
function ScoreScale({ score, pending }: { score: number | null; pending: boolean }) {
  const filled = score === null ? 0 : Math.round(score);
  const colors = scoreColor(score);
  return (
    <div className="flex gap-0.5 mt-1">
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          className={`w-1 h-1 rounded-full ${
            pending
              ? 'bg-border'
              : n <= filled
                ? colors.dot
                : 'bg-border/60'
          }`}
        />
      ))}
    </div>
  );
}

function HarvestCallout({ current }: { current: HealthCardEntry }) {
  const h = current.harvest;
  if (!h) return null;
  const hours = h.hoursThisWeek.toFixed(1);
  const rawTotal = h.snapshot?.totalHours;
  const wow = h.hoursWowDelta;
  const wowLabel =
    wow === null || Math.abs(wow) < 0.05
      ? null
      : `${wow > 0 ? '+' : ''}${wow.toFixed(1)}h vs prior`;
  return (
    <div className="mt-2 pt-2 border-t border-border/60">
      <p
        className="text-[11px] text-muted"
        title="Strategy/account team only (excludes link-building team)"
      >
        Strategy hours: <span className="text-foreground font-medium">{hours}h</span>
        {wowLabel && <span className="ml-2">({wowLabel})</span>}
        {typeof rawTotal === 'number' && rawTotal > h.hoursThisWeek && (
          <span className="ml-2 text-[10px]">of {rawTotal.toFixed(1)}h total</span>
        )}
      </p>
    </div>
  );
}

function ProfoundCallout({ current }: { current: HealthCardEntry }) {
  const p = current.profound;
  if (!p) return null;
  const snap = p.snapshot;
  const wow = p.wow;
  const arrow = (n: number | null, pct = false): React.ReactNode => {
    if (n === null || Math.abs(n) < 0.001) return null;
    const up = n > 0;
    const val = pct ? `${n > 0 ? '+' : ''}${n.toFixed(1)}pp` : `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
    return (
      <span className={`ml-1 text-[10px] ${up ? 'text-green' : 'text-red'}`}>
        {up ? '↑' : '↓'}{val}
      </span>
    );
  };

  return (
    <div className="mt-3 pt-2 border-t border-border/60">
      <p className="text-[10px] uppercase tracking-wide text-muted mb-1">AI visibility (Profound)</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {snap.shareOfVoice !== null && (
          <span>SoV {snap.shareOfVoice.toFixed(1)}%{arrow(wow.shareOfVoice, true)}</span>
        )}
        {snap.citationShare !== null && (
          <span>cite {snap.citationShare.toFixed(1)}%{arrow(wow.citationShare, true)}</span>
        )}
        {snap.visibilityScore !== null && (
          <span>vis {snap.visibilityScore.toFixed(2)}{arrow(wow.visibilityScore)}</span>
        )}
      </div>
    </div>
  );
}
