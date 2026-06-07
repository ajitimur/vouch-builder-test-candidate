// Stage 3: the validation gate. Runs between extraction and rendering and is the
// hard guarantee behind "no source -> not in the output". Every claim's sourceRef
// must resolve to something that actually exists in the input set; anything that
// doesn't is dropped and logged, never silently rendered.

import type { Claim } from './types.js';

export interface SourceContext {
  eventIds: Set<string>;
  nightLogLines: number;
}

export interface DroppedClaim {
  sourceRef: string;
  issueKey: string;
  reason: string;
}

export interface ValidationResult {
  valid: Claim[];
  dropped: DroppedClaim[];
}

const NIGHTLOG_REF = /^night-log:L(\d+)(?:-L(\d+))?$/;

export function isValidSourceRef(ref: string, ctx: SourceContext): boolean {
  if (ctx.eventIds.has(ref)) return true;
  const m = NIGHTLOG_REF.exec(ref);
  if (!m) return false;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return start >= 1 && end >= start && end <= ctx.nightLogLines;
}

export function validateClaims(claims: Claim[], ctx: SourceContext): ValidationResult {
  const valid: Claim[] = [];
  const dropped: DroppedClaim[] = [];
  for (const c of claims) {
    if (isValidSourceRef(c.sourceRef, ctx)) {
      valid.push(c);
    } else {
      dropped.push({ sourceRef: c.sourceRef, issueKey: c.issueKey, reason: 'sourceRef not found in input set' });
    }
  }
  return { valid, dropped };
}

/** A prompt-injection claim must never reach an action bucket. */
export function isInjection(claim: Claim): boolean {
  return claim.flags.includes('prompt_injection');
}
