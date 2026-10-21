// Drives the real Pocket Notes page the way a user does and saves what it sees under $DONE_DONE_EVIDENCE_ROOT.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.DONE_DONE_BASE_URL;
const out = process.env.DONE_DONE_EVIDENCE_ROOT;
const browser = await chromium.launch({ executablePath: process.env.DONE_DONE_CHROME || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(base);
await page.getByPlaceholder('Type a note').fill('milk');
await page.getByRole('button', { name: 'Save note' }).click();
await page.getByText('milk', { exact: true }).waitFor();
await page.screenshot({ path: `${out}/note-listed.png` });
await browser.close();
// The step record done-done reads beside the capture: what a user did and what they see at the end.
writeFileSync(`${out}/steps.json`, JSON.stringify({
  target: { version: '1.0.0' },
  start: 'the Pocket Notes page with an empty list',
  steps: ['type milk in the Type a note field', 'press Save note'],
  result: 'the note milk is listed below the form',
}));
