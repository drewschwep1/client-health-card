// Shapes returned by the Fathom external API v1. These only cover the
// fields we actually read — the API returns more.

export interface FathomTeam {
  id: number;
  name: string;
  created_at: string;
}

export interface FathomInvitee {
  name?: string;
  email?: string;
  is_external?: boolean;
}

export interface FathomMeeting {
  recording_id: number;
  title: string;
  meeting_title?: string;
  url: string;
  share_url?: string;
  scheduled_start_time: string;
  scheduled_end_time?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  recorded_by?: { name?: string; email?: string };
  calendar_invitees?: FathomInvitee[];
  // Fields present on the list response but always null there — populated
  // via the dedicated endpoints below.
  transcript?: unknown;
  default_summary?: unknown;
  action_items?: unknown;
}

export interface FathomTranscriptLine {
  speaker: {
    display_name: string;
    matched_calendar_invitee_email?: string;
  };
  text: string;
  timestamp: string;
}

export interface FathomTranscript {
  transcript: FathomTranscriptLine[];
}

export interface FathomSummary {
  summary: {
    template_name?: string;
    markdown_formatted: string;
  };
}

export interface FathomListResponse<T> {
  items: T[];
  next_cursor: string;
  limit: number;
  items_active_record?: Array<T & { id: number }>;
}
