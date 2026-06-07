// Deterministic prompt-injection heuristic. Input is data, never instructions.
// Anything that looks like it is trying to command the handover tool/system gets
// flagged so it can be quarantined into the "flagged for review" bucket verbatim,
// never executed. This is a coarse net on purpose — false positives are cheap
// (a human reviews them); a missed injection is the dangerous case.

const SIGNALS: RegExp[] = [
  /\bignore (all|any|previous|other|the)\b/i,
  /\bdisregard\b/i,
  /\bsystem (note|prompt|message|instruction)\b/i,
  /\bto the (handover|tool|system|assistant|ai)\b/i,
  /\breport .*(as )?(all )?clear\b/i,
  /\bmark (it|this|them) (approved|resolved|clear)\b/i,
  /\boverride\b/i,
  /\byou (must|should|will) (now|ignore|add|approve)\b/i,
];

export function detectInjection(text: string | null | undefined): boolean {
  if (!text) return false;
  return SIGNALS.some((re) => re.test(text));
}
