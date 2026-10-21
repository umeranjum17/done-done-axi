// Real browser app + a read-only view of a real done-done check.
// node docs/media/demo.mjs <fresh-scratch-directory> <port>
// In its app/ repo: run --open --json, drive the app and save app.png to the
// printed evidence_root, run --close <id>, then check --json --outcome <claim>
// <evidence_root>/app.png > <scratch>/check.json. Save open output as open.json.
// /proof renders that captured app beside its actual verdict and commit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';

const scratch = resolve(process.argv[2]);
const repo = join(scratch, 'app');
mkdirSync(scratch, { recursive: true });
mkdirSync(repo); // Refuse to overwrite any existing demo repository.
const app = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Release checklist</title>
<style>*{box-sizing:border-box}body{margin:0;padding:14px 18px;background:#f6f7fb;color:#202638;font:14px/1.4 system-ui,sans-serif}header{display:flex;align-items:center;gap:8px;margin-bottom:10px}header span{display:grid;place-items:center;background:#5754d7;color:white;border-radius:7px;width:26px;height:26px}h1{font-size:19px;letter-spacing:-.03em;margin:0}ul{margin:0 0 8px;padding:0;list-style:none}li{display:flex;align-items:center;gap:9px;padding:12px;background:white;border:1px solid #dddfea;border-radius:9px}li label{flex:1;font-weight:600}input[type=checkbox]{accent-color:#5551d7;width:18px;height:18px;margin:0}li b{font-size:11px;background:#e3f4ea;color:#1b643f;padding:3px 7px;border-radius:5px}summary{color:#525a71;font-size:12px;cursor:pointer}form{display:flex;gap:6px;margin-top:8px}input[type=text]{min-width:0;flex:1;border:1px solid #bcc1d1;border-radius:6px;padding:8px;font:inherit}button{border:0;background:#5754d7;color:white;padding:8px 12px;border-radius:6px;font:inherit}:focus-visible{outline:2px solid #5754d7;outline-offset:2px}</style>
<header><span aria-hidden="true">✓</span><h1>Release checklist</h1></header><ul id="tasks"></ul><details open><summary>Add a task</summary><form><input type="text" aria-label="Task" placeholder="What needs checking?" required><button>Add</button></form></details>
<script>const list=document.querySelector('#tasks');const saved=JSON.parse(localStorage.getItem('tasks')||'[]');function draw(){list.replaceChildren();for(const t of saved){const row=document.createElement('li'),box=document.createElement('input'),label=document.createElement('label'),status=document.createElement('b');box.type='checkbox';box.checked=t.done;box.id='task-'+saved.indexOf(t);label.htmlFor=box.id;label.textContent=t.text;status.textContent=t.done?'Done':'To do';box.onchange=()=>{t.done=box.checked;localStorage.setItem('tasks',JSON.stringify(saved));draw()};row.append(box,label,status);list.append(row)}}document.querySelector('form').onsubmit=e=>{e.preventDefault();const input=e.target.querySelector('input');saved.push({text:input.value,done:false});localStorage.setItem('tasks',JSON.stringify(saved));input.value='';document.querySelector('details').open=false;draw()};draw();</script></html>`;
writeFileSync(join(repo, 'index.html'), app);
writeFileSync(join(repo, '.done-done.yaml'), 'app: release-checklist\nevidence:\n  root: ../evidence\n');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Umer', GIT_AUTHOR_EMAIL: 'umer@example.com', GIT_COMMITTER_NAME: 'Umer', GIT_COMMITTER_EMAIL: 'umer@example.com' };
for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['commit', '-qm', 'Add release checklist sample app']])
  execFileSync('git', args, { cwd: repo, env });
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
createServer((req, res) => {
  try {
    let body = app;
    if (req.url === '/proof') {
      const run = JSON.parse(readFileSync(join(scratch, 'open.json'), 'utf8'));
      const check = JSON.parse(readFileSync(join(scratch, 'check.json'), 'utf8'));
      if (check.result !== 'pass') throw new Error('The real check has not passed');
      const screenshot = readFileSync(join(run.evidence_root, 'app.png')).toString('base64');
      const model = escape(check.judge.model);
      body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Real app · real judge</title><style>*{box-sizing:border-box}body{margin:0;background:#11131c;color:#eff0fb;font:14px/1.4 ui-monospace,monospace}img{display:block;width:400px;height:140px}section{padding:12px 18px}p{margin:0 0 5px;color:#b6bad0;font-size:11px}b{color:#83e4ae;font-size:17px}code{font:inherit;color:#eff0fb}</style><img src="data:image/png;base64,${screenshot}" alt="Real captured checklist"><section><p>LIVE JUDGE · ${model}</p><b>PASS</b> <code>· commit ${run.commit.slice(0, 12)}</code><p>Captured app + actual check result</p></section></html>`;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
  } catch (error) { res.writeHead(503, { 'content-type': 'text/plain' }); res.end(error.message); }
}).listen(Number(process.argv[3]), '127.0.0.1', function () { console.log(`Sample app: http://127.0.0.1:${this.address().port}/`); });
