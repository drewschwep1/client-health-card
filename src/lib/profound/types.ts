// Shapes for Profound API responses. Only the fields we actually use.

export interface ProfoundAsset {
  id: string;
  name: string;
  website: string;
  alternate_domains: string[] | null;
  is_owned: boolean;
  category: { id: string; name: string };
}

export interface ProfoundCategory {
  id: string;
  name: string;
}

// POST /v1/reports/{visibility,sentiment,citations}
export interface ProfoundReportRequest {
  category_id: string;
  start_date: string; // ISO
  end_date: string; // ISO
  metrics: string[];
  dimensions?: string[];
  filters?: Array<Record<string, unknown>>;
  pagination?: { limit: number; offset: number };
}

export interface ProfoundReportRow {
  metrics: Array<number | null>;
  dimensions: string[];
}

export interface ProfoundReportResponse {
  info: { total_rows: number; query: unknown };
  data: ProfoundReportRow[];
}

// Per-client weekly snapshot persisted to disk.
export interface ProfoundSnapshot {
  clientId: string;
  assetId: string;
  categoryId: string;
  weekStart: string; // Monday, yyyy-MM-dd
  weekEnd: string;
  fetchedAt: string;

  // Raw metrics. null when the API returned no data for this (metric, week).
  visibilityScore: number | null; // 0-100
  shareOfVoice: number | null; // 0-100 (percent)
  citationShare: number | null; // 0-100 (percent)
  citationCount: number | null;
  sentimentPositive: number | null;
  sentimentNegative: number | null;
  sentimentOccurrences: number | null;
  mentionsCount: number | null;
}
