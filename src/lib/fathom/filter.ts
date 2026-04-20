import { DOMAIN_TO_CLIENT } from '../constants';
import type { FathomMeeting } from './types';

// Drew and Derek have many 1:1s with internal team, prospects, friends, and
// recruiters that have zero client-scorecard signal. Including them causes
// false-positive client matches (Claude inferring a client from thin content).
//
// Rule: if a meeting has exactly two calendar invitees and one of them is
// Drew or Derek, the other person's email domain must belong to a scorecard
// client. Otherwise, exclude the meeting.
//
// Group calls (3+ attendees) are not filtered by this rule.
const FILTERED_HOSTS = new Set([
  'drew@searchtides.com',
  'derek.iwasiuk@searchtides.com',
]);

export interface FilterResult {
  exclude: boolean;
  reason?: string;
}

export function shouldExcludeMeeting(meeting: FathomMeeting): FilterResult {
  const invitees = meeting.calendar_invitees ?? [];
  if (invitees.length !== 2) return { exclude: false };

  const emails = invitees.map(i => (i.email ?? '').toLowerCase());
  const hasFilteredHost = emails.some(e => FILTERED_HOSTS.has(e));
  if (!hasFilteredHost) return { exclude: false };

  // One of the two IS Drew/Derek. Check whether the OTHER is a client.
  const otherEmails = emails.filter(e => !FILTERED_HOSTS.has(e));
  for (const e of otherEmails) {
    const domain = e.split('@')[1];
    if (domain && DOMAIN_TO_CLIENT[domain]) return { exclude: false };
  }

  const who = emails.find(e => FILTERED_HOSTS.has(e)) ?? '(host)';
  const other = otherEmails[0] || '(unknown)';
  return { exclude: true, reason: `1:1 of ${who} with non-client ${other}` };
}
