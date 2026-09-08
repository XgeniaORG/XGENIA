const { chromium } = require('playwright-core');

async function test() {
  console.log('Connecting to CDP...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  console.log(`Found ${pages.length} pages.`);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    console.log(`Page ${i}: URL=${p.url()}`);
    try {
      const isHidden = await p.evaluate(() => document.hidden);
      const dims = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      console.log(`  - isHidden: ${isHidden}, dims: ${JSON.stringify(dims)}`);
      
      if (p.url().includes('localhost')) {
          console.log('  - Found localhost page, attempting screenshot...');
          try {
              await p.screenshot({path: `test-screenshot-${i}.png`});
              console.log('  - Screenshot success!');
          } catch(e) {
              console.log('  - Screenshot failed: ' + e.message);
          }
      }
    } catch(e) {
      console.log(`  - Error evaluating: ${e.message}`);
    }
  }
  await browser.close();
}

test().catch(console.error);
