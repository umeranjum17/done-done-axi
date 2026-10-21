import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.env.PORT || 4100);
const dataFile = join(process.env.NOTES_DATA || '.', 'notes.json');
const page = readFileSync(new URL('./public/index.html', import.meta.url));

const load = () => (existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : []);
const save = (notes) => writeFileSync(dataFile, JSON.stringify(notes));

createServer((req, res) => {
  if (req.url === '/health') return res.end('ok');
  if (req.url === '/api/notes' && req.method === 'GET') return res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(load()));
  if (req.url === '/api/notes' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { text } = JSON.parse(body || '{}');
      if (!text || !text.trim()) return res.writeHead(400).end('text is required');
      const notes = load();
      notes.push({ id: notes.length + 1, text: text.trim() });
      save(notes);
      res.writeHead(201).end(JSON.stringify(notes.at(-1)));
    });
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(page);
}).listen(port, () => console.log(`pocket-notes on http://127.0.0.1:${port}`));
