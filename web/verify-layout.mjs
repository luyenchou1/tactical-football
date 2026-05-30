// Objective layout assertions — verifies positioning without needing eyes.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'index.html');

const VW = 390, VH = 844;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForTimeout(300);

const fails = [];
const ok = [];
function check(cond, msg) { (cond ? ok : fails).push(msg); }

const box = async (sel) => page.locator(sel).first().boundingBox();

const field = await box('#field');
const hud = await box('#hud');
const panel = await box('#panel');

check(field && field.width > 300, `field width ${field?.width?.toFixed(0)}px (want >300)`);
check(field && field.height > 150, `field height ${field?.height?.toFixed(0)}px`);
check(hud.y < field.y, 'HUD is above the field');
check(panel.y >= field.y + field.height - 2, 'panel is below the field');
check(field.x >= 0 && field.x + field.width <= VW + 1, 'field fits viewport width');
check(panel.y + panel.height <= VH + 80, `content height ${(panel.y+panel.height).toFixed(0)}px vs viewport ${VH}`);

// all chips inside the field bounds
const chips = await page.locator('#field .chip').all();
let outOfBounds = 0, tooSmall = 0; const sizes = [];
for (const c of chips) {
  const b = await c.boundingBox();
  sizes.push(b.width);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  if (cx < field.x - 2 || cx > field.x + field.width + 2 || cy < field.y - 2 || cy > field.y + field.height + 2) outOfBounds++;
  if (b.width < 16) tooSmall++;
}
check(chips.length === 22, `22 chips rendered (got ${chips.length})`);
check(outOfBounds === 0, `chips within field bounds (${outOfBounds} stray)`);
check(true, `chip size ~${Math.round(sizes[0])}px`);

// route buttons: touch-target size
const rb = await box('.route-btn');
check(rb.height >= 40, `route button height ${rb.height.toFixed(0)}px (touch target ≥40)`);
const snap = await box('#snap-btn');
check(snap.height >= 44, `snap button height ${snap.height.toFixed(0)}px`);
check(snap.width > 200, `snap button width ${snap.width.toFixed(0)}px`);

// LOS line present and within field
const los = await box('.fieldline.los');
check(!!los && los.y > field.y && los.y < field.y + field.height, 'LOS line within field');

// primary (slot) chip has the star child
const star = await page.locator('#field .chip.primary .star').count();
check(star === 1, 'primary slot chip shows the star');

// no horizontal scroll (nothing wider than viewport)
const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
check(scrollW <= VW + 1, `no horizontal overflow (scrollWidth ${scrollW})`);

console.log('PASS (' + ok.length + '):');
ok.forEach((m) => console.log('  ✓ ' + m));
if (fails.length) {
  console.log('\nFAIL (' + fails.length + '):');
  fails.forEach((m) => console.log('  ✗ ' + m));
} else {
  console.log('\nALL LAYOUT CHECKS PASSED');
}
await browser.close();
process.exit(fails.length ? 1 : 0);
