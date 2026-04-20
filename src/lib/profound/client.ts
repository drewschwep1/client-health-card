import type {
  ProfoundAsset,
  ProfoundCategory,
  ProfoundReportRequest,
  ProfoundReportResponse,
} from './types';

const BASE_URL = 'https://api.tryprofound.com';

function apiKey(): string {
  const key = process.env.PROFOUND_API_KEY;
  if (!key) throw new Error('PROFOUND_API_KEY is not set');
  return key;
}

async function profoundFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      'X-API-Key': apiKey(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Profound ${path} → HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ---- Read-only discovery ----

export async function listAssets(): Promise<ProfoundAsset[]> {
  const res = await profoundFetch<{ data: ProfoundAsset[] }>('/v1/org/assets?limit=500');
  return res.data;
}

export async function listCategories(): Promise<ProfoundCategory[]> {
  return profoundFetch<ProfoundCategory[]>('/v1/org/categories');
}

export interface ProfoundTag {
  id: string;
  name: string;
}

export async function listTagsForCategory(categoryId: string): Promise<ProfoundTag[]> {
  return profoundFetch<ProfoundTag[]>(`/v1/org/categories/${categoryId}/tags`);
}

// ---- Reports ----

async function queryReport(
  endpoint: 'visibility' | 'sentiment' | 'citations',
  body: ProfoundReportRequest
): Promise<ProfoundReportResponse> {
  return profoundFetch<ProfoundReportResponse>(`/v1/reports/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export const queryVisibility = (body: ProfoundReportRequest) => queryReport('visibility', body);
export const querySentiment = (body: ProfoundReportRequest) => queryReport('sentiment', body);
export const queryCitations = (body: ProfoundReportRequest) => queryReport('citations', body);
