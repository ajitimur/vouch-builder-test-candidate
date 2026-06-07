// Dev script: re-generate fixtures/nightlog-claims.json from a live LLM call.
// Run with a key set: `ANTHROPIC_API_KEY=... npm run extract`. Lets us refresh the
// cached fallback whenever the prompt/data changes, without a key at request time.

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEventsFile, extractEventClaims } from './events.js';
import { candidateKeys } from '../reconcile/issueKey.js';
import { loadNightLog } from './nightlogs.js';
import { extractClaimsLLM, isLLMAvailable } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../fixtures/nightlog-claims.json');

if (!isLLMAvailable()) {
  console.error('ANTHROPIC_API_KEY not set — cannot refresh fixture from a live call.');
  process.exit(1);
}

const keys = candidateKeys(extractEventClaims(loadEventsFile()).map((c) => c.issueKey));
const file = loadNightLog();
const result = await extractClaimsLLM(file.numbered, keys);
writeFileSync(OUT, JSON.stringify(result.claims, null, 2) + '\n');
console.log(`Wrote ${result.claims.length} claims to ${OUT} (${result.tokens.input}+${result.tokens.output} tok)`);
