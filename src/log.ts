// Structured, one-line-JSON logging. The goal (per CLAUDE.md): a future builder or
// AI agent can grep `hotelId=lumen-sg night=2026-05-30` and reconstruct exactly
// why a handover looked the way it did — what was extracted, dropped, and flagged.

import type { ClaimFlag } from './types.js';

export interface FlagDetail {
  type: ClaimFlag | 'gap';
  sourceRefs: string[];
  reason: string;
}

export interface HandoverLog {
  hotelId: string;
  targetMorning: string;
  timestamp: string;
  counts: {
    claimsExtracted: number;
    claimsDropped: number;
    threadsOpen: number;
    threadsResolved: number;
    flagsRaised: number;
  };
  flags: FlagDetail[];
  llm: {
    source: 'llm' | 'fixture';
    model: string;
    tokens: { input: number; output: number };
    extractionConfidenceMean: number;
  };
}

export function emitLog(log: HandoverLog): void {
  // Flat keys up front make `grep hotelId=... night=...` trivial in aggregated logs.
  console.log(
    `hotelId=${log.hotelId} night=${log.targetMorning} ` + JSON.stringify(log),
  );
}
