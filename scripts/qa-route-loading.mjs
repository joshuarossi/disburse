/** Measure local built route loading in fresh contexts, with no connected wallet. */
import { chromium, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const label = process.argv[2];
if (!['before', 'after'].includes(label)) throw new Error('Choose before or after');
const origin = 'http://127.0.0.1:4180';
const browser = await chromium.launch();
const results = [];
try {
  for (const path of ['/', '/docs', '/recipient-details', '/login']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const started = Date.now();
    console.log(`Checking built route ${path}`);
    await page.goto(origin + path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This page could not load', exact: true })).toHaveCount(0);
    if (path === '/login') await expect(page.getByRole('button', { name: /^Connect wallet$/i })).toBeVisible();
    // Let deferred connectors finish initialization before comparing what loaded.
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => new URL(e.name).origin === location.origin && new URL(e.name).pathname.endsWith('.js')).map(e => ({ file: new URL(e.name).pathname, bytes: e.encodedBodySize })));
    const result = { path, milliseconds: Date.now()-started, bytes: scripts.reduce((n, s) => n+s.bytes, 0), scripts, errors };
    results.push(result); console.log(JSON.stringify({ path, bytes: result.bytes, scripts: scripts.length, errors: errors.length }));
    await context.close();
  }
  writeFileSync(`.local/qa/route-loading-${label}.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
