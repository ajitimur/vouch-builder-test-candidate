// Stage 2: group Claim[] into IssueThread[] by issueKey and run the state machine.
// Deterministic. Threads only contain claims that share a canonical issueKey, so
// cross-night and cross-source reconciliation falls out of the grouping.

import type { Claim, ClaimFlag, IssueThread } from '../types.js';
import { classify, orderClaims } from './stateMachine.js';

function firstNonNull<T>(values: (T | null)[]): T | null {
  for (const v of values) if (v != null) return v;
  return null;
}

export function reconcile(claims: Claim[], targetMorning: string): IssueThread[] {
  const byKey = new Map<string, Claim[]>();
  for (const c of claims) {
    const arr = byKey.get(c.issueKey) ?? [];
    arr.push(c);
    byKey.set(c.issueKey, arr);
  }

  const threads: IssueThread[] = [];
  for (const [issueKey, group] of byKey) {
    const ordered = orderClaims(group);
    const { state, gap } = classify(ordered, targetMorning);

    const flags = new Set<ClaimFlag>();
    for (const c of ordered) for (const f of c.flags) flags.add(f);
    if (state === 'contradiction') flags.add('contradiction');

    threads.push({
      issueKey,
      room: firstNonNull(ordered.map((c) => c.room)),
      type: ordered[ordered.length - 1].type,
      state,
      claims: ordered,
      flags: [...flags],
      gap,
    });
  }

  // Stable ordering for deterministic output: by issueKey.
  return threads.sort((a, b) => (a.issueKey < b.issueKey ? -1 : 1));
}
