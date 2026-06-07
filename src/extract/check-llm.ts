// Verification harness for the live LLM extraction path. Run after setting a key:
//   ANTHROPIC_API_KEY=... npm run check:llm   (or put the key in .env)
//
// It calls the real model through the same functions the server uses
// (extractClaimsLLM -> buildClaims), then asserts the output is well-formed and
// grounded, prints a per-claim report, and diffs against the committed fixture so
// you can see whether a refresh is warranted.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEventsFile, extractEventClaims } from './events.js';
import { candidateKeys } from '../reconcile/issueKey.js';
import { loadNightLog, buildClaims } from './nightlogs.js';
import { extractClaimsLLM, isLLMAvailable, type RawLLMClaim } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../../fixtures/nightlog-claims.json');

if (!isLLMAvailable()) {
  console.error('✗ ANTHROPIC_API_KEY is not set. Add it to .env or export it, then re-run.');
  process.exit(1);
}

const VALID_SIGNALS = new Set(['open', 'resolved', 'pending', 'update']);
const fail: string[] = [];
const warn: string[] = [];
function check(cond: boolean, msg: string) { if (!cond) fail.push(msg); }

const eventKeys = new Set(extractEventClaims(loadEventsFile()).map((c) => c.issueKey));
const keys = candidateKeys([...eventKeys]);
const file = loadNightLog();

console.log(`Calling the model on ${file.lines.length} lines of night-logs.md …\n`);

let raw: RawLLMClaim[];
let model = '';
let tokens = { input: 0, output: 0 };
try {
  const res = await extractClaimsLLM(file.numbered, keys);
  raw = res.claims;
  model = res.model;
  tokens = res.tokens;
} catch (err) {
  console.error(`✗ Live call failed: ${String(err)}`);
  process.exit(1);
}

// Run the production grounding step.
const { claims, dropped } = buildClaims(raw, file);

console.log(`Model: ${model}   tokens: ${tokens.input} in / ${tokens.output} out`);
console.log(`Raw claims: ${raw.length}   built: ${claims.length}   dropped (bad line refs): ${dropped}\n`);

// Per-claim report + per-claim validation.
for (const c of claims) {
  const onExistingThread = eventKeys.has(c.issueKey);
  console.log(
    `  ${c.sourceRef.padEnd(18)} ${c.issueKey.padEnd(28)} conf=${c.issueKeyConfidence}` +
    ` ${onExistingThread ? '↔ linked' : '＋ new   '} lang=${c.lang} [${c.flags.join(',')}]`,
  );
  console.log(`      ${c.summary}`);
  check(VALID_SIGNALS.has(c.statusSignal), `${c.sourceRef}: invalid statusSignal ${c.statusSignal}`);
  check(c.summary.trim().length > 0, `${c.sourceRef}: empty summary`);
  check(c.issueKey.trim().length > 0, `${c.sourceRef}: empty issueKey`);
  check(c.issueKeyConfidence >= 0 && c.issueKeyConfidence <= 1, `${c.sourceRef}: confidence out of range`);
  check(c.originalText !== null && c.originalText.length > 0, `${c.sourceRef}: missing verbatim originalText`);
  if (c.lang !== 'en') check(c.flags.includes('non_english'), `${c.sourceRef}: non-English not flagged`);
}

// Structural assertions.
check(raw.length > 0, 'model returned zero claims');
check(dropped === 0, `${dropped} claim(s) cited line ranges that do not exist`);
const langs = new Set(claims.map((c) => c.lang));
if (!langs.has('zh')) warn.push('no Chinese entries detected — the zh lines (L19, L27) may have been mislabelled or merged');
const linked = claims.filter((c) => eventKeys.has(c.issueKey)).length;
if (linked < 3) warn.push(`only ${linked} claim(s) mapped onto existing event threads — cross-source reconciliation may be weak`);

// Diff against the committed cache (by sourceRef -> issueKey).
const fixture = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { claims: RawLLMClaim[] }).claims;
const fixByRange = new Map(fixture.map((c) => [`${c.lineStart}-${c.lineEnd}`, c]));
const diffs: string[] = [];
for (const c of raw) {
  const f = fixByRange.get(`${c.lineStart}-${c.lineEnd}`);
  if (!f) diffs.push(`  + live has a claim at L${c.lineStart}-${c.lineEnd} not in fixture (issueKey=${c.issueKey})`);
  else if (f.issueKey !== c.issueKey) diffs.push(`  ~ L${c.lineStart}-${c.lineEnd}: issueKey live=${c.issueKey} vs fixture=${f.issueKey}`);
}
for (const f of fixture) {
  if (!raw.some((c) => c.lineStart === f.lineStart && c.lineEnd === f.lineEnd)) {
    diffs.push(`  - fixture has a claim at L${f.lineStart}-${f.lineEnd} the live call did not produce`);
  }
}

console.log('\n— diff vs committed fixture —');
console.log(diffs.length ? diffs.join('\n') : '  (identical claim set + issueKeys)');
if (diffs.length) console.log('  → run `npm run extract` to refresh the fixture if the live output is correct.');

console.log('\n— result —');
for (const w of warn) console.log(`  ⚠ ${w}`);
if (fail.length) {
  for (const f of fail) console.log(`  ✗ ${f}`);
  console.log(`\nFAIL: ${fail.length} check(s) failed.`);
  process.exit(1);
}
console.log('  ✓ all structural + grounding checks passed.');
