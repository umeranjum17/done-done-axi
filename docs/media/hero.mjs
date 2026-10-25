// Build the README hero pages from the captured CLI transcripts in this folder.
// Every value shown is asserted to exist in a transcript; only field order and long paths change.
// Usage: node docs/media/hero.mjs, then screenshot .hero/hero-desktop.html (888x543) and
// .hero/hero-phone.html (418x725) at device scale factor 2, in light and dark:
// hero-light.png, hero-dark.png, hero-phone-light.png, hero-phone-dark.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const pass = readFileSync(join(dir, 'hero-run.txt'), 'utf8');
const refuse = readFileSync(join(dir, 'hero-refuse.txt'), 'utf8');
const need = (hay, s) => {
  if (!hay.includes(s)) throw new Error(`not in the captured transcript: ${s}`);
  return s;
};

const commit = need(pass, 'eb28807b359e31d9a4e7ef5cad31aaafa7e4a4aa');
const reason = need(pass, 'The capture shows node greet.mjs Umer printing Hello Umer, matching the stated outcome.');
const model = need(pass, 'openai-codex/gpt-6.1-sol');
const err = need(refuse, 'init --journey tests: npm test is code-only: a test, typecheck, lint or build run proves the code checks pass, not that the product works, so check and gate never count its run as proof; nothing was written');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const L = (cls, s) => `<div class="${cls}">${esc(s)}</div>`;

const body = ({ phone }) => [
  L('cmd', '$ done-done run greet'),
  L('out', 'result: recorded'),
  L('out', `commit: ${commit}`),
  L('out', 'dirty: false'),
  L('out', 'files: 1'),
  '',
  L('cmd', `$ done-done check --outcome "greeting Umer prints Hello Umer" ${phone ? '…' : '…terminal.txt'}`),
  L('ok', 'result: pass'),
  L('out', 'judge: answerer:pi'),
  L('out', `model: ${model}`),
  L('ok', `reason: "${reason}"`),
  '',
  L('cmd', '$ done-done receipt --outcome "greeting Umer prints Hello Umer"'),
  L('ok', 'result: pass'),
  L('out', `receipt: receipts/${commit}.json`),
  '<div class="rule"></div>',
  L('cmd', "$ done-done init --journey tests -- 'npm test'"),
  L('bad', 'result: fail'),
  L('bad', `error: ${err}`),
].join('\n');

const page = ({ width, font, phone, title }) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; background: #f6f8fa; }
  body { font: ${font}px/1.62 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .card { width: ${width}px; box-sizing: border-box; margin: 14px; padding: 16px 18px; border-radius: 10px;
          background: #fff; border: 1px solid #d8dee4; color: #1f2328; }
  .meta { font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: .01em; color: #57606a; margin-bottom: 10px; }
  .cmd { color: #6639ba; font-weight: 600; margin-top: 10px; white-space: pre-wrap; word-break: break-word; }
  .out { color: #1f2328; white-space: pre-wrap; word-break: break-word; }
  .ok { color: #1a7f37; white-space: pre-wrap; word-break: break-word; }
  .bad { color: #b42318; white-space: pre-wrap; word-break: break-word; }
  .rule { border-top: 1px dashed #d8dee4; margin: 14px 0 2px; }
  @media (prefers-color-scheme: dark) {
    html, body { background: #0d1117; }
    .card { background: #161b22; border-color: #30363d; color: #e6edf3; }
    .meta { color: #8b949e; }
    .cmd { color: #d2a8ff; }
    .out { color: #e6edf3; }
    .ok { color: #3fb950; }
    .bad { color: #ff7b72; }
    .rule { border-color: #30363d; }
  }
</style>
<div class="card">
<div class="meta">done-done 0.6.12 · real run on a small sample app</div>
${body({ phone })}
</div>`;

const out = join(dir, '.hero');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'hero-desktop.html'), page({ width: 860, font: 14, phone: false, title: 'done-done hero, desktop' }));
writeFileSync(join(out, 'hero-phone.html'), page({ width: 390, font: 13, phone: true, title: 'done-done hero, phone' }));
console.log(`wrote ${out}/hero-desktop.html and ${out}/hero-phone.html`);
