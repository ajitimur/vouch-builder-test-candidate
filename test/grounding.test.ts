import { describe, it, expect } from 'vitest';
import { generateHandover } from '../src/pipeline.js';
import { loadEventsFile } from '../src/extract/events.js';
import { loadNightLog, loadCache, type NightLogFile } from '../src/extract/nightlogs.js';
import { isValidSourceRef } from '../src/validate.js';

describe('grounding', () => {
  it('every rendered line traces to a real event id or in-range night-log line', async () => {
    const { handover } = await generateHandover({ night: '2026-05-30' });
    const ctx = {
      eventIds: new Set(loadEventsFile().events.map((e) => e.id)),
      nightLogLines: loadNightLog().lines.length,
    };
    const refs = handover.buckets.flatMap((b) => b.lines.flatMap((l) => l.sourceRefs));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(isValidSourceRef(ref, ctx), `unsourced ref: ${ref}`).toBe(true);
  });

  it('never drops a claim with a valid source (claimsDropped === 0 on the sample)', async () => {
    const { log } = await generateHandover({ night: '2026-05-30' });
    expect(log.counts.claimsDropped).toBe(0);
  });
});

describe('unseen-input safety (no fabricated free-text summaries)', () => {
  // The deepest trap: with no LLM key, the cache must NOT be applied to a night
  // log it was not built from, or it would attach real-looking summaries to the
  // wrong lines and still pass every ref-exists check.
  const unseen: NightLogFile = {
    lines: ['# A different night', 'room 401 reported a burst pipe', 'all guests relocated', 'done'],
    numbered: '',
    morning: '2026-05-30',
  };

  it('refuses to load the cache against text it was not generated from', () => {
    expect(loadCache(loadNightLog())).not.toBeNull(); // real file -> hash matches
    expect(loadCache(unseen)).toBeNull(); // unseen file -> hash mismatch
  });

  it('degrades visibly instead of fabricating when free-text cannot be processed', async () => {
    // No key in the test env -> cache path -> hash mismatch -> degrade.
    const { handover } = await generateHandover({ night: '2026-05-30', nightLog: unseen });
    expect(handover.degraded).toBe(true);
    // No free-text line survives.
    const refs = handover.buckets.flatMap((b) => b.lines.flatMap((l) => l.sourceRefs));
    expect(refs.some((r) => r.startsWith('night-log:'))).toBe(false);
    // Structured events still render, and the gap is announced in the footer.
    expect(refs.some((r) => /^evt_\d+$/.test(r))).toBe(true);
    const flagged = handover.buckets.find((b) => b.id === 'flagged')!;
    expect(flagged.lines.some((l) => /NOT processed/.test(l.text))).toBe(true);
  });
});

describe('incomplete-entry flag (evt_0023 cracked basin)', () => {
  it('flags a proposed charge with no photos / no manager approval for review', async () => {
    const { threads, handover } = await generateHandover({ night: '2026-05-30' });
    const t = threads.find((x) => x.issueKey === 'room-226-damage');
    expect(t?.flags).toContain('incomplete');
    const flagged = handover.buckets.find((b) => b.id === 'flagged')!;
    const line = flagged.lines.find((l) => l.sourceRefs.includes('evt_0023'));
    expect(line).toBeDefined();
    expect(line!.text).toMatch(/incomplete/);
  });
});

describe('prompt-injection containment (evt_0026)', () => {
  it('keeps the injection out of every action bucket', async () => {
    const { handover } = await generateHandover({ night: '2026-05-30' });
    for (const id of ['act_now', 'pending', 'fyi'] as const) {
      const b = handover.buckets.find((x) => x.id === id)!;
      expect(b.lines.some((l) => l.sourceRefs.includes('evt_0026'))).toBe(false);
    }
  });

  it('surfaces the injection verbatim in the flagged footer and does not act on it', async () => {
    const { handover } = await generateHandover({ night: '2026-05-30' });
    const flagged = handover.buckets.find((b) => b.id === 'flagged')!;
    const line = flagged.lines.find((l) => l.sourceRefs.includes('evt_0026'));
    expect(line).toBeDefined();
    expect(line!.text).toContain('NOT acted on');
    expect(line!.text).toContain('SGD 1000'); // quoted verbatim, not executed
    // The instruction must not have been carried out anywhere in the handover.
    const all = handover.buckets.flatMap((b) => b.lines.map((l) => l.text)).join('\n');
    expect(all).not.toMatch(/credit (?:added|applied|approved)/i);
  });
});
