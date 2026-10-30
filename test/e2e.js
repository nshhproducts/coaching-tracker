const { chromium } = require('playwright'); const path = require('path'); const http = require('http'); const fs = require('fs');
(async () => {
  // static server for index.html (fetch to localhost from file:// is blocked)
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html); }).listen(8788);
  const browser = await chromium.launch(); const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then(c => c.newPage());
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:8788/');
  await page.evaluate(() => { localStorage.setItem('coachtracker_clients_v2', JSON.stringify([{ name: 'Nick', url: 'https://script.google.com/macros/s/x/exec', token: 'test', startDate: '2026-08-24' }])); });
  // point the app at the mock API by patching fetch
  await page.addInitScript(() => { const of = window.fetch; window.fetch = (u, o) => of(u.startsWith('https://script.google.com') ? 'http://localhost:8787/' : u, o); });
  await page.reload(); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'shot_train.png') });
  // log a set in week 10 exercise 2 and save
  await page.fill('.ex[data-ex] input[data-s="0"][data-k="w"] >> nth=1', '55');
  await page.fill('.ex[data-ex] input[data-s="0"][data-k="r"] >> nth=1', '7');
  await page.click('#saveLog'); await page.waitForTimeout(800);
  for (const t of ['weight', 'checkin', 'measure', 'more']) { await page.click(`nav button[data-tab="${t}"]`); await page.waitForTimeout(500); await page.screenshot({ path: path.join(__dirname, `shot_${t}.png`) }); }
  await page.click('nav button[data-tab="weight"]'); await page.fill('#wKg', '75,3'); await page.fill('#wSleep', '7'); await page.click('#saveDay'); await page.waitForTimeout(600);
  const writes = await page.evaluate(async () => (await (await fetch('http://localhost:8787/', { method: 'POST', body: JSON.stringify({ token: 'test', action: '__writes' }) })).json()));
  console.log('writes:', JSON.stringify(writes.filter(w => w.action !== 'all' && w.action !== '__writes')));
  console.log('errors:', errors);
  await browser.close(); process.exit(0);
})();
