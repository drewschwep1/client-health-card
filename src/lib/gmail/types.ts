// Normalized Gmail shapes. googleapis returns deeply nested MIME payloads;
// we flatten to these interfaces once at fetch time.

export interface GmailMessage {
  // Gmail's per-mailbox message ID. Not globally unique across mailboxes.
  id: string;
  // RFC 822 Message-Id header value. Globally unique — used to dedupe the
  // same conversation across mailboxes.
  rfc822MessageId: string;
  threadId: string;
  date: string; // ISO
  from: string; // "Name <addr@domain>" — lowercased addr
  to: string[];
  cc: string[];
  subject: string;
  // Plain-text body (we prefer text/plain; fall back to html-stripped text).
  bodyPlain: string;
  headers: Record<string, string>; // lowercased header keys → last value
}

export interface GmailThread {
  // Gmail thread ID (mailbox-scoped).
  threadId: string;
  // sha256 of the earliest message's RFC 822 Message-Id. Used as the disk
  // key and as the dedup key across mailboxes.
  dedupKey: string;
  subject: string;
  // Sorted oldest → newest.
  messages: GmailMessage[];
  // Union of from/to/cc addresses across all messages, lowercased.
  participants: string[];
  earliestDate: string; // ISO
  latestDate: string; // ISO
}
