// Stage 1b: turn the free-text night log into Claim[]. The LLM proposes claims
// with line citations; this module owns grounding. For every model claim we:
//   - validate the cited line range exists (else drop + log the drop),
//   - reconstruct originalText verbatim from the file (not from the model),
//   - build the sourceRef from line numbers,
//   - derive flags deterministically (injection, non-English, low-confidence).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Claim, ClaimFlag } from '../types.js';
import { detectInjection } from '../injection.js';
import { extractClaimsLLM, isLLMAvailable, type RawLLMClaim } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '../../data/night-logs.md');
export const CACHE_PATH = resolve(__dirname, '../../fixtures/nightlog-claims.json');

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export interface NightLogFile {
  lines: string[]; // 1-indexed access via lines[n-1]
  numbered: string; // "L1: ...\nL2: ..." for the model
  morning: string; // ISO date of the shift-end morning
}

export function loadNightLog(path: string = LOG_PATH): NightLogFile {
  const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const numbered = lines.map((l, i) => `L${i + 1}: ${l}`).join('\n');
  return { lines, numbered, morning: parseMorning(lines, '2026') };
}

/** Content fingerprint of a night log. The cache is only valid for the exact text it was built from. */
export function sourceHashOf(file: NightLogFile): string {
  return createHash('sha256').update(file.lines.join('\n')).digest('hex');
}

/** Parse "→ morning Thu 28 May" from a section header; fall back to a sane default. */
function parseMorning(lines: string[], year: string): string {
  for (const l of lines) {
    const m = /morning[^,\n]*?\b(\d{1,2})\s+([A-Za-z]{3})/i.exec(l);
    if (m) {
      const day = m[1].padStart(2, '0');
      const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mon) return `${year}-${mon}-${day}`;
    }
  }
  return `${year}-01-01`;
}

// The cache is content-addressed: it carries the hash of the night log it was
// extracted from, so it can never be (mis)applied to text it was not built for.
export interface NightLogCache {
  sourceHash: string;
  generatedAt: string;
  model: string;
  claims: RawLLMClaim[];
}

interface ExtractionMeta {
  source: 'llm' | 'cache' | 'unavailable';
  model: string;
  tokens: { input: number; output: number };
  raw: number; // claims the model produced
  dropped: number; // claims dropped for bad/absent line refs
  degraded: boolean; // free-text could not be processed for this exact input
  unprocessedLines: number; // count of content lines left unanalysed when degraded
}

export interface NightLogExtraction {
  claims: Claim[];
  meta: ExtractionMeta;
}

/**
 * Load the cached claims ONLY if they were generated from this exact night log.
 * A hash mismatch (or missing cache) returns null — we must never attach cached
 * summaries to lines they did not come from. Whole-file hash on purpose: the
 * model's claim splitting/clustering depends on the whole document, so partial
 * reuse against changed text is unsound.
 */
export function loadCache(file: NightLogFile): RawLLMClaim[] | null {
  let cache: NightLogCache;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as NightLogCache;
  } catch {
    return null;
  }
  if (!cache.sourceHash || cache.sourceHash !== sourceHashOf(file)) return null;
  return cache.claims;
}

function countContentLines(file: NightLogFile): number {
  return file.lines.filter((l) => l.trim().length > 0).length;
}

// CJK Unified Ideographs + common Chinese punctuation. Cheap, deterministic, and
// good enough to guarantee non-English entries are flagged and their original kept.
const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;

/** Detect language from the verbatim source, falling back to the model's label. */
export function detectLang(originalText: string, modelLang: string | undefined): string {
  if (CJK.test(originalText)) return 'zh';
  return modelLang && modelLang.trim() ? modelLang : 'en';
}

/** Deterministically turn raw model claims into grounded Claim[]. Shared by live + fixture. */
export function buildClaims(
  rawClaims: RawLLMClaim[],
  file: NightLogFile,
): { claims: Claim[]; dropped: number } {
  const claims: Claim[] = [];
  let dropped = 0;

  rawClaims.forEach((rc, i) => {
    const start = rc.lineStart;
    const end = rc.lineEnd ?? rc.lineStart;
    // Grounding gate: the cited lines must exist in the file.
    if (!Number.isInteger(start) || start < 1 || end > file.lines.length || end < start) {
      dropped += 1;
      return;
    }
    const originalText = file.lines.slice(start - 1, end).join('\n').trim();
    const sourceRef = start === end ? `night-log:L${start}` : `night-log:L${start}-L${end}`;
    // Don't trust the model for language: detect non-English from the verbatim
    // source so the original is always preserved and flagged, even if the model
    // labels a translated Chinese line as "en".
    const lang = detectLang(originalText, rc.lang);

    const flags: ClaimFlag[] = [];
    if (rc.isInstructionToSystem || detectInjection(originalText)) flags.push('prompt_injection');
    if (lang.toLowerCase() !== 'en') flags.push('non_english');
    if (rc.issueKeyConfidence < 0.7) flags.push('low_confidence_merge');

    claims.push({
      id: `claim_log_${String(i + 1).padStart(3, '0')}`,
      sourceRef,
      sourceType: 'free_text_log',
      night: file.morning,
      issueKey: rc.issueKey,
      issueKeyConfidence: rc.issueKeyConfidence,
      room: rc.room ?? null,
      guest: rc.guest ?? null,
      type: rc.type,
      statusSignal: rc.statusSignal,
      summary: rc.summary.trim(),
      originalText,
      lang,
      flags,
    });
  });

  return { claims, dropped };
}

function degraded(file: NightLogFile): NightLogExtraction {
  // Free text could not be processed for THIS input. Emit nothing rather than
  // fabricating — the caller surfaces a visible flag and still renders structured
  // events. Never silently attach stale cache summaries to unseen lines.
  console.error(JSON.stringify({ level: 'warn', msg: 'free_text_extraction_unavailable', reason: 'no LLM and no cache matching this night log', unprocessedLines: countContentLines(file) }));
  return {
    claims: [],
    meta: { source: 'unavailable', model: 'none', tokens: { input: 0, output: 0 }, raw: 0, dropped: 0, degraded: true, unprocessedLines: countContentLines(file) },
  };
}

export async function extractNightLogClaims(
  candidateKeys: string[],
  file: NightLogFile = loadNightLog(),
): Promise<NightLogExtraction> {
  // Production path: live extraction over the actual input.
  if (isLLMAvailable()) {
    try {
      const res = await extractClaimsLLM(file.numbered, candidateKeys);
      const { claims, dropped } = buildClaims(res.claims, file);
      return { claims, meta: { source: 'llm', model: res.model, tokens: res.tokens, raw: res.claims.length, dropped, degraded: false, unprocessedLines: 0 } };
    } catch (err) {
      // Transient failure: a cache is only safe to use if it matches THIS input.
      console.error(JSON.stringify({ level: 'warn', msg: 'llm_extract_failed', error: String(err) }));
    }
  }

  // No key, or live call failed: use the cache only if it was built from this
  // exact night log; otherwise degrade visibly.
  const cached = loadCache(file);
  if (!cached) return degraded(file);
  const { claims, dropped } = buildClaims(cached, file);
  return { claims, meta: { source: 'cache', model: 'cache', tokens: { input: 0, output: 0 }, raw: cached.length, dropped, degraded: false, unprocessedLines: 0 } };
}
