/**
 * 「計算でできた光」の紹介動画を録画する。
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   NODE_PATH=/opt/node22/lib/node_modules \
 *   node showcase/tools/record-video.js [出力ディレクトリ]
 *
 * ページを実際のブラウザで開き、決められた道筋でスクロールしながら
 * 画面を録画する。出力は WebM (VP8)。1280x720 / 約1分45秒。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(process.argv[2] || './showcase-video');
const PAGE = path.resolve(__dirname, '..', 'index.html');
const W = 1280, H = 720;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--hide-scrollbars'],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  await page.goto('file://' + PAGE);

  /** easeInOutCubic でその節までスクロールする */
  const glide = (sel, offRatio, ms) => page.evaluate(async ([s, o, d]) => {
    const el = document.querySelector(s);
    if (!el) return;
    const from = window.scrollY;
    const to = from + el.getBoundingClientRect().top - window.innerHeight * o;
    const t0 = performance.now();
    await new Promise(done => {
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / d);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        window.scrollTo(0, from + (to - from) * e);
        p < 1 ? requestAnimationFrame(tick) : done();
      };
      requestAnimationFrame(tick);
    });
  }, [sel, offRatio, ms]);

  const hold = ms => page.waitForTimeout(ms);

  await hold(7000);                                       // 序：流れ場
  await glide('.proof', 0.02, 1600);      await hold(4200);
  await glide('#sec-life', 0.28, 1600);   await hold(11000);

  // 図版一をカーソルでなぞって、模様を生やしてみせる
  await page.mouse.move(340, 480);
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(340 + i * 9, 480 + Math.sin(i / 6) * 90);
    await hold(16);
  }
  await hold(4500);

  await glide('#sec-chaos', 0.24, 1600);   await hold(8500);
  await glide('#sec-sand', 0.24, 1600);    await hold(9500);
  await glide('#sec-tree', 0.24, 1600);    await hold(8000);
  await glide('#sec-solid', 0.24, 1600);   await hold(8000);
  await glide('#sec-dissect', 0.02, 1600); await hold(5000);
  await glide('#sec-coda', 0.12, 1600);    await hold(16000);

  await ctx.close();
  await browser.close();

  const file = fs.readdirSync(OUT).find(n => n.endsWith('.webm'));
  console.log('録画完了:', path.join(OUT, file));
})();
