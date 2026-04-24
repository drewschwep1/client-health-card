// Prepends the deploy's basePath to an asset URL. Works identically on
// GitHub Pages (basePath="/client-health-card") and Vercel (basePath="").
//
// Usage:  fetch(assetPath('/data/fathom/signals.json'))
export function assetPath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  // Ensure the path starts with a single "/" so joining is deterministic.
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}
