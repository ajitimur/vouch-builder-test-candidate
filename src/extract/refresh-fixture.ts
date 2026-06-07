// Dev script: re-generate the content-addressed cache from a live LLM call.
// Run with a key set: `ANTHROPIC_API_KEY=... npm run extract`. The cache stores
// the hash of the night log it was built from, so it is only ever reused against
// that exact text (see loadCache).

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { loadEventsFile, extractEventClaims } from './events.js';
import { candidateKeys } from '../reconcile/issueKey.js';
import { loadNightLog, sourceHashOf, CACHE_PATH, type NightLogCache } from './nightlogs.js';
import { extractClaimsLLM, isLLMAvailable } from './llm.js';

if (!isLLMAvailable()) {
  console.error('ANTHROPIC_API_KEY not set — cannot refresh the cache from a live call.');
  process.exit(1);
}

const keys = candidateKeys(extractEventClaims(loadEventsFile()).map((c) => c.issueKey));
const file = loadNightLog();
const result = await extractClaimsLLM(file.numbered, keys);
const cache: NightLogCache = {
  sourceHash: sourceHashOf(file),
  generatedAt: new Date().toISOString(),
  model: result.model,
  claims: result.claims,
};
writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
console.log(`Wrote ${result.claims.length} claims to ${CACHE_PATH} (hash ${cache.sourceHash.slice(0, 12)}…, ${result.tokens.input}+${result.tokens.output} tok)`);
