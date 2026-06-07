import { describe, it, expect } from 'vitest';
import { generateHandover } from '../src/pipeline.js';
import { classify } from '../src/reconcile/stateMachine.js';
import type { Claim } from '../src/types.js';

function claim(p: Partial<Claim> & { night: string; statusSignal: Claim['statusSignal'] }): Claim {
  return {
    id: 'c', sourceRef: 'evt_x', sourceType: 'structured_event', issueKey: 'k',
    issueKeyConfidence: 1, room: null, guest: null, type: 't', summary: 's',
    originalText: null, lang: 'en', flags: [], ...p,
  };
}

describe('state machine', () => {
  it('flags resolved-then-reopened as a contradiction (312 charge shape)', () => {
    const claims = [
      claim({ id: 'a', night: '2026-05-27', statusSignal: 'open' }),
      claim({ id: 'b', night: '2026-05-28', statusSignal: 'resolved' }),
      claim({ id: 'c', night: '2026-05-29', statusSignal: 'pending' }),
    ];
    expect(classify(claims, '2026-05-30').state).toBe('contradiction');
  });

  it('treats a clean open->resolved sequence as resolved, not a contradiction (215 leak shape)', () => {
    const claims = [
      claim({ id: 'a', night: '2026-05-27', statusSignal: 'open' }),
      claim({ id: 'b', night: '2026-05-28', statusSignal: 'open' }),
      claim({ id: 'c', night: '2026-05-29', statusSignal: 'resolved' }),
    ];
    expect(classify(claims, '2026-05-30').state).toBe('resolved_earlier');
  });

  it('carries an earlier unresolved item forward as still_open, not new_tonight', () => {
    const claims = [claim({ night: '2026-05-27', statusSignal: 'open' })];
    expect(classify(claims, '2026-05-30').state).toBe('still_open');
  });
});

describe('end-to-end reconciliation across sources', () => {
  it('merges the 312 thread across event + free-text and surfaces the contradiction', async () => {
    const { threads } = await generateHandover({ night: '2026-05-30' });
    const t = threads.find((x) => x.issueKey === 'room-312-charge');
    expect(t?.state).toBe('contradiction');
    // evidence from both the structured events and the free-text night log
    expect(t?.claims.map((c) => c.sourceRef)).toEqual(['evt_0010', 'night-log:L19', 'evt_0012']);
  });

  it('does not let future nights leak into a historical handover', async () => {
    // On the morning of the 28th, the 312 dispute (evt_0012, 29th) and the leak
    // resolution (evt_0013, 29th) have not happened yet.
    const { threads } = await generateHandover({ night: '2026-05-28' });
    const refs = threads.flatMap((t) => t.claims.map((c) => c.sourceRef));
    expect(refs).not.toContain('evt_0012');
    expect(refs).not.toContain('evt_0013');
    // ...so 312 is not yet a contradiction, and the leak is still open.
    expect(threads.find((t) => t.issueKey === 'room-312-charge')?.state).not.toBe('contradiction');
    expect(threads.find((t) => t.issueKey === 'room-215-facilities')?.state).toBe('still_open');
  });

  it('keeps the 309 deposit open across three nights and routes it to Act Now', async () => {
    const { threads, handover } = await generateHandover({ night: '2026-05-30' });
    const t = threads.find((x) => x.issueKey === 'room-309-deposit');
    expect(t?.state).toBe('still_open');
    const actNow = handover.buckets.find((b) => b.id === 'act_now')!;
    expect(actNow.lines.some((l) => l.sourceRefs.includes('evt_0014'))).toBe(true);
  });
});
