'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/rubric', label: 'Rubric' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
            ST HEALTH CARD
          </Link>
          <nav className="flex gap-1">
            {links.map(({ href, label }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    active
                      ? 'bg-foreground text-background font-medium'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <span className="font-mono text-xs text-muted">v2</span>
      </div>
    </header>
  );
}
