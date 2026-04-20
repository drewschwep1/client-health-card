'use client';

import { DIMENSIONS, RUBRIC, DATA_SOURCES, DimensionId } from '@/lib/constants';

export default function RubricPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Rubric</h1>
        <p className="text-sm text-muted mt-1">
          All scores are computed algorithmically from data sources. No manual input. No subjectivity.
        </p>
      </div>

      <div className="space-y-6">
        {DIMENSIONS.map(dim => (
          <div key={dim.id} className="border border-border rounded-lg overflow-hidden bg-card">
            <div className="px-5 py-4 border-b border-border bg-background">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{dim.name}</h2>
                <span className="text-xs px-2 py-0.5 rounded bg-accent-light text-accent font-medium">
                  {Math.round(dim.weight * 100)}% weight
                </span>
              </div>
              <p className="text-xs text-muted mt-2">
                <span className="font-medium text-foreground">Signal:</span> {dim.signal}
              </p>
              <p className="text-xs text-muted mt-1">
                <span className="font-medium text-foreground">Sources:</span> {DATA_SOURCES[dim.id as DimensionId]}
              </p>
            </div>

            <div className="divide-y divide-border">
              {[1, 2, 3, 4, 5].map(score => (
                <div key={score} className="px-5 py-3 flex gap-4">
                  <span className={`shrink-0 w-7 h-7 rounded flex items-center justify-center text-sm font-semibold ${
                    score <= 2 ? 'bg-red-bg text-red'
                      : score === 3 ? 'bg-yellow-bg text-yellow'
                      : 'bg-green-bg text-green'
                  }`}>
                    {score}
                  </span>
                  <p className="text-sm text-muted leading-relaxed pt-0.5">
                    {RUBRIC[dim.id as DimensionId][score]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 border border-border rounded-lg p-5 bg-card">
        <h2 className="font-semibold mb-3">Formula</h2>
        <div className="text-sm text-muted space-y-2">
          <p>Each dimension is scored 1-5 by aggregating signals from connected data sources. The weighted formula produces a 0-100 health score:</p>
          <p className="font-mono text-xs bg-background px-3 py-2 rounded">
            Health = (Happiness&times;0.25 + Results&times;0.30 + Execution&times;0.20 + Capacity&times;0.10 + Momentum&times;0.15) / 5 &times; 100
          </p>
          <div className="flex gap-6 mt-3">
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-green" />
              <span className="text-xs">80-100 GREEN</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-yellow" />
              <span className="text-xs">60-79 YELLOW</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-red" />
              <span className="text-xs">&lt;60 RED</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
