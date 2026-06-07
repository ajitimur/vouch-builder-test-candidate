// Minimal HTML render. Utility over beauty: a morning manager should grasp it in
// 60 seconds. Every line shows its sourceRef(s) as a grounding trail.
import type { Bucket, Handover } from '../types.js';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function bucketHtml(b: Bucket): string {
  const items = b.lines.length
    ? b.lines
        .map((l) => {
          const body = esc(l.text).replace(/\n\s*/g, '<br><span class="sub">') + (l.text.includes('\n') ? '</span>' : '');
          const refs = l.sourceRefs.map((r) => `<code>${esc(r)}</code>`).join(' ');
          return `<li>${body} <span class="refs">[${refs}]</span></li>`;
        })
        .join('\n')
    : '<li class="none">— none</li>';
  return `<section class="b ${b.id}"><h2>${esc(b.title)}</h2><ul>${items}</ul></section>`;
}

export function renderHtml(h: Handover): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handover — ${esc(h.hotelName)} — ${esc(h.targetMorning)}</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1a1a1a}
  h1{font-size:20px;margin:0 0 2px} .meta{color:#666;margin:0 0 16px}
  section{border:1px solid #e3e3e3;border-radius:8px;padding:10px 16px;margin:12px 0}
  h2{font-size:16px;margin:4px 0 8px} ul{margin:0;padding-left:20px} li{margin:6px 0}
  .refs{color:#888;font-size:12px} code{background:#f2f2f2;padding:1px 4px;border-radius:3px;font-size:12px}
  .sub{color:#555;font-size:13px} .none{color:#aaa;list-style:none;margin-left:-20px}
  .act_now{border-color:#e0b4b4;background:#fdf5f5} .pending{border-color:#e6d8a8;background:#fffdf3}
  .flagged{border-color:#cdb4e0;background:#faf6fd}
</style></head><body>
<h1>Night-shift handover — ${esc(h.hotelName)}</h1>
<p class="meta">Morning of <b>${esc(h.targetMorning)}</b> · ${esc(h.hotelId)} · generated ${esc(h.generatedAt)}</p>
${h.buckets.map(bucketHtml).join('\n')}
</body></html>`;
}
