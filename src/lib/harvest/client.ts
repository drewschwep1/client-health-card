import type { HarvestTimeEntriesResponse, HarvestUser, HarvestUsersResponse } from './types';

const BASE_URL = 'https://api.harvestapp.com/v2';

// Harvest rate limit: 100 requests per 15 seconds per account. We
// serialize requests and enforce a min gap between them well below
// that ceiling to stay safe across long backfills. 250ms → ~4 rps →
// 60 req/15s, leaves headroom for retries.
const MIN_REQUEST_INTERVAL_MS = 250;
let lastRequestAt = 0;
let inflight: Promise<void> = Promise.resolve();

function accessToken(): string {
  const token = process.env.HARVEST_ACCESS_TOKEN;
  if (!token) throw new Error('HARVEST_ACCESS_TOKEN is not set');
  return token;
}

function accountId(): string {
  const id = process.env.HARVEST_ACCOUNT_ID;
  if (!id) throw new Error('HARVEST_ACCOUNT_ID is not set');
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function harvestFetchRaw(path: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE_URL + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Harvest-Account-Id': accountId(),
      // Harvest requires a User-Agent identifying the integration owner.
      'User-Agent': 'SearchTides Health Card (hank@searchtides.com)',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function harvestFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Serialize + throttle. All requests in this process queue through
  // `inflight` so we never exceed the min-interval cap even under
  // concurrent callers.
  const wait = inflight.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    lastRequestAt = Date.now();
  });
  inflight = wait;
  await wait;

  // One 429 retry. Harvest returns Retry-After sometimes; otherwise
  // we back off 15s (the rate-limit window).
  let res = await harvestFetchRaw(path, init);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 15;
    console.warn(`Harvest 429 on ${path} — sleeping ${retryAfter}s then retrying once`);
    await sleep(retryAfter * 1000);
    lastRequestAt = Date.now();
    res = await harvestFetchRaw(path, init);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Harvest ${path} → HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// Fetch every time_entry for (projectId, from..to). Walks Harvest's
// page-based pagination until next_page is null. Dates are YYYY-MM-DD.
export async function listTimeEntries(opts: {
  projectId: string;
  from: string;
  to: string;
}): Promise<HarvestTimeEntriesResponse['time_entries']> {
  const entries: HarvestTimeEntriesResponse['time_entries'] = [];
  let page: number | null = 1;
  while (page !== null) {
    const qs: URLSearchParams = new URLSearchParams({
      project_id: opts.projectId,
      from: opts.from,
      to: opts.to,
      per_page: '100',
      page: String(page),
    });
    const res: HarvestTimeEntriesResponse = await harvestFetch<HarvestTimeEntriesResponse>(
      `/time_entries?${qs.toString()}`
    );
    entries.push(...res.time_entries);
    page = res.next_page;
  }
  return entries;
}

// Fetch every time_entry for a single user across ALL projects in
// [from..to]. Used to compute per-person weekly totals (the denominator
// for salaried-cost allocation — we need to know how a person's hours
// split across *all* clients, not just SearchTides-tracked ones).
export async function listTimeEntriesByUser(opts: {
  userId: number;
  from: string;
  to: string;
}): Promise<HarvestTimeEntriesResponse['time_entries']> {
  const entries: HarvestTimeEntriesResponse['time_entries'] = [];
  let page: number | null = 1;
  while (page !== null) {
    const qs: URLSearchParams = new URLSearchParams({
      user_id: String(opts.userId),
      from: opts.from,
      to: opts.to,
      per_page: '100',
      page: String(page),
    });
    const res: HarvestTimeEntriesResponse = await harvestFetch<HarvestTimeEntriesResponse>(
      `/time_entries?${qs.toString()}`
    );
    entries.push(...res.time_entries);
    page = res.next_page;
  }
  return entries;
}

// Fetch every active user. Harvest returns paginated users; we walk
// them all and filter to active=true. Used to resolve name → user_id
// for per-user time-entry queries.
export async function listUsers(): Promise<HarvestUser[]> {
  const users: HarvestUser[] = [];
  let page: number | null = 1;
  while (page !== null) {
    const qs = new URLSearchParams({
      is_active: 'true',
      per_page: '100',
      page: String(page),
    });
    const res: HarvestUsersResponse = await harvestFetch<HarvestUsersResponse>(
      `/users?${qs.toString()}`
    );
    users.push(...res.users);
    page = res.next_page;
  }
  return users;
}
