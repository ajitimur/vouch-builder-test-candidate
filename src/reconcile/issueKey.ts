// Canonical issue-key assignment. The issueKey is what lets us track one real
// problem across many nights and across both data sources. Structured events get
// a deterministic key here; free-text claims are mapped by the LLM onto this
// same key space (see extract/nightlogs.ts), with low-confidence mappings flagged
// rather than silently merged.

// Map a raw event type to a coarse, hotel-ops "topic". Two events about the same
// room+topic are the same thread (e.g. no_show + its later finance dispute).
const TYPE_TOPIC: Record<string, string> = {
  maintenance: 'maintenance',
  facilities: 'facilities',
  deposit_issue: 'deposit',
  finance_note: 'charge',
  no_show: 'charge',
  check_in_issue: 'identity',
  compliance: 'immigration',
  damage_report: 'damage',
  complaint: 'complaint',
  incident: 'incident',
  lost_keycard: 'keycard',
  early_checkout_request: 'checkout',
  guest_message: 'guest_message',
  check_in: 'checkin',
  walk_in: 'walkin',
  note: 'note',
};

export function topicForType(type: string): string {
  return TYPE_TOPIC[type] ?? type;
}

/** When an event has no room field, fall back to the first room-like number in its text. */
export function effectiveRoom(room: string | null, description: string): string | null {
  if (room) return room;
  const m = /\b(\d{3})\b/.exec(description);
  return m ? m[1] : null;
}

/**
 * Deterministic canonical key for a structured event.
 * - compliance/immigration always collapses to one hotel-wide backlog thread.
 * - room-scoped issues become room-{room}-{topic}.
 * - roomless one-offs get a unique key (they won't merge with anything).
 */
export function canonicalIssueKey(args: {
  type: string;
  room: string | null;
  description: string;
  sourceRef: string;
}): string {
  const topic = topicForType(args.type);
  if (topic === 'immigration') return 'compliance-immigration-backlog';
  const room = effectiveRoom(args.room, args.description);
  if (room) return `room-${room}-${topic}`;
  return `${topic}-${args.sourceRef}`;
}

/** The set of keys we hand to the LLM so it can align free-text claims onto existing threads. */
export function candidateKeys(keys: string[]): string[] {
  return Array.from(new Set(keys)).sort();
}
