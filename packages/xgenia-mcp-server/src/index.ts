import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium, Browser, Page } from 'playwright-core';
import { z } from 'zod';

const server = new McpServer({
  name: "xgenia-playwright-mcp",
  version: "1.0.0"
});

let browser: Browser | null = null;
let page: Page | null = null;

async function getPage() {
  if (page && !page.isClosed()) return page;
  
  if (!browser || !browser.isConnected()) {
    try {
      // Electron apps with --remote-debugging-port=9222 expose CDP here
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    } catch (e) {
      throw new Error(`Failed to connect to XGENIA on port 9222. Ensure XGENIA is running with --remote-debugging-port=9222. Error: ${e}`);
    }
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error("No browser contexts found.");
  
  const pages = contexts[0].pages();
  if (pages.length === 0) throw new Error("No pages found.");
  
  // The first page is typically the main Electron BrowserWindow
  page = pages[0];
  return page;
}

server.tool(
  "xgenia_screenshot",
  "Captures a screenshot of the active XGENIA editor window",
  {},
  async () => {
    const p = await getPage();
    const buffer = await p.screenshot();
    const base64 = buffer.toString('base64');
    return {
      content: [{ type: "image", data: base64, mimeType: "image/png" }]
    };
  }
);

server.tool(
  "xgenia_click",
  "Simulates a physical mouse click at the specified viewport coordinates",
  {
    x: z.number().describe("X coordinate to click"),
    y: z.number().describe("Y coordinate to click")
  },
  async ({ x, y }) => {
    const p = await getPage();
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.up();
    return { content: [{ type: "text", text: `Clicked successfully at (${x}, ${y})` }] };
  }
);

server.tool(
  "xgenia_type",
  "Simulates physical keyboard typing in the currently focused element",
  {
    text: z.string().describe("Text to type")
  },
  async ({ text }) => {
    const p = await getPage();
    await p.keyboard.type(text);
    return { content: [{ type: "text", text: `Typed: "${text}"` }] };
  }
);

server.tool(
  "xgenia_get_ui_tree",
  "Gets a simplified DOM tree of interactive elements in the XGENIA editor to help determine click coordinates",
  {},
  async () => {
    const p = await getPage();
    const uiTree = await p.evaluate(() => {
      // Find all potentially interactive elements
      const elements = Array.from(document.querySelectorAll('button, input, textarea, a, [role="button"], [role="treeitem"], [role="tab"]'));
      return elements.map(el => {
        const rect = el.getBoundingClientRect();
        // Skip hidden or zero-size elements
        if (rect.width === 0 || rect.height === 0 || rect.top < 0 || rect.left < 0) return null;
        
        let text = (el.textContent || '').trim();
        if (!text && el.tagName.toLowerCase() === 'input') {
          text = (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder;
        }

        return {
          tag: el.tagName.toLowerCase(),
          text: text.substring(0, 50),
          id: el.id,
          className: el.className,
          // Center coordinate for clicking
          clickX: Math.round(rect.left + rect.width / 2),
          clickY: Math.round(rect.top + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      }).filter(Boolean);
    });
    
    return {
      content: [{ type: "text", text: JSON.stringify(uiTree, null, 2) }]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("XGENIA Playwright MCP Server started and listening via stdio.");
}

main().catch(e => {
  console.error("Error starting XGENIA MCP server:", e);
  process.exit(1);
});
