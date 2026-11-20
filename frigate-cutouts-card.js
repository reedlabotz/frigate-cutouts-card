const DEFAULT_CONFIG = {
  instance_id: 'frigate',
  cameras: '',
  zones: '',
  limit: 10,
  dedupe_minutes: 5,
  threshold: 0.55,
  outline_px: 12,
  target_luminance: 145,
  contrast: 1.18,
  tilt: true,
  unknown_label: 'Visitor',
};

const MEDIAPIPE_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MEDIAPIPE_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let sharedSegmenterPromise = null;
function getSharedSegmenter() {
  if (!sharedSegmenterPromise) {
    sharedSegmenterPromise = (async () => {
      const vision = await import(MEDIAPIPE_BUNDLE);
      const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      return vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate: 'GPU' },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })();
  }
  return sharedSegmenterPromise;
}

class FrigateCutoutsCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('frigate-cutouts-card-editor');
  }

  static getStubConfig() {
    return { ...DEFAULT_CONFIG };
  }

  setConfig(config) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._lastFetch = 0;
    if (this.shadowRoot) {
      this.renderShell();
      this.loadEvents(true);
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this.attachShadow({ mode: 'open' });
      this.renderShell();
      this.loadEvents(true);
    } else if (Date.now() - (this._lastFetch || 0) > 60000) {
      this.loadEvents(false);
    }
  }

  renderShell() {
    const tiltCss = this.config.tilt
      ? `.item:nth-child(odd) { transform: rotate(-1.5deg); }
         .item:nth-child(even) { transform: rotate(1.5deg); }
         .item:hover { transform: rotate(0deg) scale(1.05); z-index: 2; }`
      : `.item:hover { transform: scale(1.04); z-index: 2; }`;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; font-family: inherit; }
        .row {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding: 12px 6px 10px;
          scrollbar-width: none;
        }
        .row::-webkit-scrollbar { display: none; }
        .item {
          flex: 0 0 auto;
          background: transparent;
          border: none;
          padding: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
          cursor: pointer;
          transition: transform 0.18s ease;
          font-family: inherit;
        }
        ${tiltCss}
        .img-box {
          min-width: 96px;
          height: 130px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          overflow: visible;
        }
        .img-box img {
          max-width: 130px;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 5px 10px rgba(38,38,31,0.22)) drop-shadow(0 1px 2px rgba(38,38,31,0.12));
        }
        .tag-stack {
          margin-top: -10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          z-index: 1;
        }
        .pills {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          justify-content: center;
        }
        .pill {
          font-size: 12px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          background: #4C6330;
          color: #FFFFFF;
          border: 2px solid #FFFFFF;
          box-shadow: 0 2px 6px rgba(38,38,31,0.16);
          max-width: 96px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pill.unknown { background: #EFECE2; color: #5E5B50; font-weight: 600; }
        .time-chip {
          font-size: 11px;
          font-weight: 600;
          color: #5E5B50;
          background: #FFFFFF;
          padding: 1px 7px;
          border-radius: 999px;
          box-shadow: 0 1px 3px rgba(38,38,31,0.10);
          font-variant-numeric: tabular-nums;
        }
        .status { font-size: 13px; color: #5E5B50; padding: 10px 4px; }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(38,38,31,0.55);
          backdrop-filter: blur(4px);
          z-index: 9999;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .modal-backdrop.open { display: flex; }
        .modal-card {
          background: #F6F4EE;
          border-radius: 24px;
          padding: 16px;
          max-width: 420px;
          width: 100%;
          box-shadow: 0 16px 40px rgba(0,0,0,0.28);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .modal-hdr {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #26261F;
          font-size: 15px;
          font-weight: 600;
        }
        .modal-close {
          background: #EFECE2;
          border: none;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 600;
          color: #26261F;
          cursor: pointer;
        }
        .modal-img {
          width: 100%;
          border-radius: 16px;
          background: #FFFFFF;
          object-fit: cover;
        }
      </style>
      <div class="row" id="row"><div class="status">Loading recent people...</div></div>
      <div class="modal-backdrop" id="modal">
        <div class="modal-card">
          <div class="modal-hdr">
            <span id="modal-title">Person</span>
            <button class="modal-close" id="modal-close">Done</button>
          </div>
          <img class="modal-img" id="modal-img" alt="Snapshot" />
        </div>
      </div>
    `;

    const modal = this.shadowRoot.getElementById('modal');
    this.shadowRoot.getElementById('modal-close').onclick = () => modal.classList.remove('open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
  }

  parseLabels(sub) {
    if (!sub) return [];
    if (typeof sub === 'string') return sub.split(',').map(s => s.trim()).filter(Boolean);
    if (Array.isArray(sub)) {
      if (typeof sub[0] === 'string' && typeof sub[1] === 'number') return [sub[0]];
      return sub.flatMap(x => Array.isArray(x) ? (typeof x[0] === 'string' ? [x[0]] : []) : (typeof x === 'string' ? [x] : []));
    }
    return [];
  }

  dedupeEvents(events) {
    const windowSec = Math.max(0, Number(this.config.dedupe_minutes) || 0) * 60;
    const limit = Math.max(1, Number(this.config.limit) || 10);
    const camFilter = (this.config.cameras || '').split(',').map(s => s.trim()).filter(Boolean);
    const zoneFilter = (this.config.zones || '').split(',').map(s => s.trim()).filter(Boolean);
    const kept = [];

    for (const ev of events) {
      const cam = ev.camera || 'default';
      if (camFilter.length && !camFilter.includes(cam)) continue;
      if (zoneFilter.length) {
        const evZones = Array.isArray(ev.zones) ? ev.zones : [];
        if (!evZones.some(z => zoneFilter.includes(z))) continue;
      }
      const labels = this.parseLabels(ev.sub_label);
      const ts = ev.start_time || 0;

      if (windowSec > 0) {
        if (labels.length > 0) {
          const key = labels.slice().sort().join('+').toLowerCase();
          if (kept.some(k => k.key === key && Math.abs(k.ts - ts) < windowSec)) continue;
          const anonIdx = kept.findIndex(k => k.labels.length === 0 && k.cam === cam && Math.abs(k.ts - ts) < windowSec);
          if (anonIdx !== -1) {
            kept[anonIdx] = { ev, labels, ts, cam, key };
            continue;
          }
          kept.push({ ev, labels, ts, cam, key });
        } else {
          if (kept.some(k => k.cam === cam && Math.abs(k.ts - ts) < windowSec)) continue;
          kept.push({ ev, labels, ts, cam, key: '' });
        }
      } else {
        kept.push({ ev, labels, ts, cam, key: labels.join('+') });
      }
      if (kept.length >= limit) break;
    }
    return kept;
  }

  openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('frigate-cutouts-cache', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('cutouts');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  getCached(db, key) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('cutouts', 'readonly');
        const req = tx.objectStore('cutouts').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  setCached(db, key, val) {
    try {
      const tx = db.transaction('cutouts', 'readwrite');
      tx.objectStore('cutouts').put(val, key);
    } catch (_) {}
  }

  computeAdaptiveBrightness(ctx, w, h, targetLum) {
    if (!targetLum || targetLum <= 0) return 1;
    const sample = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < sample.length; i += 16) {
      sum += 0.299 * sample[i] + 0.587 * sample[i + 1] + 0.114 * sample[i + 2];
      count++;
    }
    const meanLum = Math.max(20, sum / Math.max(1, count));
    return Math.min(1.55, Math.max(1.05, targetLum / meanLum));
  }

  async makeSticker(blob, segmenter) {
    const threshold = Number(this.config.threshold) || 0.55;
    const outlinePx = Number(this.config.outline_px) ?? 12;
    const targetLum = Number(this.config.target_luminance) ?? 145;
    const contrast = Number(this.config.contrast) || 1.18;

    const bmp = await createImageBitmap(blob);
    // Render output at up to 480px for crisp Retina/3x mobile display, while segmenting at 256px for speed
    const outScale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * outScale));
    const h = Math.max(1, Math.round(bmp.height * outScale));

    const segScale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
    const sw = Math.max(1, Math.round(bmp.width * segScale));
    const sh = Math.max(1, Math.round(bmp.height * segScale));

    const raw = document.createElement('canvas');
    raw.width = sw; raw.height = sh;
    const rctx = raw.getContext('2d');
    rctx.drawImage(bmp, 0, 0, sw, sh);
    const brightness = this.computeAdaptiveBrightness(rctx, sw, sh, targetLum);

    const segCanvas = document.createElement('canvas');
    segCanvas.width = sw; segCanvas.height = sh;
    const segCtx = segCanvas.getContext('2d');
    segCtx.filter = `brightness(${brightness.toFixed(2)}) contrast(${contrast}) saturate(1.06)`;
    segCtx.drawImage(bmp, 0, 0, sw, sh);
    segCtx.filter = 'none';

    const res = segmenter.segment(segCanvas);
    const mask = res.confidenceMasks[0].getAsFloat32Array();

    // Build smooth alpha mask at seg resolution
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = sw; maskCanvas.height = sh;
    const mctx = maskCanvas.getContext('2d');
    const maskImg = mctx.createImageData(sw, sh);
    const md = maskImg.data;

    const low = Math.max(0.05, threshold - 0.2);
    let fgCount = 0;
    for (let i = 0; i < mask.length; i++) {
      const c = mask[i];
      const alpha = c >= threshold ? 255 : c > low ? Math.round(((c - low) / (threshold - low)) * 255) : 0;
      md[i * 4 + 3] = alpha;
      if (alpha > 128) fgCount++;
    }
    mctx.putImageData(maskImg, 0, 0);

    // Draw high-res brightened person crop
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const sctx = src.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.filter = `brightness(${brightness.toFixed(2)}) contrast(${contrast}) saturate(1.06)`;
    sctx.drawImage(bmp, 0, 0, w, h);
    sctx.filter = 'none';

    if (fgCount / mask.length < 0.03) {
      const b = Math.min(outlinePx, 8);
      const fb = document.createElement('canvas');
      fb.width = w + b * 2;
      fb.height = h + b * 2;
      const fctx = fb.getContext('2d');
      fctx.fillStyle = '#FFFFFF';
      fctx.beginPath();
      fctx.roundRect(0, 0, fb.width, fb.height, 20);
      fctx.fill();
      fctx.save();
      fctx.beginPath();
      fctx.roundRect(b, b, w, h, 14);
      fctx.clip();
      fctx.drawImage(src, 0, 0, w, h, b, b, w, h);
      fctx.restore();
      return fb.toDataURL('image/png');
    }

    const person = document.createElement('canvas');
    person.width = w; person.height = h;
    const pctx = person.getContext('2d');
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(src, 0, 0, w, h);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(maskCanvas, 0, 0, w, h);
    pctx.globalCompositeOperation = 'source-over';

    const pad = outlinePx + 2;
    const out = document.createElement('canvas');
    out.width = w + pad * 2;
    out.height = h + pad * 2;
    const octx = out.getContext('2d');

    if (outlinePx > 0) {
      const sil = document.createElement('canvas');
      sil.width = w; sil.height = h;
      const silCtx = sil.getContext('2d');
      silCtx.drawImage(person, 0, 0);
      silCtx.globalCompositeOperation = 'source-in';
      silCtx.fillStyle = '#FFFFFF';
      silCtx.fillRect(0, 0, w, h);

      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        octx.drawImage(sil, pad + Math.cos(a) * outlinePx, pad + Math.sin(a) * outlinePx);
      }
    }
    octx.drawImage(person, pad, pad);

    const ow = out.width;
    const oh = out.height;
    const pixels = octx.getImageData(0, 0, ow, oh).data;
    let minX = ow, minY = oh, maxX = -1, maxY = -1;
    for (let y = 0; y < oh; y++) {
      const rowOff = y * ow * 4;
      for (let x = 0; x < ow; x++) {
        if (pixels[rowOff + x * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const m = 2;
      const sx = Math.max(0, minX - m);
      const sy = Math.max(0, minY - m);
      const sw2 = Math.min(ow - sx, maxX - minX + 1 + m * 2);
      const sh2 = Math.min(oh - sy, maxY - minY + 1 + m * 2);
      const trimmed = document.createElement('canvas');
      trimmed.width = sw2;
      trimmed.height = sh2;
      trimmed.getContext('2d').drawImage(out, sx, sy, sw2, sh2, 0, 0, sw2, sh2);
      return trimmed.toDataURL('image/png');
    }
    return out.toDataURL('image/png');
  }

  async openFullSnapshot(ev, labels, timeStr) {
    const modal = this.shadowRoot.getElementById('modal');
    const titleEl = this.shadowRoot.getElementById('modal-title');
    const imgEl = this.shadowRoot.getElementById('modal-img');
    const who = labels.length ? labels.join(', ') : (this.config.unknown_label || 'Visitor');
    titleEl.textContent = `${who} · ${ev.camera || ''} · ${timeStr}`;
    imgEl.removeAttribute('src');
    modal.classList.add('open');
    try {
      const resp = await this._hass.fetchWithAuth(`/api/frigate/notifications/${ev.id}/snapshot.jpg?bbox=0`);
      const blob = await resp.blob();
      imgEl.src = URL.createObjectURL(blob);
    } catch (_) {}
  }

  async loadEvents(force) {
    if (!this._hass || !this.shadowRoot) return;
    if (!force && Date.now() - (this._lastFetch || 0) < 60000) return;
    this._lastFetch = Date.now();

    const row = this.shadowRoot.getElementById('row');
    try {
      const zoneFilter = (this.config.zones || '').split(',').map(s => s.trim()).filter(Boolean);
      const wsPayload = {
        type: 'frigate/events/get',
        instance_id: this.config.instance_id,
        labels: ['person'],
        has_snapshot: true,
        after: Math.floor(Date.now() / 1000) - 14 * 86400,
        limit: 40,
      };
      if (zoneFilter.length) wsPayload.zones = zoneFilter;
      const res = await this._hass.callWS(wsPayload);
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      const rawEvents = Array.isArray(parsed) ? parsed : (parsed?.events || parsed?.results || []);
      const events = typeof rawEvents === 'string' ? JSON.parse(rawEvents) : rawEvents;
      const deduped = this.dedupeEvents(Array.isArray(events) ? events : []);

      if (!deduped.length) {
        row.innerHTML = `<div class="status">No recent person detections (fetched ${Array.isArray(events) ? events.length : 0} events).</div>`;
        return;
      }

      const db = await this.openDB().catch(() => null);
      let segmenter = null;
      try { segmenter = await getSharedSegmenter(); } catch (_) {}

      const cacheSuffix = `v4:${this.config.threshold}:${this.config.outline_px}:${this.config.target_luminance}:${this.config.contrast}`;
      row.innerHTML = '';

      for (const { ev, labels } of deduped) {
        const tm = new Date(ev.start_time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const pillsHtml = labels.length
          ? labels.map(n => `<span class="pill">${n}</span>`).join('')
          : `<span class="pill unknown">${this.config.unknown_label || 'Visitor'}</span>`;

        const btn = document.createElement('button');
        btn.className = 'item';
        btn.innerHTML = `
          <div class="img-box"><img alt="${labels.join(', ') || 'Person'}" /></div>
          <div class="tag-stack">
            <div class="pills">${pillsHtml}</div>
            <span class="time-chip">${tm}</span>
          </div>
        `;
        btn.onclick = () => this.openFullSnapshot(ev, labels, tm);
        row.appendChild(btn);

        const imgEl = btn.querySelector('img');
        const cacheKey = `${ev.id}:${cacheSuffix}`;
        let src = db ? await this.getCached(db, cacheKey) : null;
        if (!src) {
          try {
            const resp = await this._hass.fetchWithAuth(`/api/frigate/notifications/${ev.id}/snapshot.jpg?crop=1&bbox=0`);
            const blob = await resp.blob();
            if (segmenter) {
              src = await this.makeSticker(blob, segmenter);
              if (db) this.setCached(db, cacheKey, src);
            } else {
              src = URL.createObjectURL(blob);
            }
          } catch (_) {}
        }
        if (src) imgEl.src = src;
      }
    } catch (err) {
      row.innerHTML = `<div class="status">Frigate error: ${err?.message || err}</div>`;
    }
  }

  getCardSize() { return 2; }
}

class FrigateCutoutsCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config || DEFAULT_CONFIG;
    this.shadowRoot.innerHTML = `
      <style>
        .form { display: grid; gap: 12px; padding: 8px 0; font-family: inherit; }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 500; }
        input[type="text"], input[type="number"] {
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          font: inherit;
        }
        .chk { flex-direction: row; align-items: center; gap: 8px; }
      </style>
      <div class="form">
        <label>Frigate Integration Instance ID
          <input type="text" data-key="instance_id" value="${c.instance_id}" />
        </label>
        <div class="row">
          <label>Camera Filter (blank = all)
            <input type="text" data-key="cameras" value="${c.cameras}" placeholder="front_door" />
          </label>
          <label>Zone Filter (blank = all)
            <input type="text" data-key="zones" value="${c.zones}" placeholder="porch,driveway" />
          </label>
        </div>
        <div class="row">
          <label>Max Stickers
            <input type="number" data-key="limit" min="1" max="20" value="${c.limit}" />
          </label>
          <label>Dedupe Window (minutes)
            <input type="number" data-key="dedupe_minutes" min="0" max="60" value="${c.dedupe_minutes}" />
          </label>
        </div>
        <div class="row">
          <label>Confidence Threshold (0.2–0.9)
            <input type="number" data-key="threshold" min="0.2" max="0.9" step="0.05" value="${c.threshold}" />
          </label>
          <label>Sticker Outline (px)
            <input type="number" data-key="outline_px" min="0" max="16" step="1" value="${c.outline_px}" />
          </label>
        </div>
        <div class="row">
          <label>Adaptive Brightness Target (0 = off)
            <input type="number" data-key="target_luminance" min="0" max="200" step="5" value="${c.target_luminance}" />
          </label>
          <label>Contrast (0.9–1.5)
            <input type="number" data-key="contrast" min="0.9" max="1.5" step="0.02" value="${c.contrast}" />
          </label>
        </div>
        <div class="row">
          <label>Unrecognized Label
            <input type="text" data-key="unknown_label" value="${c.unknown_label}" />
          </label>
          <label class="chk">
            <input type="checkbox" data-key="tilt" ${c.tilt ? 'checked' : ''} />
            Playful sticker tilt
          </label>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('input').forEach(el => {
      el.onchange = () => {
        const key = el.dataset.key;
        const val = el.type === 'checkbox' ? el.checked
          : el.type === 'number' ? Number(el.value)
          : el.value;
        const next = { ...this._config, [key]: val };
        this._config = next;
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: next },
          bubbles: true,
          composed: true,
        }));
      };
    });
  }
}

customElements.define('frigate-cutouts-card', FrigateCutoutsCard);
customElements.define('frigate-cutouts-card-editor', FrigateCutoutsCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'frigate-cutouts-card',
  name: 'Frigate Cutouts Card',
  description: 'Displays recent Frigate person detections as die-cut stickers with face labels.',
  preview: true,
});
