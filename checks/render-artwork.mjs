import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// The self-contained SVG is the source of truth; export at its native 1600 × 640.
const source = new URL('../assets/threejs-skills-for-agents.svg', import.meta.url);
const output = new URL('../assets/threejs-skills-for-agents.png', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 640 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<style>html,body{margin:0;background:transparent}svg{display:block}</style>'
      + await readFile(source, 'utf8'),
  );
  await page.locator('svg').screenshot({
    path: fileURLToPath(output),
    omitBackground: true,
  });
  console.log('Exported assets/threejs-skills-for-agents.png (1600 × 640).');
} finally {
  await browser.close();
}
