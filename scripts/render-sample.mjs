#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs', 'sample.png');

const now = Math.floor(Date.now() / 1000);
const SAMPLE_EVENTS = [
  {
    id: 'sample-pebble',
    camera: 'front_door',
    start_time: now - 180,
    end_time: now - 165,
    sub_label: ['Pebble', 0.94],
    zones: ['porch'],
    data: { box: [0.30, 0.20, 0.20, 0.75] },
    _image: '/docs/samples/doorbell_group.jpg',
  },
  {
    id: 'sample-sprocket',
    camera: 'front_door',
    start_time: now - 178,
    end_time: now - 164,
    sub_label: ['Sprocket', 0.68],
    zones: ['porch'],
    data: { box: [0.50, 0.18, 0.21, 0.78] },
    _image: '/docs/samples/doorbell_group.jpg',
  },
  {
    id: 'sample-bramble',
    camera: 'front_door',
    start_time: now - 1900,
    end_time: now - 1885,
    sub_label: ['Bramble', 0.91],
    zones: ['porch'],
    data: { box: [0.40, 0.15, 0.20, 0.80] },
    _image: '/docs/samples/doorbell_bramble.jpg',
  },
  {
    id: 'sample-gizmo',
    camera: 'front_door',
    start_time: now - 5400,
    end_time: now - 5385,
    sub_label: ['Gizmo', 0.89],
    zones: ['porch'],
    data: { box: [0.41, 0.15, 0.22, 0.78] },
    _image: '/docs/samples/doorbell_gizmo.jpg',
  },
  {
    id: 'sample-visitor',
    camera: 'front_door',
    start_time: now - 9200,
    end_time: now - 9185,
    sub_label: null,
    zones: ['porch'],
    data: { box: [0.40, 0.12, 0.20, 0.84] },
    _image: '/docs/samples/doorbell_visitor.jpg',
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

function buildHarnessHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      --primary-background-color: #F6F4EE;
      --ha-card-background: #FFFFFF;
      --card-background-color: #FFFFFF;
      --secondary-background-color: #EFECE2;
      --primary-text-color: #26261F;
      --secondary-text-color: #5E5B50;
      --text-primary-color: #FFFFFF;
      --success-color: #4C6330;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px 24px;
      background: var(--primary-background-color);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: inline-block;
    }
    .card-frame {
      background: var(--ha-card-background);
      border-radius: 20px;
      padding: 12px 14px;
      box-shadow: 0 4px 18px rgba(38, 38, 31, 0.08);
      width: 640px;
    }
  </style>
  <script src="/frigate-cutouts-card.js"></script>
</head>
<body>
  <div class="card-frame" id="frame">
    <frigate-cutouts-card id="card"></frigate-cutouts-card>
  </div>
  <script>
    const EVENTS = ${JSON.stringify(SAMPLE_EVENTS)};

    async function cropImageBlob(url, box, crop) {
      const resp = await fetch(url);
      const blob = await resp.blob();
      if (!crop || !box) return blob;
      const bmp = await createImageBitmap(blob);
      const pad = 0.04;
      const x = Math.max(0, (box[0] - pad) * bmp.width);
      const y = Math.max(0, (box[1] - pad) * bmp.height);
      const w = Math.min(bmp.width - x, (box[2] + pad * 2) * bmp.width);
      const h = Math.min(bmp.height - y, (box[3] + pad * 2) * bmp.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      canvas.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, canvas.width, canvas.height);
      return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    }

    const card = document.getElementById('card');
    card.setConfig({
      group_mode: 'grouped',
      limit: 10,
      tilt: true,
      label_confidence_threshold: 0.8,
    });
    card.hass = {
      themes: { darkMode: false, theme: 'default' },
      callWS: async () => EVENTS,
      fetchWithAuth: async (apiUrl) => {
        const m = apiUrl.match(/notifications\\/([^/]+)\\/snapshot\\.jpg\\?(.*)$/);
        const id = m?.[1];
        const params = new URLSearchParams(m?.[2] || '');
        const ev = EVENTS.find(e => e.id === id) || EVENTS[0];
        const blob = await cropImageBlob(ev._image, ev.data?.box, params.get('crop') === '1');
        return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      },
    };

    window.__cardReady = async () => {
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const imgs = card.shadowRoot ? Array.from(card.shadowRoot.querySelectorAll('.item img')) : [];
        if (imgs.length === 4 && imgs.every(img => img.complete && img.naturalWidth > 0)) {
          await new Promise(r => setTimeout(r, 150));
          const rect = document.getElementById('frame').getBoundingClientRect();
          return { x: Math.max(0, rect.x - 16), y: Math.max(0, rect.y - 16), width: rect.width + 32, height: rect.height + 32 };
        }
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('Timed out waiting for card stickers to render');
    };
  </script>
</body>
</html>`;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/harness.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(buildHarnessHtml());
        return;
      }
      const filePath = path.resolve(ROOT, '.' + urlPath);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function findBrowser() {
  for (const p of ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser']) {
    try { await fs.access(p); return p; } catch {}
  }
  throw new Error('No Chromium/Chrome binary found');
}

async function main() {
  const server = await startServer();
  const { port } = server.address();
  const browserPath = await findBrowser();
  const userDataDir = await fs.mkdtemp('/tmp/frigate-cutouts-chrome-');

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    ...(proxyUrl ? [
      `--proxy-server=${proxyUrl}`,
      '--proxy-bypass-list=127.0.0.1,localhost',
      '--ignore-certificate-errors',
    ] : []),
    'about:blank',
  ];

  const chrome = spawn(browserPath, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let wsUrl;
  try {
    wsUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chromium CDP startup timeout')), 10000);
      chrome.stderr.on('data', (chunk) => {
        const m = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) { clearTimeout(timeout); resolve(m[1]); }
      });
      chrome.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Chromium exited ${code}`)); });
    });

    const pagesResp = await fetch(wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '/json/list'));
    const pages = await pagesResp.json();
    const pageWs = pages[0].webSocketDebuggerUrl;
    const ws = new WebSocket(pageWs);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let nextId = 1;
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const onMsg = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          ws.removeEventListener('message', onMsg);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 420, deviceScaleFactor: 2, mobile: false });
    await cdp('Runtime.enable');
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error' || msg.params.type === 'warning') console.error('[browser]', args);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[exception]', JSON.stringify(msg.params.exceptionDetails));
      }
    });
    await cdp('Page.enable');
    const loaded = new Promise(resolve => {
      const onMsg = (ev) => {
        if (JSON.parse(ev.data).method === 'Page.loadEventFired') {
          ws.removeEventListener('message', onMsg);
          resolve();
        }
      };
      ws.addEventListener('message', onMsg);
    });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/harness.html` });
    await loaded;

    const evalRes = await cdp('Runtime.evaluate', {
      expression: 'window.__cardReady()',
      awaitPromise: true,
      returnByValue: true,
    });
    if (evalRes.exceptionDetails) throw new Error(JSON.stringify(evalRes.exceptionDetails));
    const clip = evalRes.result.value;
    const shot = await cdp('Page.captureScreenshot', {
      format: 'png',
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 },
    });
    await fs.writeFile(OUT_PATH, Buffer.from(shot.data, 'base64'));
    console.log(`Rendered ${OUT_PATH}`);
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    server.close();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
