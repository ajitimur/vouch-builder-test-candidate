// Stage 1a: deterministic extraction of structured events into Claim[].
// No LLM here — events.json is already structured, so we map it 1:1. The event's
// own description is used verbatim as the claim summary (grounded by construction).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Claim, ClaimFlag, RawEvent, RawEventsFile, StatusSignal } from '../types.js';
import { nightOf } from '../config.js';
import { canonicalIssueKey } from '../reconcile/issueKey.js';
import { detectInjection } from '../injection.js';

// A consequential action proposed without the substantiation it needs is an
// "incomplete entry" the brief wants surfaced for review, not quietly actioned —
// e.g. evt_0023: a SGD 500 damage charge with "no photos" and "no manager
// approval on record". Deterministic + narrow: proposed money movement that the
// text itself admits is missing evidence/sign-off.
const PROPOSED_ACTION = /\b(propos|charg|fee|deduct|bill|deposit forfeit)/i;
const MISSING_SUBSTANTIATION = /\bno photos?\b|\bno (?:manager )?approval\b|not (?:yet )?approved|without approval|no (?:manager )?sign-?off|no evidence|approval[^.]*\b(?:not|pending)\b/i;

function detectIncomplete(description: string, status: string): boolean {
  if (status === 'resolved') return false;
  return PROPOSED_ACTION.test(description) && MISSING_SUBSTANTIATION.test(description);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../../data/events.json');

function statusSignal(raw: string): StatusSignal {
  switch (raw) {
    case 'resolved':
      return 'resolved';
    case 'unresolved':
      return 'open';
    case 'pending':
      return 'pending';
    default:
      return 'update';
  }
}

export function loadEventsFile(path: string = DATA_PATH): RawEventsFile {
  return JSON.parse(readFileSync(path, 'utf8')) as RawEventsFile;
}

export function extractEventClaims(file: RawEventsFile): Claim[] {
  return file.events.map((e: RawEvent, i): Claim => {
    const flags: ClaimFlag[] = [];
    if (detectInjection(e.description)) flags.push('prompt_injection');
    if (detectIncomplete(e.description, e.status)) flags.push('incomplete');

    return {
      id: `claim_evt_${String(i + 1).padStart(3, '0')}`,
      sourceRef: e.id,
      sourceType: 'structured_event',
      night: nightOf(e.timestamp),
      issueKey: canonicalIssueKey({
        type: e.type,
        room: e.room,
        description: e.description,
        sourceRef: e.id,
      }),
      issueKeyConfidence: 1,
      room: e.room,
      guest: e.guest,
      type: e.type,
      statusSignal: statusSignal(e.status),
      summary: e.description.trim(),
      originalText: e.description,
      lang: 'en',
      flags,
    };
  });
}
