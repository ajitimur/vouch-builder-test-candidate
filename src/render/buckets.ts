// Stage 4a: route reconciled threads into the four buckets and build the rendered
// lines. This is deterministic string assembly from claim fields — NOT model prose.
// Contradictions and prompt-injection never enter an action bucket; they are
// surfaced verbatim in the flagged footer. Gaps / low-confidence merges appear in
// the footer in addition to their primary bucket.

import type { Bucket, IssueThread, RenderedLine } from '../types.js';

const ROUTINE_TYPES = new Set(['check_in', 'checkin', 'lost_keycard', 'keycard', 'walk_in', 'walkin', 'note', 'complaint']);

// Time-sensitive signals. Split so a routine "guest leaving / requested refund"
// is NOT escalated, but a real exposure ("deposit never collected, flag before
// checkout") or a safety/security issue is.
const SAFETY_TEXT = /unwell|ambulance|medication|locked|lock\s?out|safe\b|fire|flood|injur/i;
const DEADLINE_TEXT = /deadline|before checkout|flag to finance|never collected|uncollected|not (?:been )?collected/i;

function label(thread: IssueThread): string {
  if (thread.issueKey === 'compliance-immigration-backlog') return 'Immigration reporting backlog';
  if (thread.room) return `Room ${thread.room}`;
  return thread.issueKey;
}

function latest(thread: IssueThread) {
  return thread.claims[thread.claims.length - 1];
}

function allRefs(thread: IssueThread): string[] {
  return thread.claims.map((c) => c.sourceRef);
}

/** Append the verbatim non-English original beneath a translated summary. */
function withOriginal(text: string, thread: IssueThread): string {
  const c = latest(thread);
  if (c.lang && c.lang.toLowerCase() !== 'en' && c.originalText) {
    return `${text}\n    ↳ original (${c.lang}): ${c.originalText.replace(/^[-\s]+/, '')}`;
  }
  return text;
}

function isUrgent(thread: IssueThread): boolean {
  if (thread.issueKey === 'compliance-immigration-backlog') return true;
  const text = thread.claims.map((c) => `${c.summary} ${c.originalText ?? ''}`).join(' ');
  return SAFETY_TEXT.test(text) || DEADLINE_TEXT.test(text);
}

/** A grounded, factual line for a thread in an action/FYI bucket. */
function actionLine(thread: IssueThread, targetMorning: string): RenderedLine {
  const c = latest(thread);
  const prefix = thread.issueKey === 'compliance-immigration-backlog' ? '' : thread.room ? `Room ${thread.room} — ` : '';
  let suffix = '';
  const first = thread.claims[0].night;
  if ((thread.state === 'still_open') && first !== targetMorning) suffix = ` (open since ${first})`;
  if (thread.state === 'new_tonight') suffix = ' (new tonight)';
  if (thread.state === 'newly_resolved') suffix = ' (resolved overnight)';
  if (thread.state === 'resolved_earlier') suffix = ` (resolved ${c.night})`;
  return { text: withOriginal(`${prefix}${c.summary}${suffix}`, thread), sourceRefs: allRefs(thread) };
}

function flaggedLine(thread: IssueThread): RenderedLine {
  // Prompt injection: quote verbatim, make clear it was not acted on.
  if (thread.flags.includes('prompt_injection')) {
    const c = latest(thread);
    return {
      text: `Prompt-injection attempt (${label(thread)}) — quoted verbatim, NOT acted on:\n    "${c.originalText ?? c.summary}"`,
      sourceRefs: allRefs(thread),
    };
  }
  // Contradiction: show every side with its status signal; do not pick a winner.
  if (thread.state === 'contradiction') {
    const sides = thread.claims
      .map((c) => `\n    • [${c.statusSignal}] ${c.summary} (${c.sourceRef})`)
      .join('');
    return { text: `Contradiction — ${label(thread)} (needs review, not auto-resolved):${sides}`, sourceRefs: allRefs(thread) };
  }
  // Gap / low-confidence merge.
  const reasons: string[] = [];
  if (thread.gap) reasons.push(`no update since ${latest(thread).night}`);
  if (thread.flags.includes('low_confidence_merge')) reasons.push(`low-confidence thread mapping (${latest(thread).issueKeyConfidence}), not auto-merged`);
  return { text: withOriginal(`${label(thread)} — ${reasons.join('; ')}: ${latest(thread).summary}`, thread), sourceRefs: allRefs(thread) };
}

export function assignBuckets(threads: IssueThread[], targetMorning: string): Bucket[] {
  const actNow: RenderedLine[] = [];
  const pending: RenderedLine[] = [];
  const fyi: RenderedLine[] = [];
  const flagged: RenderedLine[] = [];
  const routineRefs: string[] = [];

  for (const t of threads) {
    const injection = t.flags.includes('prompt_injection');
    const contradiction = t.state === 'contradiction';

    // Footer: contradictions, injection, gaps, low-confidence merges.
    if (injection || contradiction || t.gap || t.flags.includes('low_confidence_merge')) {
      flagged.push(flaggedLine(t));
    }

    // Primary bucket — but injection/contradiction never get an action line.
    if (injection || contradiction) continue;

    const resolved = t.state === 'newly_resolved' || t.state === 'resolved_earlier';
    if (resolved) {
      if (ROUTINE_TYPES.has(t.type)) routineRefs.push(...allRefs(t));
      else fyi.push(actionLine(t, targetMorning));
    } else if (isUrgent(t)) {
      actNow.push(actionLine(t, targetMorning));
    } else {
      pending.push(actionLine(t, targetMorning));
    }
  }

  if (routineRefs.length) {
    fyi.push({ text: `Routine overnight items handled, no action needed (${routineRefs.length}).`, sourceRefs: routineRefs });
  }

  return [
    { id: 'act_now', title: '🔴 Act Now', lines: actNow },
    { id: 'pending', title: '🟡 Pending', lines: pending },
    { id: 'fyi', title: 'ℹ️ FYI', lines: fyi },
    { id: 'flagged', title: '⚠ Flagged for review', lines: flagged },
  ];
}
