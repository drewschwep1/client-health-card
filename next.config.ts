import type { NextConfig } from 'next';

// Resolve the URL prefix at build time:
//   - Vercel (VERCEL=1 in their build env): "" (serves from root)
//   - GitHub Pages (user.github.io/client-health-card): "/client-health-card"
//   - Local override: set BASE_PATH to force a specific value.
const basePath =
  process.env.BASE_PATH ??
  (process.env.VERCEL ? '' : '/client-health-card');

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  // Expose to client so fetches can prepend the prefix consistently.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
