'use client';

import { useState, useEffect } from 'react';
import { CLIENTS, DIMENSIONS, RUBRIC, DimensionId } from '@/lib/constants';
import { saveScore, getCurrentWeekStart, getScoresForWeek } from '@/lib/store';

export default function ScorePage() {
  const [selectedClient, setSelectedClient] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [tweet, setTweet] = useState('');
  const [saved, setSaved] = useState(false);
  const [weekStart] = useState(getCurrentWeekStart);
  const [scoredThisWeek, setScoredThisWeek] = useState<string[]>([]);

  useEffect(() => {
    const weekScores = getScoresForWeek(weekStart);
    setScoredThisWeek(weekScores.map(s => s.clientId));
  }, [weekStart]);

  useEffect(() => {
    if (selectedClient) {
      const weekScores = getScoresForWeek(weekStart);
      const existing = weekScores.find(s => s.clientId === selectedClient);
      if (existing) {
        setScores(existing.scores as Record<string, number>);
        setTweet(existing.tweet);
      } else {
        setScores({});
        setTweet('');
      }
      setSaved(false);
    }
  }, [selectedClient, weekStart]);

  const allScored = DIMENSIONS.every(d => scores[d.id] >= 1);

  function handleSave() {
    if (!selectedClient || !allScored) return;
    saveScore(
      selectedClient as any,
      weekStart,
      scores as Record<DimensionId, number>,
      tweet
    );
    setSaved(true);
    setScoredThisWeek(prev => [...new Set([...prev, selectedClient])]);
  }

  function handleNext() {
    const currentIdx = CLIENTS.findIndex(c => c.id === selectedClient);
    const nextUnscored = CLIENTS.find((c, i) => i > currentIdx && !scoredThisWeek.includes(c.id));
    if (nextUnscored) {
      setSelectedClient(nextUnscored.id);
    } else {
      const firstUnscored = CLIENTS.find(c => !scoredThisWeek.includes(c.id));
      if (firstUnscored) setSelectedClient(firstUnscored.id);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Score</h1>
        <p className="text-sm text-muted mt-1">
          Week of {weekStart} &middot; {scoredThisWeek.length}/{CLIENTS.length} complete
        </p>
      </div>

      <div className="mb-6">
        <label className="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
          Client
        </label>
        <select
          value={selectedClient}
          onChange={e => setSelectedClient(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        >
          <option value="">Select a client...</option>
          {CLIENTS.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} {scoredThisWeek.includes(c.id) ? '(scored)' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedClient && (
        <>
          <div className="space-y-6 mb-8">
            {DIMENSIONS.map(dim => (
              <div key={dim.id} className="border border-border rounded-lg p-4 bg-card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium">{dim.name}</h3>
                    <span className="text-xs text-muted">{dim.type} &middot; {Math.round(dim.weight * 100)}% weight</span>
                  </div>
                  <span className="text-2xl font-semibold tabular-nums w-8 text-right">
                    {scores[dim.id] || '-'}
                  </span>
                </div>

                <div className="flex gap-1.5 mb-3">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setScores(prev => ({ ...prev, [dim.id]: n }))}
                      className={`flex-1 py-2 rounded text-sm font-medium transition-all ${
                        scores[dim.id] === n
                          ? n <= 2 ? 'bg-red text-white'
                            : n === 3 ? 'bg-yellow text-white'
                            : 'bg-green text-white'
                          : 'bg-background border border-border hover:border-foreground/30'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                {scores[dim.id] && (
                  <p className="text-xs text-muted leading-relaxed">
                    {RUBRIC[dim.id as DimensionId][scores[dim.id]]}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mb-8">
            <label className="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
              Week in a Tweet
            </label>
            <textarea
              value={tweet}
              onChange={e => setTweet(e.target.value)}
              placeholder="One sentence on what defined this week for this client..."
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-none h-20"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={!allScored}
              className="px-5 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saved ? 'Saved' : 'Save scores'}
            </button>
            {saved && (
              <button
                onClick={handleNext}
                className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-card transition-colors"
              >
                Next client
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
