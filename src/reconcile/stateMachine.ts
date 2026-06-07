// Deterministic per-thread state machine. No LLM: given the claims on one issue
// thread (across all nights, both sources) and the target morning, decide where
// the thread stands. Contradictions are detected and surfaced, never collapsed.

import type { Claim, ThreadState } from '../types.js';

/** Sort a thread's claims oldest-first; stable on id for determinism. */
export function orderClaims(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => (a.night < b.night ? -1 : a.night > b.night ? 1 : a.id < b.id ? -1 : 1));
}

const UNRESOLVED = new Set(['open', 'pending', 'update']);

/**
 * A thread is a contradiction when a `resolved` claim is followed by a later
 * claim that treats the issue as still live (open/pending/update) — e.g. relief
 * staff marked the 312 charge settled, then the guest disputed it; or the system
 * shows 205 in-house but a later round found the room empty.
 */
export function isContradiction(ordered: Claim[]): boolean {
  let sawResolved = false;
  for (const c of ordered) {
    if (c.statusSignal === 'resolved') sawResolved = true;
    else if (sawResolved && UNRESOLVED.has(c.statusSignal)) return true;
  }
  return false;
}

export function classify(claims: Claim[], targetMorning: string): { state: ThreadState; gap: boolean } {
  const ordered = orderClaims(claims);
  const earliest = ordered[0].night;
  const latest = ordered[ordered.length - 1];

  if (isContradiction(ordered)) {
    return { state: 'contradiction', gap: latest.night < targetMorning };
  }

  if (latest.statusSignal === 'resolved') {
    const state: ThreadState = latest.night === targetMorning ? 'newly_resolved' : 'resolved_earlier';
    return { state, gap: false };
  }

  // Still live.
  const state: ThreadState = earliest === targetMorning ? 'new_tonight' : 'still_open';
  // An unresolved thread whose most recent activity predates the target morning
  // has gone quiet — flag it so nothing silently rots.
  return { state, gap: latest.night < targetMorning };
}
