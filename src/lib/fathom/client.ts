import type {
  FathomListResponse,
  FathomMeeting,
  FathomSummary,
  FathomTeam,
  FathomTranscript,
} from './types';

const BASE_URL = 'https://api.fathom.ai/external/v1';

function apiKey(): string {
  const key = process.env.FATHOM_API_KEY;
  if (!key) throw new Error('FATHOM_API_KEY is not set');
  return key;
}

async function fathomGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey() },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fathom ${path} → HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function listTeams(): Promise<FathomTeam[]> {
  // The `items_active_record` variant on the list response is the one with
  // numeric IDs — plain `items` omits them.
  const res = await fathomGet<FathomListResponse<FathomTeam>>('/teams');
  return res.items_active_record ?? (res.items as FathomTeam[]);
}

// Yields one page of meetings at a time. Fathom paginates via opaque
// `next_cursor`; empty string means no more pages.
export async function* listMeetings(opts: {
  team: string;
  createdAfter?: string;
}): AsyncGenerator<FathomMeeting[]> {
  let cursor: string | undefined;
  // Safety valve — shouldn't hit this given our cadence, but prevents
  // accidental infinite loops if the API misbehaves.
  for (let i = 0; i < 50; i++) {
    const params: Record<string, string> = { team: opts.team };
    if (opts.createdAfter) params.created_after = opts.createdAfter;
    if (cursor) params.cursor = cursor;

    const page = await fathomGet<FathomListResponse<FathomMeeting>>('/meetings', params);
    if (page.items.length === 0) return;
    yield page.items;

    if (!page.next_cursor) return;
    cursor = page.next_cursor;
  }
}

export async function getTranscript(recordingId: number): Promise<FathomTranscript> {
  return fathomGet<FathomTranscript>(`/recordings/${recordingId}/transcript`);
}

export async function getSummary(recordingId: number): Promise<FathomSummary> {
  return fathomGet<FathomSummary>(`/recordings/${recordingId}/summary`);
}
