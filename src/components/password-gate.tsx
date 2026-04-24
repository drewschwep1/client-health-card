'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

// Client-side password gate. The "password" is the value of
// NEXT_PUBLIC_ACCESS_CODE at build time. This is NOT cryptographic security
// — anyone who inspects the bundle can read the password. It blocks random
// web traffic and casual viewers, not determined attackers. For real
// security, move to Vercel Pro password protection or Cloudflare Access.
//
// When NEXT_PUBLIC_ACCESS_CODE is empty/unset (e.g. local dev), the gate
// is disabled and children render immediately.

const STORAGE_KEY = 'health-card-access-granted';

export function PasswordGate({ children }: { children: ReactNode }) {
  const expected = process.env.NEXT_PUBLIC_ACCESS_CODE;
  const [ok, setOk] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (!expected) {
      setOk(true);
      return;
    }
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === expected) setOk(true);
    } catch {
      // sessionStorage may be blocked — user just reauths each visit.
    }
  }, [expected]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!expected) return;
    if (input.trim() === expected) {
      try {
        sessionStorage.setItem(STORAGE_KEY, expected);
      } catch {
        // ignore
      }
      setOk(true);
      setError(false);
    } else {
      setError(true);
    }
  }

  // Avoid hydration mismatch — render children once client state is ready.
  if (!hydrated) return null;
  if (ok) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="border border-border rounded-lg bg-card p-8 w-full max-w-sm"
      >
        <h1 className="font-semibold text-lg mb-1">SearchTides Client Health Card</h1>
        <p className="text-xs text-muted mb-6">Access code required.</p>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={e => {
            setInput(e.target.value);
            setError(false);
          }}
          placeholder="Access code"
          className="w-full border border-border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
        {error && <p className="text-xs text-red mt-2">Incorrect code.</p>}
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-full mt-4 bg-foreground text-background rounded py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
