// Visual + runtime smoke test using Playwright against the real page.
// Run: NODE_PATH=/opt/node22/lib/node_modules node _visualtest.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'index.html');

const browser = await chromium.launch();
// iPhone 13-ish viewport
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url);
await page.waitForTimeout(300);

// --- pre-snap ---
await page.screenshot({ path: '_shot_1_presnap.png' });
const levWord = await page.textContent('#lev-word');
const chipCount = await page.locator('#field .chip').count();
console.log('leverage shown:', levWord, '| chips on field:', chipCount);

// open coach hint
await page.click('#hint-btn');
await page.waitForTimeout(150);
await page.screenshot({ path: '_shot_2_hint.png' });

// pick the route that matches the read (slant vs outside, out vs inside)
const goodRoute = levWord.trim() === 'outside' ? 'slant' : 'out';
await page.click(`.route-btn[data-route="${goodRoute}"]`);
await page.waitForTimeout(150);
const routeLineCount = await page.locator('#routes polyline').count();
console.log('picked route:', goodRoute, '| polylines drawn:', routeLineCount);
await page.screenshot({ path: '_shot_3_route_picked.png' });

// tap a player chip to see the card
await page.locator('#field .chip.primary').click();
await page.waitForTimeout(150);
const cardName = await page.textContent('#card .card-name').catch(() => '(no card)');
console.log('player card name:', cardName);
await page.screenshot({ path: '_shot_4_card.png' });
await page.click('#card .card-close');
await page.waitForTimeout(100);

// snap! capture mid-animation
await page.click('#snap-btn');
await page.waitForTimeout(1400); // a couple ticks in
await page.screenshot({ path: '_shot_5_midplay.png' });
const midCaption = await page.textContent('#tick-caption').catch(() => '');
console.log('mid-play caption:', midCaption);

// wait for postplay
await page.waitForSelector('#postplay:not(.hidden)', { timeout: 8000 });
await page.waitForTimeout(300);
const resultText = await page.textContent('#result-line');
const bdRows = await page.locator('#breakdown .bd-row').count();
console.log('result:', resultText, '| breakdown rows:', bdRows);
await page.screenshot({ path: '_shot_6_breakdown.png' });

// expand a math row
await page.locator('#breakdown .bd-row').first().click();
await page.waitForTimeout(120);
await page.screenshot({ path: '_shot_7_math.png' });

// run several more plays headless to shake out runtime errors across branches
await page.click('#next-btn');
for (let i = 0; i < 8; i++) {
  const lev = (await page.textContent('#lev-word')).trim();
  const routes = ['slant', 'out', 'hitch'];
  const r = routes[i % 3];
  await page.click(`.route-btn[data-route="${r}"]`);
  await page.click('#snap-btn');
  await page.waitForSelector('#postplay:not(.hidden)', { timeout: 8000 });
  await page.click('#next-btn');
  await page.waitForTimeout(50);
}
console.log('ran 9 plays total');

console.log('\n--- runtime errors:', errors.length, '---');
errors.forEach((e) => console.log('  ' + e));
console.log(errors.length === 0 ? 'VISUAL TEST PASSED (no runtime errors)' : 'VISUAL TEST FOUND ERRORS');

await browser.close();
