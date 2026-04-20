import type { GmailThread } from './types';
import { DOMAIN_TO_CLIENT } from '../constants';

const SEARCHTIDES_DOMAIN = 'searchtides.com';

// Senders we never want to treat as client signal. Matched by local-part
// prefix — case-insensitive substring check against the local part before @.
const BULK_LOCAL_PARTS = [
  'noreply',
  'no-reply',
  'notifications',
  'notify',
  'updates',
  'alert',
  'alerts',
  'automated',
  'auto-confirm',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'billing',
  'support-bot',
];

export function shouldExcludeThread(
  thread: GmailThread
): { exclude: boolean; reason?: string } {
  if (!thread.messages.length) return { exclude: true, reason: 'no messages' };

  // Internal-only: every participant is @searchtides.com.
  const allInternal = thread.participants.every(p => p.endsWith('@' + SEARCHTIDES_DOMAIN));
  if (allInternal) {
    return { exclude: true, reason: 'fully internal (all @searchtides.com)' };
  }

  // No client-domain participant — this query hit wrongly (e.g. BCC leak) or
  // the client is not in our domain map. Caller routes these to _unmatched/
  // via a separate path; this filter is for *structurally* bad threads.
  const hasClientParticipant = thread.participants.some(p => {
    const domain = p.split('@')[1];
    return domain && DOMAIN_TO_CLIENT[domain.toLowerCase()];
  });
  if (!hasClientParticipant) {
    return { exclude: true, reason: 'no known client-domain participant' };
  }

  // Bulk / automated senders on every inbound message → treat as marketing.
  // If ANY message is from a human at the client domain, we keep the thread.
  const hasHumanClientMessage = thread.messages.some(m => {
    const domain = (m.from.split('@')[1] ?? '').toLowerCase();
    const localPart = (m.from.split('@')[0] ?? '').toLowerCase();
    if (!domain || !DOMAIN_TO_CLIENT[domain]) return false;
    if (BULK_LOCAL_PARTS.some(p => localPart.includes(p))) return false;
    return true;
  });
  if (!hasHumanClientMessage) {
    return { exclude: true, reason: 'bulk/automated sender only' };
  }

  // List mail / auto-replies — check headers on any message.
  for (const m of thread.messages) {
    if (m.headers['list-unsubscribe']) {
      return { exclude: true, reason: 'has List-Unsubscribe header (mailing list)' };
    }
    if ((m.headers['auto-submitted'] ?? 'no') !== 'no') {
      return { exclude: true, reason: 'Auto-Submitted header set' };
    }
  }

  return { exclude: false };
}
