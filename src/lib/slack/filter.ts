import type { SlackChannelWeek, SlackMessage } from './types';

// Messages we strip before sending to Claude — they don't carry signal.
// Subtype set = system event (channel_join, channel_topic, pinned_item, etc.)
// OR bot_message (integrations posting automated updates).
export function keepMessage(m: SlackMessage): boolean {
  if (!m.text.trim()) return false;
  if (m.subtype === null) return true;
  if (m.subtype === 'thread_broadcast') return true; // still a real message
  return false;
}

export function shouldExcludeChannelWeek(
  week: SlackChannelWeek,
  opts?: { allowInternalOnly?: boolean }
): { exclude: boolean; reason?: string } {
  const kept = week.messages.filter(keepMessage);
  if (kept.length === 0) return { exclude: true, reason: 'no non-system messages' };

  // For content-routed (unmapped) channels, internal-only weeks are valid —
  // SearchTides folks may be discussing a client, and Claude can attribute
  // via message content. Only apply the internal-only filter to
  // explicitly mapped channels.
  if (opts?.allowInternalOnly) return { exclude: false };

  const externalParticipants = week.participantEmails.filter(
    e => !e.endsWith('@searchtides.com')
  );
  if (externalParticipants.length === 0) {
    return { exclude: true, reason: 'all participants internal (@searchtides.com only)' };
  }

  return { exclude: false };
}
