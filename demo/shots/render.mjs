// Renders the product shots: docs/images/<scene>-<theme>.png.
// Run with Electron itself: ./node_modules/.bin/electron demo/shots/render.mjs
// It starts its own Vite dev server (on a free port), loads demo/shots/index.html in a hidden window,
// waits for window.__shotReady, captures the page and stops the server.
// Sample content, invented for illustration. The images show invented text and a drawn backdrop.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'docs/images');
const WIDTH = 1000;
const HEIGHT = 940;
const OUT_WIDTH = 1064;
const OUT_HEIGHT = 1000;
const MAX_BYTES = 350 * 1024;
const scenes = ['class', 'client'];
const themes = ['dark', 'light'];

// The page is captured at 2x, then scaled to 1160x1000.
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.disableHardwareAcceleration();

const ready = (win) => win.webContents.executeJavaScript('window.__shotReady === true');

async function settle(win, url) {
  await win.loadURL(url);
  for (let i = 0; i < 100; i++) {
    if (await ready(win)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Scene did not settle: ${url}`);
}

async function capture(win, url) {
  // The first load of a fresh dev server can reload the page once (Vite re-optimises dependencies), which restarts the
  // replay: load until the page is ready and still ready after a pause.
  for (let attempt = 0; ; attempt++) {
    await settle(win, url);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (await ready(win)) break;
    if (attempt === 3) throw new Error(`Scene kept reloading: ${url}`);
  }
  return (await win.webContents.capturePage()).toPNG();
}

async function optimise(png) {
  const scaled = sharp(png).resize(OUT_WIDTH, OUT_HEIGHT, { fit: 'fill' });
  for (const colours of [256, 128, 64, 32]) {
    const out = await scaled.clone().png({ palette: true, colours, effort: 10, compressionLevel: 9 }).toBuffer();
    if (out.length <= MAX_BYTES || colours === 32) return out;
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.mts'), server: { port: 5190, strictPort: false }, logLevel: 'warn' });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: WIDTH, height: HEIGHT, useContentSize: true, webPreferences: { contextIsolation: true, partition: 'product-shots' } });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(`[page] ${event.message}`);
  });
  try {
    for (const scene of scenes) {
      for (const theme of themes) {
        const png = await capture(win, `${base}/demo/shots/index.html?scene=${scene}&theme=${theme}`);
        const file = path.join(outDir, `${scene}-${theme}.png`);
        const out = await optimise(png);
        await writeFile(file, out);
        console.log(`${path.relative(root, file)}  ${(out.length / 1024).toFixed(0)} KB`);
      }
    }
  } finally {
    win.destroy();
    await server.close();
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
