// Core domain types. The Claim schema is the contract that enforces grounding:
// nothing flows downstream without a sourceRef pointing back into the input set.

export type SourceType = 'structured_event' | 'free_text_log';
export type StatusSignal = 'open' | 'resolved' | 'pending' | 'update';

export type ClaimFlag =
  | 'prompt_injection'
  | 'low_confidence_merge'
  | 'incomplete'
  | 'contradiction'
  | 'non_english';

export interface Claim {
  id: string; // claim_001
  sourceRef: string; // "evt_0007" | "night-log:L14-L17"
  sourceType: SourceType;
  night: string; // ISO date of shift-end morning, e.g. "2026-05-30"
  issueKey: string; // canonical thread id
  issueKeyConfidence: number; // 0..1
  room: string | null;
  guest: string | null;
  type: string; // maintenance | compliance | deposit | ...
  statusSignal: StatusSignal;
  summary: string; // 1 sentence, factual, grounded in the source
  originalText: string | null; // raw text for free-text claims (incl. non-English)
  lang: string; // detected language, e.g. "en" | "zh"
  flags: ClaimFlag[];
}

export type ThreadState =
  | 'new_tonight'
  | 'still_open'
  | 'newly_resolved'
  | 'resolved_earlier'
  | 'contradiction';

export interface IssueThread {
  issueKey: string;
  room: string | null;
  type: string;
  state: ThreadState;
  claims: Claim[]; // ordered by timestamp/night
  flags: ClaimFlag[]; // union of claim flags + thread-level (e.g. contradiction, gap)
  gap: boolean; // thread has no update on/near the target night
}

export type BucketId = 'act_now' | 'pending' | 'fyi' | 'flagged';

export interface RenderedLine {
  text: string;
  sourceRefs: string[];
}

export interface Bucket {
  id: BucketId;
  title: string;
  lines: RenderedLine[];
}

export interface Handover {
  hotelId: string;
  hotelName: string;
  targetMorning: string; // ISO date
  generatedAt: string; // ISO timestamp
  buckets: Bucket[];
  degraded: boolean; // true if free-text night log could not be processed for this input
}

// Raw shape of data/events.json
export interface RawEvent {
  id: string;
  timestamp: string;
  type: string;
  room: string | null;
  guest: string | null;
  description: string;
  status: string;
}

export interface RawEventsFile {
  hotel: { id: string; name: string; rooms: number; timezone: string };
  note: string;
  events: RawEvent[];
}
