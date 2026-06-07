// Orchestrates the four stages end-to-end and produces the Handover plus a
// structured log record. This is the single entry point the server calls.

import type { Claim, Handover, IssueThread } from './types.js';
import { loadEventsFile, extractEventClaims } from './extract/events.js';
import { loadNightLog, extractNightLogClaims } from './extract/nightlogs.js';
import { candidateKeys } from './reconcile/issueKey.js';
import { reconcile } from './reconcile/reconcile.js';
import { validateClaims } from './validate.js';
import { assignBuckets } from './render/buckets.js';
import { emitLog, type FlagDetail, type HandoverLog } from './log.js';

export interface PipelineOutput {
  handover: Handover;
  threads: IssueThread[];
  log: HandoverLog;
}

function latestNight(claims: Claim[]): string {
  return claims.reduce((max, c) => (c.night > max ? c.night : max), '0000-00-00');
}

function buildFlagDetails(threads: IssueThread[]): FlagDetail[] {
  const details: FlagDetail[] = [];
  for (const t of threads) {
    const refs = t.claims.map((c) => c.sourceRef);
    if (t.flags.includes('prompt_injection')) details.push({ type: 'prompt_injection', sourceRefs: refs, reason: 'input attempted to instruct the system; quarantined verbatim' });
    if (t.state === 'contradiction') details.push({ type: 'contradiction', sourceRefs: refs, reason: 'claims on this thread disagree; surfaced, not auto-resolved' });
    if (t.flags.includes('low_confidence_merge')) details.push({ type: 'low_confidence_merge', sourceRefs: refs, reason: 'issueKey mapping below 0.7 confidence; not auto-merged' });
    if (t.flags.includes('non_english')) details.push({ type: 'non_english', sourceRefs: refs, reason: 'source not in English; translated with original preserved' });
    if (t.gap) details.push({ type: 'gap', sourceRefs: refs, reason: 'unresolved thread with no update for >=2 days' });
  }
  return details;
}

export async function generateHandover(opts: { night?: string } = {}): Promise<PipelineOutput> {
  // Stage 1: extract.
  const eventsFile = loadEventsFile();
  const eventClaims = extractEventClaims(eventsFile);
  const nightLog = loadNightLog();
  const keys = candidateKeys(eventClaims.map((c) => c.issueKey));
  const { claims: logClaims, meta } = await extractNightLogClaims(keys, nightLog);

  const allClaims = [...eventClaims, ...logClaims];
  const targetMorning = opts.night ?? latestNight(allClaims);

  // Stage 3 (gate): drop anything not traceable to the input set.
  const { valid, dropped } = validateClaims(allClaims, {
    eventIds: new Set(eventsFile.events.map((e) => e.id)),
    nightLogLines: nightLog.lines.length,
  });

  // A handover for a given morning may only use information known by then: drop
  // claims from nights *after* the target so historical queries don't time-travel
  // (e.g. asking for 2026-05-28 must not show a leak "resolved" on the 29th).
  const inWindow = valid.filter((c) => c.night <= targetMorning);

  // Stage 2: reconcile into threads.
  const threads = reconcile(inWindow, targetMorning);

  // Stage 4: render buckets.
  const buckets = assignBuckets(threads, targetMorning);

  const handover: Handover = {
    hotelId: eventsFile.hotel.id,
    hotelName: eventsFile.hotel.name,
    targetMorning,
    generatedAt: new Date().toISOString(),
    buckets,
  };

  const resolvedStates = new Set(['newly_resolved', 'resolved_earlier']);
  const threadsResolved = threads.filter((t) => resolvedStates.has(t.state)).length;
  const confidences = logClaims.map((c) => c.issueKeyConfidence);
  const flagDetails = buildFlagDetails(threads);

  const log: HandoverLog = {
    hotelId: handover.hotelId,
    targetMorning,
    timestamp: handover.generatedAt,
    counts: {
      claimsExtracted: allClaims.length,
      claimsDropped: dropped.length + meta.dropped,
      threadsOpen: threads.length - threadsResolved,
      threadsResolved,
      flagsRaised: flagDetails.length,
    },
    flags: flagDetails,
    llm: {
      source: meta.source,
      model: meta.model,
      tokens: meta.tokens,
      extractionConfidenceMean: confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3)) : 0,
    },
  };

  emitLog(log);
  return { handover, threads, log };
}
