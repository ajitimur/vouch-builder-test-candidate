// Plain-text render of a Handover. Every line ends with its sourceRef(s).
import type { Handover } from '../types.js';

export function renderText(h: Handover): string {
  const out: string[] = [];
  out.push(`Night-shift handover — ${h.hotelName} (${h.hotelId})`);
  out.push(`Morning of ${h.targetMorning} · generated ${h.generatedAt}`);
  for (const b of h.buckets) {
    out.push('');
    out.push(b.title);
    if (b.lines.length === 0) {
      out.push('  — none');
      continue;
    }
    for (const line of b.lines) {
      const body = line.text.split('\n').join('\n  ');
      out.push(`  • ${body}  [${line.sourceRefs.join(', ')}]`);
    }
  }
  return out.join('\n') + '\n';
}
