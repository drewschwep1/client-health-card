import type { ClientId } from '../constants';

// Raw Harvest time_entry shape (only fields we use).
export interface HarvestTimeEntry {
  id: number;
  spent_date: string;
  hours: number;
  task: { id: number; name: string };
  user: { id: number; name: string };
  project: { id: number; name: string };
  notes: string | null;
}

// Paginated list response from GET /v2/time_entries.
export interface HarvestTimeEntriesResponse {
  time_entries: HarvestTimeEntry[];
  per_page: number;
  total_pages: number;
  total_entries: number;
  next_page: number | null;
  page: number;
}

// Active-user record from GET /v2/users. Only the fields we use.
export interface HarvestUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
}

export interface HarvestUsersResponse {
  users: HarvestUser[];
  per_page: number;
  total_pages: number;
  total_entries: number;
  next_page: number | null;
  page: number;
}

// Per-(person, week) totals across ALL projects. Written by
// harvest-person-sync.ts to data/harvest/person-weeks/. byProject keys
// are Harvest project names so we can sanity-check attribution.
export interface HarvestPersonWeek {
  userId: number;
  userName: string;
  weekStart: string;
  weekEnd: string;
  fetchedAt: string;
  totalHours: number;
  entryCount: number;
  byProject: Record<string, number>;
}

// Per-(client, week) snapshot persisted to disk. One file per client-week
// under data/harvest/snapshots/{clientId}-{weekStart}.json.
export interface HarvestSnapshot {
  clientId: ClientId;
  projectId: number;
  projectName: string;
  weekStart: string;
  weekEnd: string;
  fetchedAt: string;
  totalHours: number;
  entryCount: number;
  byUser: Record<string, number>;
  // Hours grouped by Harvest task (work category: "Research", "Client
  // Meeting", etc.). Useful for inspection; not used in scoring.
  byTask: Record<string, number>;
}
