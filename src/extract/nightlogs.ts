// Stage 1b: turn the free-text night log into Claim[]. The LLM proposes claims
// with line citations; this module owns grounding. For every model claim we:
//   - validate the cited line range exists (else drop + log the drop),
//   - reconstruct originalText verbatim from the file (not from the model),
//   - build the sourceRef from line numbers,
//   - derive flags deterministically (injection, non-English, low-confidence).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Claim, ClaimFlag } from '../types.js';
import { detectInjection } from '../injection.js';
import { extractClaimsLLM, isLLMAvailable, type LLMResult, type RawLLMClaim } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '../../data/night-logs.md');
const FIXTURE_PATH = resolve(__dirname, '../../fixtures/nightlog-claims.json');

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
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');
  const numbered = lines.map((l, i) => `L${i + 1}: ${l}`).join('\n');
  return { lines, numbered, morning: parseMorning(lines, '2026') };
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

interface ExtractionMeta {
  source: 'llm' | 'fixture';
  model: string;
  tokens: { input: number; output: number };
  raw: number; // claims the model produced
  dropped: number; // claims dropped for bad/absent line refs
}

export interface NightLogExtraction {
  claims: Claim[];
  meta: ExtractionMeta;
}

function loadFixture(): LLMResult {
  const claims = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as RawLLMClaim[];
  return { claims, source: 'fixture', model: 'fixture', tokens: { input: 0, output: 0 } };
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

export async function extractNightLogClaims(
  candidateKeys: string[],
  file: NightLogFile = loadNightLog(),
): Promise<NightLogExtraction> {
  let result: LLMResult;
  if (isLLMAvailable()) {
    try {
      result = await extractClaimsLLM(file.numbered, candidateKeys);
    } catch (err) {
      // Live call failed (rate limit, transient error): degrade to the cached
      // fixture rather than returning an empty/incorrect handover.
      console.error(JSON.stringify({ level: 'warn', msg: 'llm_extract_failed_fallback_fixture', error: String(err) }));
      result = loadFixture();
    }
  } else {
    result = loadFixture();
  }

  const { claims, dropped } = buildClaims(result.claims, file);
  return {
    claims,
    meta: {
      source: result.source,
      model: result.model,
      tokens: result.tokens,
      raw: result.claims.length,
      dropped,
    },
  };
}
