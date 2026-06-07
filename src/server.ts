// HTTP surface. One handover generator, three views (JSON / HTML / text) so a
// curl, a browser, or a Slack/email pipe can all consume it.
//   GET /handover[.html|.txt]?night=YYYY-MM-DD   (night defaults to the latest)
//   GET /healthz

import express from 'express';
import { generateHandover } from './pipeline.js';
import { renderHtml } from './render/html.js';
import { renderText } from './render/text.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

function nightParam(q: unknown): string | undefined {
  if (typeof q === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  return undefined;
}

async function handle(req: express.Request, res: express.Response, view: 'json' | 'html' | 'text') {
  try {
    const { handover, log } = await generateHandover({ night: nightParam(req.query.night) });
    if (view === 'html') return res.type('html').send(renderHtml(handover));
    if (view === 'text') return res.type('text').send(renderText(handover));
    return res.json({ handover, log });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'handover_failed', error: String(err) }));
    return res.status(500).json({ error: 'handover generation failed', detail: String(err) });
  }
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/handover', (req, res) => handle(req, res, 'json'));
app.get('/handover.html', (req, res) => handle(req, res, 'html'));
app.get('/handover.txt', (req, res) => handle(req, res, 'text'));
app.get('/', (req, res) => handle(req, res, 'html'));

app.listen(PORT, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: PORT }));
});
