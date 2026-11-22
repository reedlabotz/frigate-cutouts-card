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
  label_confidence_threshold: 0.8,
  group_mode: 'individual',
};

const TIMELINE_DEFAULT_CONFIG = {
  ...DEFAULT_CONFIG,
  limit: 100,
  days: 14,
  dedupe_minutes: 5,
  tilt: false,
  show_filters: true,
  show_camera: true,
  show_zones: true,
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

class FrigateCutoutsBase extends HTMLElement {
  getDefaultConfig() {
    return DEFAULT_CONFIG;
  }

  setConfig(config) {
    this.config = { ...this.getDefaultConfig(), ...config };
    this._lastFetch = 0;
    if (this.shadowRoot) {
      this.renderShell();
      this.loadEvents(true);
    }
  }

  getStickerOutlineColor() {
    if (!this._hass?.themes?.darkMode) return '#FFFFFF';
    const style = getComputedStyle(this);
    const cardBg = style.getPropertyValue('--ha-card-background').trim()
      || style.getPropertyValue('--card-background-color').trim();
    return cardBg || '#242426';
  }

  set hass(hass) {
    this._hass = hass;
    const themeKey = `${Boolean(hass?.themes?.darkMode)}:${hass?.themes?.theme || ''}`;
    if (!this._initialized) {
      this._initialized = true;
      this._themeKey = themeKey;
      this.attachShadow({ mode: 'open' });
      this.renderShell();
      this.loadEvents(true);
    } else if (themeKey !== this._themeKey) {
      this._themeKey = themeKey;
      this.renderShell();
      this.loadEvents(true);
    } else if (Date.now() - (this._lastFetch || 0) > 60000) {
      this.loadEvents(false);
    }
  }

  renderShell() {
    const isDark = Boolean(this._hass?.themes?.darkMode);
    const imgShadow = isDark
      ? 'drop-shadow(0 0 1px rgba(255,255,255,0.18)) drop-shadow(0 6px 14px rgba(0,0,0,0.65)) drop-shadow(0 2px 4px rgba(0,0,0,0.45))'
      : 'drop-shadow(0 5px 10px rgba(38,38,31,0.22)) drop-shadow(0 1px 2px rgba(38,38,31,0.12))';
    const pillShadow = isDark ? '0 3px 8px rgba(0,0,0,0.55)' : '0 2px 6px rgba(38,38,31,0.16)';
    const chipShadow = isDark ? '0 2px 6px rgba(0,0,0,0.45)' : '0 1px 3px rgba(38,38,31,0.10)';
    const tiltCss = this.config.tilt
      ? `.item:nth-child(odd) { transform: rotate(-1.5deg); }
         .item:nth-child(even) { transform: rotate(1.5deg); }
         .item:hover { transform: rotate(0deg) scale(1.05); z-index: 2; }`
      : `.item:hover { transform: scale(1.04); z-index: 2; }`;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; font-family: inherit; }
        .row {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding: 12px 6px 10px;
          scrollbar-width: none;
          box-sizing: border-box;
        }
        @media (max-width: 767px) {
          .row {
            width: 100vw;
            max-width: 100vw;
            margin-left: calc(50% - 50vw);
            padding: 12px 18px 10px;
            scroll-padding-left: 18px;
          }
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
          filter: ${imgShadow};
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
          background: var(--success-color, #4C6330);
          color: var(--text-primary-color, #FFFFFF);
          border: 2px solid var(--ha-card-background, var(--card-background-color, #FFFFFF));
          box-shadow: ${pillShadow};
          max-width: 96px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .pill:nth-child(odd) { transform: rotate(-1.5deg); }
        .pill:nth-child(even) { transform: rotate(1.5deg); }
        .item:hover .pill { transform: rotate(0deg) scale(1.06); }
        .pill.uncertain { border-style: dashed; }
        .pill.unknown { background: var(--secondary-background-color, #EFECE2); color: var(--secondary-text-color, #5E5B50); font-weight: 600; }
        .time-chip {
          font-size: 11px;
          font-weight: 600;
          color: var(--secondary-text-color, #5E5B50);
          background: var(--ha-card-background, var(--card-background-color, #FFFFFF));
          padding: 1px 7px;
          border-radius: 999px;
          box-shadow: ${chipShadow};
          font-variant-numeric: tabular-nums;
        }
        .status { font-size: 13px; color: var(--secondary-text-color, #5E5B50); padding: 10px 4px; }
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
          background: var(--primary-background-color, #F6F4EE);
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
          color: var(--primary-text-color, #26261F);
          font-size: 15px;
          font-weight: 600;
        }
        .modal-close {
          background: var(--secondary-background-color, #EFECE2);
          border: none;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color, #26261F);
          cursor: pointer;
        }
        .modal-img {
          width: 100%;
          border-radius: 16px;
          background: var(--ha-card-background, var(--card-background-color, #FFFFFF));
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

  parseLabelEntry(ev) {
    const sub = ev?.sub_label;
    if (!sub) return null;
    const fallbackScore = typeof ev?.data?.sub_label_score === 'number' ? ev.data.sub_label_score : null;
    if (typeof sub === 'string') {
      const name = sub.trim();
      return name ? { name, score: fallbackScore } : null;
    }
    if (Array.isArray(sub) && typeof sub[0] === 'string') {
      const name = sub[0].trim();
      return name ? { name, score: typeof sub[1] === 'number' ? sub[1] : fallbackScore } : null;
    }
    return null;
  }

  isUncertainEntry(entry) {
    if (entry.isUnknown) return false;
    const minConf = Number(this.config.label_confidence_threshold ?? 0.8);
    return minConf > 0 && entry.score !== null && entry.score < minConf;
  }

  formatLabelEntry(entry) {
    if (entry.isUnknown) return entry.name;
    return this.isUncertainEntry(entry) ? `${entry.name}?` : entry.name;
  }

  getPillColor(name) {
    const palette = ['#4C6330', '#D95D39', '#2B6CB0', '#7B4B94', '#2C7A7B', '#B75B1E', '#B83280'];
    let h = 0;
    const s = String(name || '').toLowerCase();
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return palette[h % palette.length];
  }

  computeUnionBox(events) {
    const boxes = events
      .map(e => e?.data?.box)
      .filter(b => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number'));
    if (!boxes.length) return null;
    const minX = Math.min(...boxes.map(b => b[0]));
    const minY = Math.min(...boxes.map(b => b[1]));
    const maxX = Math.max(...boxes.map(b => b[0] + b[2]));
    const maxY = Math.max(...boxes.map(b => b[1] + b[3]));
    const padX = Math.max(0.04, (maxX - minX) * 0.15);
    const padY = Math.max(0.04, (maxY - minY) * 0.15);
    const x0 = Math.max(0, minX - padX);
    const y0 = Math.max(0, minY - padY);
    const x1 = Math.min(1, maxX + padX);
    const y1 = Math.min(1, maxY + padY);
    return [x0, y0, Math.max(0.05, x1 - x0), Math.max(0.05, y1 - y0)];
  }

  eventsOverlap(a, b) {
    const aStart = a.start_time || 0;
    const aEnd = a.end_time ?? (aStart + 30);
    const bStart = b.start_time || 0;
    const bEnd = b.end_time ?? (bStart + 30);
    return aStart <= bEnd && bStart <= aEnd;
  }

  dedupeEvents(events) {
    const windowSec = Math.max(0, Number(this.config.dedupe_minutes) || 0) * 60;
    const limit = Math.max(1, Number(this.config.limit) || 10);
    const groupMode = this.config.group_mode === 'grouped' ? 'grouped' : 'individual';
    const camFilter = (this.config.cameras || '').split(',').map(s => s.trim()).filter(Boolean);
    const zoneFilter = (this.config.zones || '').split(',').map(s => s.trim()).filter(Boolean);

    const filtered = [];
    for (const ev of events) {
      const cam = ev.camera || 'default';
      if (camFilter.length && !camFilter.includes(cam)) continue;
      if (zoneFilter.length) {
        const evZones = Array.isArray(ev.zones) ? ev.zones : [];
        if (!evZones.some(z => zoneFilter.includes(z))) continue;
      }
      filtered.push({ ev, entry: this.parseLabelEntry(ev), cam, ts: ev.start_time || 0 });
    }

    if (groupMode === 'grouped') {
      const groupWindowSec = 30;
      const groups = [];
      for (const item of filtered) {
        const match = groups.find(g => g.cam === item.cam && g.events.some(gev =>
          this.eventsOverlap(item.ev, gev) || Math.abs(item.ts - (gev.start_time || 0)) <= groupWindowSec
        ));
        if (match) {
          match.events.push(item.ev);
          if (item.entry) {
            const k = item.entry.name.toLowerCase();
            const prev = match.named.get(k);
            if (!prev || (item.entry.score ?? -1) > (prev.score ?? -1)) {
              match.named.set(k, item.entry);
            }
            if (!match.primaryHasLabel) {
              match.ev = item.ev;
              match.primaryHasLabel = true;
            }
            match.labeledEvents.push(item.ev);
          } else {
            match.unlabeledEvents.push(item.ev);
          }
        } else {
          const named = new Map();
          if (item.entry) named.set(item.entry.name.toLowerCase(), item.entry);
          groups.push({
            ev: item.ev,
            cam: item.cam,
            ts: item.ts,
            events: [item.ev],
            labeledEvents: item.entry ? [item.ev] : [],
            unlabeledEvents: item.entry ? [] : [item.ev],
            named,
            primaryHasLabel: Boolean(item.entry),
          });
        }
      }

      const kept = [];
      for (const g of groups) {
        const labelEntries = Array.from(g.named.values());
        const hasOverlappingUnknown = g.unlabeledEvents.some(u =>
          g.labeledEvents.some(l => this.eventsOverlap(u, l))
        );
        if (labelEntries.length > 0 && hasOverlappingUnknown) {
          labelEntries.push({ name: this.config.unknown_label || 'Visitor', score: null, isUnknown: true });
        }
        const key = Array.from(g.named.keys()).sort().join('+');
        if (windowSec > 0 && key && kept.some(k => k.key === key && Math.abs(k.ts - g.ts) < windowSec)) continue;
        const isGroup = g.events.length > 1;
        const cropBox = isGroup ? this.computeUnionBox(g.events) : null;
        kept.push({ ev: g.ev, labelEntries, ts: g.ts, cam: g.cam, key, isGroup, cropBox });
        if (kept.length >= limit) break;
      }
      return kept;
    }

    const kept = [];
    for (const { ev, entry, cam, ts } of filtered) {
      if (windowSec > 0) {
        if (entry) {
          const key = entry.name.toLowerCase();
          if (kept.some(k => k.key === key && Math.abs(k.ts - ts) < windowSec)) continue;
          const anonIdx = kept.findIndex(k =>
            k.labelEntries.length === 0 && k.cam === cam && Math.abs(k.ts - ts) < windowSec && !this.eventsOverlap(ev, k.ev)
          );
          if (anonIdx !== -1) {
            kept[anonIdx] = { ev, labelEntries: [entry], ts, cam, key };
            continue;
          }
          kept.push({ ev, labelEntries: [entry], ts, cam, key });
        } else {
          const hasNonOverlapping = kept.some(k =>
            k.cam === cam && Math.abs(k.ts - ts) < windowSec && !this.eventsOverlap(ev, k.ev)
          );
          if (hasNonOverlapping) continue;
          kept.push({ ev, labelEntries: [], ts, cam, key: '' });
        }
      } else {
        kept.push({ ev, labelEntries: entry ? [entry] : [], ts, cam, key: entry ? entry.name.toLowerCase() : '' });
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

  async makeSticker(blob, segmenter, outlineColor = '#FFFFFF', cropBox = null, isFullFrame = false) {
    const threshold = Number(this.config.threshold) || 0.55;
    const outlinePx = Number(this.config.outline_px) ?? 12;
    const targetLum = Number(this.config.target_luminance) ?? 145;
    const contrast = Number(this.config.contrast) || 1.18;

    const bmp = await createImageBitmap(blob);
    const sx = cropBox ? Math.round(cropBox[0] * bmp.width) : 0;
    const sy = cropBox ? Math.round(cropBox[1] * bmp.height) : 0;
    const sWidth = cropBox ? Math.max(1, Math.round(cropBox[2] * bmp.width)) : bmp.width;
    const sHeight = cropBox ? Math.max(1, Math.round(cropBox[3] * bmp.height)) : bmp.height;

    // Render output at up to 480px for crisp Retina/3x mobile display; use higher seg resolution for groups/full frames
    const outScale = Math.min(1, 480 / Math.max(sWidth, sHeight));
    const w = Math.max(1, Math.round(sWidth * outScale));
    const h = Math.max(1, Math.round(sHeight * outScale));

    const segMax = isFullFrame ? (cropBox ? 384 : 512) : 256;
    const segScale = Math.min(1, segMax / Math.max(sWidth, sHeight));
    const sw = Math.max(1, Math.round(sWidth * segScale));
    const sh = Math.max(1, Math.round(sHeight * segScale));

    const raw = document.createElement('canvas');
    raw.width = sw; raw.height = sh;
    const rctx = raw.getContext('2d');
    rctx.drawImage(bmp, sx, sy, sWidth, sHeight, 0, 0, sw, sh);
    const brightness = this.computeAdaptiveBrightness(rctx, sw, sh, targetLum);

    const segCanvas = document.createElement('canvas');
    segCanvas.width = sw; segCanvas.height = sh;
    const segCtx = segCanvas.getContext('2d');
    segCtx.filter = `brightness(${brightness.toFixed(2)}) contrast(${contrast}) saturate(1.06)`;
    segCtx.drawImage(bmp, sx, sy, sWidth, sHeight, 0, 0, sw, sh);
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
    sctx.drawImage(bmp, sx, sy, sWidth, sHeight, 0, 0, w, h);
    sctx.filter = 'none';

    const minFgRatio = isFullFrame && !cropBox ? 0.008 : 0.03;
    if (fgCount / mask.length < minFgRatio) {
      const b = Math.min(outlinePx, 8);
      const fb = document.createElement('canvas');
      fb.width = w + b * 2;
      fb.height = h + b * 2;
      const fctx = fb.getContext('2d');
      fctx.fillStyle = outlineColor;
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
      silCtx.fillStyle = outlineColor;
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

  getCacheSuffix(outlineColor) {
    return `v4:${this.config.threshold}:${this.config.outline_px}:${this.config.target_luminance}:${this.config.contrast}:${outlineColor}`;
  }

  async fetchFrigateEvents(fetchLimit = 40, days = 14) {
    const zoneFilter = (this.config.zones || '').split(',').map(s => s.trim()).filter(Boolean);
    const wsPayload = {
      type: 'frigate/events/get',
      instance_id: this.config.instance_id,
      labels: ['person'],
      has_snapshot: true,
      after: Math.floor(Date.now() / 1000) - Math.max(1, Number(days) || 14) * 86400,
      limit: fetchLimit,
    };
    if (zoneFilter.length) wsPayload.zones = zoneFilter;
    const res = await this._hass.callWS(wsPayload);
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    const rawEvents = Array.isArray(parsed) ? parsed : (parsed?.events || parsed?.results || []);
    const events = typeof rawEvents === 'string' ? JSON.parse(rawEvents) : rawEvents;
    return Array.isArray(events) ? events : [];
  }

  renderPillsHtml(labelEntries, displayLabels) {
    return labelEntries.length
      ? labelEntries.map((e, i) => {
          const titleAttr = e.score !== null ? ` title="Confidence: ${Math.round(e.score * 100)}%"` : '';
          const cls = e.isUnknown ? 'pill unknown' : this.isUncertainEntry(e) ? 'pill uncertain' : 'pill';
          const styleAttr = e.isUnknown ? '' : ` style="background:${this.getPillColor(e.name)}"`;
          return `<span class="${cls}"${styleAttr}${titleAttr}>${displayLabels[i]}</span>`;
        }).join('')
      : `<span class="pill unknown">${this.config.unknown_label || 'Visitor'}</span>`;
  }

  async fetchStickerSrc({ ev, isGroup, cropBox }, { db, segmenter, outlineColor, cacheSuffix }) {
    const cropParam = isGroup ? 0 : 1;
    const boxKey = cropBox ? `:${cropBox.map(n => n.toFixed(2)).join(',')}` : '';
    const cacheKey = `${ev.id}:${cacheSuffix}:crop=${cropParam}${boxKey}`;
    let src = db ? await this.getCached(db, cacheKey) : null;
    if (!src) {
      try {
        const resp = await this._hass.fetchWithAuth(`/api/frigate/notifications/${ev.id}/snapshot.jpg?crop=${cropParam}&bbox=0`);
        const blob = await resp.blob();
        if (segmenter) {
          src = await this.makeSticker(blob, segmenter, outlineColor, cropBox, Boolean(isGroup));
          if (db) this.setCached(db, cacheKey, src);
        } else {
          src = URL.createObjectURL(blob);
        }
      } catch (_) {}
    }
    return src;
  }
}

class FrigateCutoutsCard extends FrigateCutoutsBase {
  static getConfigElement() {
    return document.createElement('frigate-cutouts-card-editor');
  }

  static getStubConfig() {
    return { ...DEFAULT_CONFIG };
  }

  async loadEvents(force) {
    if (!this._hass || !this.shadowRoot) return;
    if (!force && Date.now() - (this._lastFetch || 0) < 60000) return;
    this._lastFetch = Date.now();

    const row = this.shadowRoot.getElementById('row');
    try {
      const events = await this.fetchFrigateEvents(40, 14);
      const deduped = this.dedupeEvents(events);

      if (!deduped.length) {
        row.innerHTML = `<div class="status">No recent person detections (fetched ${events.length} events).</div>`;
        return;
      }

      const db = await this.openDB().catch(() => null);
      let segmenter = null;
      try { segmenter = await getSharedSegmenter(); } catch (_) {}

      const outlineColor = this.getStickerOutlineColor();
      const cacheSuffix = this.getCacheSuffix(outlineColor);
      row.innerHTML = '';

      for (const item of deduped) {
        const { ev, labelEntries } = item;
        const tm = new Date(ev.start_time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const displayLabels = labelEntries.map(e => this.formatLabelEntry(e));
        const pillsHtml = this.renderPillsHtml(labelEntries, displayLabels);

        const btn = document.createElement('button');
        btn.className = 'item';
        btn.innerHTML = `
          <div class="img-box"><img alt="${displayLabels.join(', ') || 'Person'}" /></div>
          <div class="tag-stack">
            <div class="pills">${pillsHtml}</div>
            <span class="time-chip">${tm}</span>
          </div>
        `;
        btn.onclick = () => this.openFullSnapshot(ev, displayLabels, tm);
        row.appendChild(btn);

        const imgEl = btn.querySelector('img');
        const src = await this.fetchStickerSrc(item, { db, segmenter, outlineColor, cacheSuffix });
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
        input[type="text"], input[type="number"], select {
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
          <label>Label Confidence Threshold (0 = off)
            <input type="number" data-key="label_confidence_threshold" min="0" max="1" step="0.05" value="${c.label_confidence_threshold}" />
          </label>
        </div>
        <div class="row">
          <label>Multiple People Mode
            <select data-key="group_mode">
              <option value="individual" ${c.group_mode !== 'grouped' ? 'selected' : ''}>Individual (one sticker per person)</option>
              <option value="grouped" ${c.group_mode === 'grouped' ? 'selected' : ''}>Grouped (combine nearby events)</option>
            </select>
          </label>
          <label class="chk">
            <input type="checkbox" data-key="tilt" ${c.tilt ? 'checked' : ''} />
            Playful sticker tilt
          </label>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('input, select').forEach(el => {
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

class FrigateCutoutsTimelineCard extends FrigateCutoutsBase {
  static getConfigElement() {
    return document.createElement('frigate-cutouts-timeline-card-editor');
  }

  static getStubConfig() {
    return { ...TIMELINE_DEFAULT_CONFIG };
  }

  getDefaultConfig() {
    return TIMELINE_DEFAULT_CONFIG;
  }

  disconnectedCallback() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  renderShell() {
    const isDark = Boolean(this._hass?.themes?.darkMode);
    const imgShadow = isDark
      ? 'drop-shadow(0 0 1px rgba(255,255,255,0.18)) drop-shadow(0 4px 10px rgba(0,0,0,0.65))'
      : 'drop-shadow(0 4px 8px rgba(38,38,31,0.20)) drop-shadow(0 1px 2px rgba(38,38,31,0.10))';
    const pillShadow = isDark ? '0 2px 6px rgba(0,0,0,0.5)' : '0 1px 4px rgba(38,38,31,0.14)';
    const hoverBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(38,38,31,0.04)';
    const railColor = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(38,38,31,0.14)';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; font-family: inherit; color: var(--primary-text-color, #26261F); }
        .tl-wrap { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; box-sizing: border-box; }
        .tl-hdr {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0 4px;
        }
        .tl-title-group { display: flex; align-items: center; gap: 8px; }
        .tl-title { font-size: 15px; font-weight: 700; }
        .tl-count {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--secondary-background-color, #EFECE2);
          color: var(--secondary-text-color, #5E5B50);
          font-variant-numeric: tabular-nums;
        }
        .tl-refresh {
          background: var(--secondary-background-color, #EFECE2);
          color: var(--primary-text-color, #26261F);
          border: none;
          border-radius: 999px;
          padding: 5px 11px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .tl-refresh:hover { filter: brightness(0.95); }
        .tl-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 4px;
        }
        .filter-chip {
          border: 1.5px solid var(--divider-color, ${railColor});
          background: transparent;
          color: var(--secondary-text-color, #5E5B50);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .filter-chip.active {
          background: var(--primary-text-color, #26261F);
          color: var(--ha-card-background, #FFFFFF);
          border-color: var(--primary-text-color, #26261F);
        }
        .tl-body { display: flex; flex-direction: column; gap: 14px; }
        .day-group { display: flex; flex-direction: column; gap: 6px; }
        .day-hdr {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 2px 4px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color, #5E5B50);
        }
        .day-rail {
          margin-left: 10px;
          padding-left: 14px;
          border-left: 2px solid var(--divider-color, ${railColor});
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tl-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          border-radius: 14px;
          padding: 6px 8px;
          cursor: pointer;
          font-family: inherit;
          color: inherit;
          transition: background 0.15s ease;
          box-sizing: border-box;
        }
        .tl-item:hover { background: ${hoverBg}; }
        .tl-dot {
          position: absolute;
          left: -20px;
          top: 50%;
          transform: translateY(-50%);
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--primary-color, #4C6330);
          border: 2px solid var(--ha-card-background, var(--card-background-color, #FFFFFF));
          box-sizing: border-box;
        }
        .tl-time-col {
          flex: 0 0 60px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          font-variant-numeric: tabular-nums;
        }
        .tl-time { font-size: 12px; font-weight: 700; color: var(--primary-text-color, #26261F); }
        .tl-dur { font-size: 11px; color: var(--secondary-text-color, #5E5B50); }
        .tl-thumb {
          flex: 0 0 64px;
          width: 64px;
          height: 76px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
        }
        .tl-thumb img {
          max-width: 64px;
          max-height: 76px;
          width: auto;
          height: auto;
          object-fit: contain;
          filter: ${imgShadow};
        }
        .tl-info {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .pills { display: flex; flex-wrap: wrap; gap: 4px; }
        .pill {
          font-size: 12px;
          font-weight: 700;
          padding: 2px 9px;
          border-radius: 999px;
          background: var(--success-color, #4C6330);
          color: var(--text-primary-color, #FFFFFF);
          box-shadow: ${pillShadow};
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pill.uncertain { border: 1.5px dashed rgba(255,255,255,0.75); }
        .pill.unknown {
          background: var(--secondary-background-color, #EFECE2);
          color: var(--secondary-text-color, #5E5B50);
          font-weight: 600;
        }
        .tl-meta {
          font-size: 11px;
          color: var(--secondary-text-color, #5E5B50);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .status { font-size: 13px; color: var(--secondary-text-color, #5E5B50); padding: 10px 4px; }
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
          background: var(--primary-background-color, #F6F4EE);
          border-radius: 24px;
          padding: 16px;
          max-width: 460px;
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
          gap: 8px;
          color: var(--primary-text-color, #26261F);
          font-size: 14px;
          font-weight: 600;
        }
        .modal-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .modal-nav, .modal-close {
          background: var(--secondary-background-color, #EFECE2);
          border: none;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color, #26261F);
          cursor: pointer;
          font-family: inherit;
        }
        .modal-nav:disabled { opacity: 0.4; cursor: default; }
        .modal-img {
          width: 100%;
          border-radius: 16px;
          background: var(--ha-card-background, var(--card-background-color, #FFFFFF));
          object-fit: cover;
        }
      </style>
      <div class="tl-wrap">
        <div class="tl-hdr">
          <div class="tl-title-group">
            <span class="tl-title">Timeline</span>
            <span class="tl-count" id="tl-count">0</span>
          </div>
          <button class="tl-refresh" id="tl-refresh">Refresh</button>
        </div>
        <div class="tl-filters" id="tl-filters"></div>
        <div class="tl-body" id="tl-body"><div class="status">Loading timeline...</div></div>
      </div>
      <div class="modal-backdrop" id="modal">
        <div class="modal-card">
          <div class="modal-hdr">
            <span id="modal-title">Person</span>
            <div class="modal-actions">
              <button class="modal-nav" id="modal-prev" title="Newer">‹</button>
              <button class="modal-nav" id="modal-next" title="Older">›</button>
              <button class="modal-close" id="modal-close">Done</button>
            </div>
          </div>
          <img class="modal-img" id="modal-img" alt="Snapshot" />
        </div>
      </div>
    `;

    const modal = this.shadowRoot.getElementById('modal');
    this.shadowRoot.getElementById('modal-close').onclick = () => modal.classList.remove('open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
    this.shadowRoot.getElementById('tl-refresh').onclick = () => this.loadEvents(true);
    this.shadowRoot.getElementById('modal-prev').onclick = () => this.stepModal(-1);
    this.shadowRoot.getElementById('modal-next').onclick = () => this.stepModal(1);
  }

  formatDayLabel(ts) {
    const d = new Date(ts * 1000);
    const now = new Date();
    const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  getDayKey(ts) {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  stepModal(delta) {
    if (!this._filteredItems || this._modalIdx === undefined) return;
    const nextIdx = this._modalIdx + delta;
    if (nextIdx < 0 || nextIdx >= this._filteredItems.length) return;
    this.openTimelineItem(nextIdx);
  }

  openTimelineItem(idx) {
    const item = this._filteredItems?.[idx];
    if (!item) return;
    this._modalIdx = idx;
    const prevBtn = this.shadowRoot.getElementById('modal-prev');
    const nextBtn = this.shadowRoot.getElementById('modal-next');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= this._filteredItems.length - 1;

    const tm = new Date(item.ev.start_time * 1000).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const displayLabels = item.labelEntries.map(e => this.formatLabelEntry(e));
    this.openFullSnapshot(item.ev, displayLabels, tm);
  }

  renderFilters() {
    const filtersEl = this.shadowRoot.getElementById('tl-filters');
    if (!filtersEl) return;
    if (this.config.show_filters === false || !this._allItems?.length) {
      filtersEl.innerHTML = '';
      filtersEl.style.display = 'none';
      return;
    }

    const unknownName = this.config.unknown_label || 'Visitor';
    const peopleSet = new Map();
    const camSet = new Set();
    let hasUnknown = false;

    for (const item of this._allItems) {
      if (item.cam) camSet.add(item.cam);
      if (!item.labelEntries.length) {
        hasUnknown = true;
      } else {
        for (const e of item.labelEntries) {
          if (e.isUnknown) {
            hasUnknown = true;
          } else {
            const k = e.name.toLowerCase();
            if (!peopleSet.has(k)) peopleSet.set(k, e.name);
          }
        }
      }
    }

    const chips = [{ type: 'all', value: 'all', label: 'All' }];
    for (const [k, name] of peopleSet.entries()) {
      chips.push({ type: 'person', value: k, label: name });
    }
    if (hasUnknown) {
      chips.push({ type: 'person', value: '__unknown__', label: unknownName });
    }
    if (camSet.size > 1) {
      for (const cam of camSet) {
        chips.push({ type: 'camera', value: cam, label: cam.replace(/_/g, ' ') });
      }
    }

    if (chips.length <= 2) {
      filtersEl.innerHTML = '';
      filtersEl.style.display = 'none';
      return;
    }

    filtersEl.style.display = 'flex';
    filtersEl.innerHTML = '';
    for (const ch of chips) {
      const btn = document.createElement('button');
      const isActive = (ch.type === 'all' && !this._activeFilter)
        || (this._activeFilter && this._activeFilter.type === ch.type && this._activeFilter.value === ch.value);
      btn.className = `filter-chip${isActive ? ' active' : ''}`;
      btn.textContent = ch.label;
      btn.onclick = () => {
        this._activeFilter = ch.type === 'all' ? null : { type: ch.type, value: ch.value };
        this.renderFilters();
        this.renderTimeline();
      };
      filtersEl.appendChild(btn);
    }
  }

  renderTimeline() {
    const body = this.shadowRoot.getElementById('tl-body');
    const countEl = this.shadowRoot.getElementById('tl-count');
    if (!body) return;

    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }

    const filter = this._activeFilter;
    const filtered = (this._allItems || []).filter(item => {
      if (!filter) return true;
      if (filter.type === 'camera') return item.cam === filter.value;
      if (filter.type === 'person') {
        if (filter.value === '__unknown__') {
          return item.labelEntries.length === 0 || item.labelEntries.some(e => e.isUnknown);
        }
        return item.labelEntries.some(e => !e.isUnknown && e.name.toLowerCase() === filter.value);
      }
      return true;
    });

    this._filteredItems = filtered;
    if (countEl) countEl.textContent = String(filtered.length);

    if (!filtered.length) {
      body.innerHTML = `<div class="status">No matching person detections.</div>`;
      return;
    }

    const groups = [];
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      const key = this.getDayKey(item.ev.start_time);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: this.formatDayLabel(item.ev.start_time), entries: [] };
        groups.push(g);
      }
      g.entries.push({ item, idx: i });
    }

    body.innerHTML = '';
    const pendingTargets = [];

    for (const g of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'day-group';
      groupEl.innerHTML = `
        <div class="day-hdr">
          <span>${g.label}</span>
          <span class="tl-count">${g.entries.length}</span>
        </div>
        <div class="day-rail"></div>
      `;
      const rail = groupEl.querySelector('.day-rail');

      for (const { item, idx } of g.entries) {
        const { ev, labelEntries } = item;
        const tm = new Date(ev.start_time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const durSec = ev.end_time && ev.start_time ? Math.max(0, Math.round(ev.end_time - ev.start_time)) : 0;
        const durStr = durSec >= 60 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : durSec > 0 ? `${durSec}s` : '';
        const displayLabels = labelEntries.map(e => this.formatLabelEntry(e));
        const pillsHtml = this.renderPillsHtml(labelEntries, displayLabels);

        const metaParts = [];
        if (this.config.show_camera !== false && ev.camera) {
          metaParts.push(ev.camera.replace(/_/g, ' '));
        }
        if (this.config.show_zones !== false && Array.isArray(ev.zones) && ev.zones.length) {
          metaParts.push(ev.zones.join(', ').replace(/_/g, ' '));
        }
        const metaHtml = metaParts.length ? `<div class="tl-meta">${metaParts.join(' · ')}</div>` : '';

        const primaryColor = labelEntries.length && !labelEntries[0].isUnknown
          ? this.getPillColor(labelEntries[0].name)
          : 'var(--secondary-text-color, #5E5B50)';

        const btn = document.createElement('button');
        btn.className = 'tl-item';
        btn.innerHTML = `
          <span class="tl-dot" style="background:${primaryColor}"></span>
          <div class="tl-time-col">
            <span class="tl-time">${tm}</span>
            ${durStr ? `<span class="tl-dur">${durStr}</span>` : ''}
          </div>
          <div class="tl-thumb"><img alt="${displayLabels.join(', ') || 'Person'}" /></div>
          <div class="tl-info">
            <div class="pills">${pillsHtml}</div>
            ${metaHtml}
          </div>
        `;
        btn.onclick = () => this.openTimelineItem(idx);
        rail.appendChild(btn);

        const imgEl = btn.querySelector('img');
        if (item._src) {
          imgEl.src = item._src;
        } else {
          pendingTargets.push({ item, imgEl });
        }
      }

      body.appendChild(groupEl);
    }

    if (!pendingTargets.length || !this._stickerCtx) return;

    const loadOne = async ({ item, imgEl }) => {
      if (item._loading) return;
      item._loading = true;
      const src = await this.fetchStickerSrc(item, this._stickerCtx);
      if (src) {
        item._src = src;
        imgEl.src = src;
      }
      item._loading = false;
    };

    if ('IntersectionObserver' in window) {
      const targetMap = new Map();
      this._observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = targetMap.get(entry.target);
          if (target) {
            this._observer?.unobserve(entry.target);
            targetMap.delete(entry.target);
            loadOne(target);
          }
        }
      }, { rootMargin: '300px 0px' });

      for (const t of pendingTargets) {
        targetMap.set(t.imgEl, t);
        this._observer.observe(t.imgEl);
      }
    } else {
      (async () => {
        for (const t of pendingTargets) {
          await loadOne(t);
        }
      })();
    }
  }

  async loadEvents(force) {
    if (!this._hass || !this.shadowRoot) return;
    if (!force && Date.now() - (this._lastFetch || 0) < 60000) return;
    this._lastFetch = Date.now();

    const body = this.shadowRoot.getElementById('tl-body');
    try {
      const limit = Math.max(1, Number(this.config.limit) || 100);
      const days = Math.max(1, Number(this.config.days) || 14);
      const fetchLimit = Math.max(200, limit * 3);
      const events = await this.fetchFrigateEvents(fetchLimit, days);
      const deduped = this.dedupeEvents(events);

      const db = await this.openDB().catch(() => null);
      let segmenter = null;
      try { segmenter = await getSharedSegmenter(); } catch (_) {}
      const outlineColor = this.getStickerOutlineColor();
      const cacheSuffix = this.getCacheSuffix(outlineColor);
      this._stickerCtx = { db, segmenter, outlineColor, cacheSuffix };
      this._allItems = deduped;

      if (!deduped.length) {
        this.renderFilters();
        const countEl = this.shadowRoot.getElementById('tl-count');
        if (countEl) countEl.textContent = '0';
        body.innerHTML = `<div class="status">No recent person detections (fetched ${events.length} events).</div>`;
        return;
      }

      this.renderFilters();
      this.renderTimeline();
    } catch (err) {
      body.innerHTML = `<div class="status">Frigate error: ${err?.message || err}</div>`;
    }
  }

  getCardSize() { return 6; }
}

class FrigateCutoutsTimelineCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...TIMELINE_DEFAULT_CONFIG, ...config };
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config || TIMELINE_DEFAULT_CONFIG;
    this.shadowRoot.innerHTML = `
      <style>
        .form { display: grid; gap: 12px; padding: 8px 0; font-family: inherit; }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 500; }
        input[type="text"], input[type="number"], select {
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
          <label>Max Events
            <input type="number" data-key="limit" min="1" max="500" value="${c.limit}" />
          </label>
          <label>Lookback (days)
            <input type="number" data-key="days" min="1" max="90" value="${c.days}" />
          </label>
        </div>
        <div class="row">
          <label>Dedupe Window (minutes, 0 = all)
            <input type="number" data-key="dedupe_minutes" min="0" max="60" value="${c.dedupe_minutes}" />
          </label>
          <label>Multiple People Mode
            <select data-key="group_mode">
              <option value="individual" ${c.group_mode !== 'grouped' ? 'selected' : ''}>Individual (one entry per person)</option>
              <option value="grouped" ${c.group_mode === 'grouped' ? 'selected' : ''}>Grouped (combine nearby events)</option>
            </select>
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
          <label>Label Confidence Threshold (0 = off)
            <input type="number" data-key="label_confidence_threshold" min="0" max="1" step="0.05" value="${c.label_confidence_threshold}" />
          </label>
        </div>
        <div class="row">
          <label class="chk">
            <input type="checkbox" data-key="show_filters" ${c.show_filters !== false ? 'checked' : ''} />
            Show person/camera filter chips
          </label>
          <label class="chk">
            <input type="checkbox" data-key="show_camera" ${c.show_camera !== false ? 'checked' : ''} />
            Show camera name
          </label>
        </div>
        <div class="row">
          <label class="chk">
            <input type="checkbox" data-key="show_zones" ${c.show_zones !== false ? 'checked' : ''} />
            Show zones
          </label>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('input, select').forEach(el => {
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
customElements.define('frigate-cutouts-timeline-card', FrigateCutoutsTimelineCard);
customElements.define('frigate-cutouts-timeline-card-editor', FrigateCutoutsTimelineCardEditor);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: 'frigate-cutouts-card',
    name: 'Frigate Cutouts Card',
    description: 'Displays recent Frigate person detections as die-cut stickers with face labels.',
    preview: true,
  },
  {
    type: 'frigate-cutouts-timeline-card',
    name: 'Frigate Cutouts Timeline Card',
    description: 'Displays a chronological timeline of Frigate person detection cutouts.',
    preview: true,
  }
);
