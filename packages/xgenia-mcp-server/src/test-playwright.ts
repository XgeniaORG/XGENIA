import { chromium } from 'playwright-core';

async function testConnection() {
  console.log("Attempting to connect to XGENIA on port 9222...");
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log("Successfully connected to XGENIA via CDP!");
    
    const contexts = browser.contexts();
    if (!contexts.length) {
      console.log("No contexts available. Waiting for 2s...");
      await new Promise(r => setTimeout(r, 2000));
    }
    const page = browser.contexts()[0].pages()[0];
    if (!page) {
       console.log("No page available.");
       process.exit(1);
    }
    
    console.log("Window title:", await page.title());
    
    const screenshot = await page.screenshot();
    console.log(`Successfully took a screenshot (${screenshot.length} bytes)`);
    
    console.log("All systems go!");
    process.exit(0);
  } catch (error) {
    console.error("Failed to connect or test:", error);
    process.exit(1);
  }
}

testConnection();
