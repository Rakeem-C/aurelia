import { UNITS, BUILDINGS } from './catalog.js';
import { projectWorld, unprojectWorld } from './projection.js';

// Simulation coordinates stay square. Ground layers use the 2:1 affine view;
// upright sprites are depth-sorted and drawn at projected anchors without shear.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = s => { let n = 2166136261; for (const c of String(s)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
const noise = (x, y, seed = 1) => ((Math.imul(x + seed, 374761393) ^ Math.imul(y + seed, 668265263)) >>> 0) / 4294967295;
const surface = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ellipse = (c, x, y, rx, ry, fill, stroke) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.stroke(); } };
const poly = (c, points, fill, stroke) => { c.beginPath(); c.moveTo(...points[0]); for (let i = 1; i < points.length; i++) c.lineTo(...points[i]); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.stroke(); } };
const line = (c, x1, y1, x2, y2, color, width = 1) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
// Generated sheets have irregular gutters and some tall silhouettes cross row
// boundaries. Explicit measured source rectangles preserve roofs and helmets.
const ATLAS_RECTS = {
  buildings: [[6,47,322,302],[330,74,623,289],[640,72,935,301],[952,85,1247,291],[15,368,306,567],[319,354,636,574],[639,345,936,586],[947,363,1250,578],[12,651,310,873],[312,661,631,882],[634,610,958,879],[1015,593,1243,887],[26,947,317,1184],[328,912,614,1177],[634,893,956,1191],[949,894,1253,1200]],
  resources: [[34,68,431,431],[541,26,828,427],[918,100,1288,432],[1391,177,1732,430],[46,581,421,816],[501,579,866,826],[923,580,1294,815],[1434,499,1718,799]],
  units: [[75,16,174,203],[290,16,399,202],[510,15,618,195],[723,16,847,201],[946,15,1064,197],[1163,14,1291,196],[1404,15,1510,196],[1629,15,1728,198],[78,231,182,430],[287,231,407,429],[502,230,628,420],[708,231,851,427],[950,231,1067,429],[1172,230,1293,423],[1389,230,1512,424],[1634,231,1740,425],[67,459,175,644],[286,457,395,644],[514,457,623,637],[705,457,843,641],[937,457,1064,639],[1169,456,1291,639],[1379,456,1507,638],[1621,458,1729,641],[10,654,200,864],[239,654,433,863],[510,653,625,871],[682,654,866,864],[908,654,1105,865],[1137,654,1326,871],[1392,653,1508,872],[1565,655,1754,869]]
};
const BUILDING_ANCHORS = [.75,.80,.68,.81,.76,.86,.68,.77,.74,.73,.84,.91,.89,.85,.88,.80];
const RESOURCE_ANCHORS = [.98,.985,.97,.96,.85,.85,.85,.97];

export class Renderer {
  constructor(canvas, minimapCanvas, options = {}) {
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.mctx = minimapCanvas?.getContext('2d', { alpha: false });
    this.options = options;
    this.camera = { x: 400, y: 400, zoom: 1 };
    this.fps = 60;
    this.visibleCount = 0;
    this.placement = null;
    this.selectionBox = null;
    this.state = null;
    this.previous = new Map();
    this.previousProjectiles = new Map();
    this.previousTime = 0;
    this.knownBuildings = new Map();
    this.sprites = new Map();
    this.unitSprites = new Map();
    this.chunks = new Map();
    this.lastSnapshot = 0;
    this.snapshotInterval = 100;
    this.lastFrame = 0;
    this.lastMinimap = -Infinity;
    this.mapKey = '';
    this.initializedCamera = false;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.atlases = new Map();
    this.loadAtlas('buildings', './assets/buildings-isometric.png', 4, 4);
    this.loadAtlas('resources', './assets/resources-isometric.png', 4, 2);
    this.loadAtlas('units', './assets/units-isometric.png', 8, 4);
    this.resize();
  }

  loadAtlas(name, url, cols, rows) {
    if (typeof Image === 'undefined') return;
    const image = new Image();
    image.onload = () => {
      try {
        const cw = image.naturalWidth / cols, ch = image.naturalHeight / rows, cells = [];
        for (let i = 0; i < cols * rows; i++) {
          const knownSheet = image.naturalWidth === (name === 'buildings' ? 1254 : 1774);
          const roi = knownSheet ? ATLAS_RECTS[name]?.[i] : null;
          const sx = roi ? roi[0] - 1 : (i % cols) * cw, sy = roi ? roi[1] - 1 : Math.floor(i / cols) * ch;
          const sw = roi ? roi[2] - roi[0] + 3 : cw, sh = roi ? roi[3] - roi[1] + 3 : ch;
          const cell = surface(Math.ceil(sw), Math.ceil(sh)), cc = cell.getContext('2d');
          cc.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
          const data = cc.getImageData(0, 0, cell.width, cell.height).data;
          let left = cell.width, right = 0, top = cell.height, bottom = 0;
          for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) if (data[(y * cell.width + x) * 4 + 3] > 12) {
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          if (left > right) { cells.push(null); continue; }
          const trimmed = surface(right - left + 3, bottom - top + 3);
          trimmed.getContext('2d').drawImage(cell, left, top, right - left + 1, bottom - top + 1, 1, 1, trimmed.width - 2, trimmed.height - 2);
          // Atlas art is centered on a ground-contact anchor. Trimming removes
          // blank gutters; the lower shadow remains part of the cached image.
          let enemyImage = null;
          if (name === 'units') {
            enemyImage = surface(trimmed.width, trimmed.height); const ec = enemyImage.getContext('2d'); ec.drawImage(trimmed, 0, 0);
            const pixels = ec.getImageData(0, 0, trimmed.width, trimmed.height), pd = pixels.data;
            for (let k = 0; k < pd.length; k += 4) if (pd[k] > 100 && pd[k] > pd[k + 1] * 1.9 && pd[k] > pd[k + 2] * 1.8) {
              const red = pd[k]; pd[k] = Math.round(red * .35); pd[k + 1] = Math.round(red * .67); pd[k + 2] = Math.round(red * .84);
            }
            ec.putImageData(pixels, 0, 0);
          }
          cells.push({ image: trimmed, enemyImage, anchorX: .5, anchorY: name === 'units' ? .98 : name === 'resources' ? RESOURCE_ANCHORS[i] : BUILDING_ANCHORS[i] });
        }
        this.atlases.set(name, cells); this.unitSprites.clear(); this.sprites.clear();
      } catch { /* Procedural art remains usable if an optional atlas fails. */ }
    };
    image.onerror = () => {}; image.src = url;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width || this.canvas.clientWidth || 800);
    this.height = Math.max(1, r.height || this.canvas.clientHeight || 600);
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    if (this.minimapCanvas) {
      const mr = this.minimapCanvas.getBoundingClientRect();
      this.mw = Math.max(1, mr.width || this.minimapCanvas.clientWidth || 190);
      this.mh = Math.max(1, mr.height || this.minimapCanvas.clientHeight || 190);
      this.minimapCanvas.width = Math.round(this.mw * this.dpr);
      this.minimapCanvas.height = Math.round(this.mh * this.dpr);
    }
    this.lastMinimap = -Infinity;
    this.createVignette();
    this.clampCamera();
  }

  createVignette() {
    // The lighting layer changes only with viewport dimensions, not each frame.
    this.vignette = surface(Math.ceil(this.width), Math.ceil(this.height));
    const c = this.vignette.getContext('2d');
    const gradient = c.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * .3, this.width / 2, this.height / 2, Math.max(this.width, this.height) * .68);
    gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, '#10130e44');
    c.fillStyle = gradient; c.fillRect(0, 0, this.width, this.height);
  }

  screenToWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const center = projectWorld(this.camera.x, this.camera.y);
    return unprojectWorld(center.x + (clientX - r.left - this.width / 2) / this.camera.zoom, center.y + (clientY - r.top - this.height / 2) / this.camera.zoom);
  }

  worldToScreen(x, y) {
    const p = projectWorld(x - this.camera.x, y - this.camera.y);
    return { x: p.x * this.camera.zoom + this.width / 2, y: p.y * this.camera.zoom + this.height / 2 };
  }

  pan(dx, dy) { const delta = unprojectWorld(dx / this.camera.zoom, dy / this.camera.zoom); this.camera.x += delta.x; this.camera.y += delta.y; this.clampCamera(); }
  centerOn(x, y) { this.camera.x = x; this.camera.y = y; this.clampCamera(); }
  zoomAt(factor, clientX, clientY) {
    const before = this.screenToWorld(clientX, clientY);
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.3, 2.3);
    const after = this.screenToWorld(clientX, clientY);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.clampCamera();
  }

  clampCamera() {
    if (!this.state) return;
    const size = this.state.map.size;
    // Every valid world point can be centered, including diamond-map corners.
    // This exposes the background near an edge but never traps the camera away
    // from a settlement, selected army, or minimap click.
    this.camera.x = clamp(this.camera.x, 0, size);
    this.camera.y = clamp(this.camera.y, 0, size);
  }

  viewportWorldCorners(margin = 0) {
    const center = projectWorld(this.camera.x, this.camera.y), z = this.camera.zoom;
    return [[-margin, -margin], [this.width + margin, -margin], [this.width + margin, this.height + margin], [-margin, this.height + margin]].map(([x, y]) => unprojectWorld(center.x + (x - this.width / 2) / z, center.y + (y - this.height / 2) / z));
  }

  getEntityScreenBounds(e) {
    const p = this.worldToScreen(e.x, e.y), z = this.camera.zoom;
    if (e.kind === 'building') {
      const a = this.buildingAtlasCell(e.type), w = Math.max(76, (e.size || 30) * 3.75);
      const h = a ? w * a.image.height / a.image.width : (e.size || 30) * 2.65;
      const anchor = a?.anchorY ?? .82;
      return { left: p.x - w * z / 2, right: p.x + w * z / 2, top: p.y - h * anchor * z, bottom: p.y + h * (1 - anchor) * z };
    }
    const h = UNITS[e.type]?.category === 'cavalry' ? 43 : 34;
    return { left: p.x - 14 * z, right: p.x + 14 * z, top: p.y - h * z, bottom: p.y + 5 * z };
  }

  minimapToWorld(clientX, clientY) {
    if (!this.minimapCanvas || !this.state) return { x: 0, y: 0 };
    const r = this.minimapCanvas.getBoundingClientRect(), side = Math.min(r.width, r.height);
    const ox = (r.width - side) / 2, oy = (r.height - side) / 2;
    return { x: clamp((clientX - r.left - ox) / side, 0, 1) * this.state.map.size, y: clamp((clientY - r.top - oy) / side, 0, 1) * this.state.map.size };
  }

  isVisible(x, y) {
    if (!this.state || this.state.config?.fog === false || !this.state.fog?.visible) return true;
    const m = this.state.map, gx = Math.floor(x / m.cellSize), gy = Math.floor(y / m.cellSize);
    return gx >= 0 && gy >= 0 && gx < m.width && gy < m.height && !!this.state.fog.visible[gy * m.width + gx];
  }

  isExplored(x, y) {
    if (!this.state || this.state.config?.fog === false || !this.state.fog?.explored) return true;
    const m = this.state.map, gx = Math.floor(x / m.cellSize), gy = Math.floor(y / m.cellSize);
    return gx >= 0 && gy >= 0 && gx < m.width && gy < m.height && !!this.state.fog.explored[gy * m.width + gx];
  }

  setState(state) {
    if (!state?.map) return;
    const now = performance.now();
    const key = `${state.seed}:${state.config?.map}:${state.map.size}:${state.map.width}:${state.map.height}`;
    const reset = key !== this.mapKey || (this.state && state.time < this.state.time);
    this.previous.clear();
    this.previousProjectiles.clear();
    this.previousTime = this.state && !reset ? this.state.time : state.time;
    if (this.state && !reset) for (const e of this.state.entities) this.previous.set(e.id, e);
    if (this.state && !reset) for (const p of this.state.projectiles || []) this.previousProjectiles.set(p.id, p);
    if (this.lastSnapshot && !reset) this.snapshotInterval = clamp(now - this.lastSnapshot, 30, 250);
    this.lastSnapshot = now;
    this.state = state;
    if (reset) {
      this.chunks.clear(); this.knownBuildings.clear(); this.mapKey = key;
      this.initializedCamera = false;
      this.createMapLayers();
    }
    if (!this.initializedCamera) {
      const home = state.entities.find(e => e.owner === 0 && e.kind === 'building') || state.entities.find(e => e.owner === 0);
      this.centerOn(home?.x ?? state.map.size / 2, home?.y ?? state.map.size / 2);
      this.initializedCamera = true;
    }
    const current = new Set();
    for (const e of state.entities) if (e.owner === 1 && e.kind === 'building' && this.isVisible(e.x, e.y)) {
      this.knownBuildings.set(e.id, { ...e, queue: [], age: state.players?.find(p => p.id === e.owner)?.age || 0 });
      current.add(e.id);
    }
    for (const [id, e] of this.knownBuildings) if (this.isVisible(e.x, e.y) && !current.has(id)) this.knownBuildings.delete(id);
    this.updateFog();
    this.lastMinimap = -Infinity;
  }

  createMapLayers() {
    const m = this.state.map;
    this.fogCanvas = surface(m.width, m.height);
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImage = this.fogCtx.createImageData(m.width, m.height);
    this.mapCanvas = surface(m.width, m.height);
    const c = this.mapCanvas.getContext('2d'), img = c.createImageData(m.width, m.height);
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x, p = i * 4, t = m.terrain[i], n = noise(x, y, this.state.seed);
      const rgb = t === 2 ? [46, 94, 112] : t === 1 ? [99, 105, 86] : [96 + n * 14, 121 + n * 17, 60 + n * 10];
      img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2]; img.data[p + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }

  updateFog() {
    if (!this.fogCtx) return;
    const fog = this.state.fog, disabled = this.state.config?.fog === false || !fog;
    const data = this.fogImage.data;
    this.hasFog = false;
    for (let i = 0; i < this.state.map.width * this.state.map.height; i++) {
      const p = i * 4;
      data[p] = 15; data[p + 1] = 22; data[p + 2] = 22;
      data[p + 3] = disabled || fog.visible?.[i] ? 0 : fog.explored?.[i] ? 148 : 255;
      if (data[p + 3]) this.hasFog = true;
    }
    this.fogCtx.putImageData(this.fogImage, 0, 0);
  }

  terrainChunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (this.chunks.has(key)) return this.chunks.get(key);
    const tile = 32, chunk = 512, img = surface(chunk), c = img.getContext('2d'), m = this.state.map;
    const grass = c.createLinearGradient(0, 0, chunk, chunk);
    grass.addColorStop(0, '#75835a'); grass.addColorStop(.5, '#718157'); grass.addColorStop(1, '#6c7a51');
    c.fillStyle = grass; c.fillRect(0, 0, chunk, chunk);
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
      const gx = cx * 16 + lx, gy = cy * 16 + ly, x = lx * tile, y = ly * tile;
      if (gx >= m.width || gy >= m.height) continue;
      const t = m.terrain[gy * m.width + gx], n = noise(gx, gy, this.state.seed);
      if (t === 2) {
        c.fillStyle = '#477d87'; c.fillRect(x, y, tile, tile);
        line(c, x + 4, y + 12, x + 23, y + 10, '#b9d5c929', .7);
        line(c, x + 8, y + 24, x + 29, y + 22, '#b9d5c921', .6);
      } else if (t === 1) {
        c.fillStyle = '#83837066'; c.fillRect(x, y, tile, tile);
        for (let k = 0; k < 5; k++) {
          const px = x + noise(gx + k * 83, gy, this.state.seed) * 28, py = y + noise(gx, gy + k * 53, this.state.seed) * 28;
          ellipse(c, px, py, 3 + k % 3, 2 + k % 2, '#b3b5a3', '#707868'); line(c, px - 1, py - 1, px + 2, py - 1, '#d2d0b9', .7);
        }
      } else {
        // Fine grain and broad translucent patches avoid a visible tile grid.
        if (n > .80) ellipse(c, x + 13, y + 17, 25, 18, '#b2a57514');
        for (let k = 0; k < 12; k++) {
          const px = x + noise(gx + k * 17, gy, this.state.seed) * 28 + 2, py = y + noise(gx, gy + k * 9, this.state.seed) * 28 + 2;
          line(c, px, py + 1.4, px + .7, py - 1.5, k % 3 ? '#aeb88536' : '#41553640', .7);
        }
        if (n > .994) { ellipse(c, x + 10, y + 20, .7, .7, '#dedbb2'); ellipse(c, x + 16, y + 24, .7, .7, '#dfcf83'); }
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (m.terrain[(gy + dy) * m.width + gx + dx] === 2) {
          const shore = c.createLinearGradient(x, y, x + (dx ? tile : 0), y + (dy ? tile : 0));
          const edge = '#c6bb905e', clear = '#b5b38400'; shore.addColorStop(0, dx + dy < 0 ? edge : clear); shore.addColorStop(1, dx + dy > 0 ? edge : clear);
          c.fillStyle = shore; c.fillRect(x, y, tile, tile);
        }
      }
    }
    this.chunks.set(key, img);
    return img;
  }

  groundDiamond(c, x, y, radius, fill, stroke) {
    const corners = [[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]].map(([dx, dy]) => { const p = projectWorld(dx, dy); return [x + p.x, y + p.y]; });
    poly(c, corners, fill, stroke);
  }

  buildingAtlasCell(type) {
    const index = Object.keys(BUILDINGS).indexOf(type);
    return this.atlases.get('buildings')?.[index];
  }

  render(timestamp, selectedIds = []) {
    const c = this.ctx;
    if (this.lastFrame && timestamp > this.lastFrame) this.fps += (1000 / (timestamp - this.lastFrame) - this.fps) * 0.04;
    this.lastFrame = timestamp;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#101818'; c.fillRect(0, 0, this.width, this.height);
    if (!this.state) return;
    const z = this.camera.zoom, m = this.state.map, margin = 180;
    const corners = this.viewportWorldCorners(margin * z);
    const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
    const right = Math.max(...corners.map(p => p.x)), bottom = Math.max(...corners.map(p => p.y));
    const center = projectWorld(this.camera.x, this.camera.y);
    c.save(); c.translate(this.width / 2, this.height / 2); c.scale(z, z); c.translate(-center.x, -center.y);
    c.save(); c.transform(1, .5, -1, .5, 0, 0);
    // Opaque ground underlay plus a one-world-pixel chunk overlap prevents
    // transparent bilinear seams when the square textures become diamonds.
    c.fillStyle = '#728057'; c.fillRect(0, 0, m.size, m.size);
    const cx0 = Math.max(0, Math.floor(left / 512)), cy0 = Math.max(0, Math.floor(top / 512));
    const cx1 = Math.min(Math.ceil(m.size / 512) - 1, Math.floor(right / 512)), cy1 = Math.min(Math.ceil(m.size / 512) - 1, Math.floor(bottom / 512));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) c.drawImage(this.terrainChunk(cx, cy), cx * 512, cy * 512, 513, 513);
    if (!this.dirtSprite) {
      this.dirtSprite = surface(128); const dc = this.dirtSprite.getContext('2d'), dg = dc.createRadialGradient(64, 64, 25, 64, 64, 62);
      dg.addColorStop(0, '#b4a27d70'); dg.addColorStop(.7, '#ad9a7550'); dg.addColorStop(1, '#ad9a7500'); dc.fillStyle = dg; dc.fillRect(0, 0, 128, 128);
    }
    for (const e of this.state.entities) if (e.kind === 'building' && e.x >= left && e.x <= right && e.y >= top && e.y <= bottom && (e.owner === 0 || this.isVisible(e.x, e.y))) {
      const r = (e.size || 30) * 1.7; c.drawImage(this.dirtSprite, e.x - r, e.y - r, r * 2, r * 2);
    }
    c.imageSmoothingEnabled = true;
    if (this.hasFog) c.drawImage(this.fogCanvas, 0, 0, m.width * m.cellSize, m.height * m.cellSize);
    c.strokeStyle = '#d4c28060'; c.lineWidth = 2 / z; c.strokeRect(0, 0, m.size, m.size);
    c.restore();
    const selected = new Set(selectedIds), visible = [], currentBuildings = new Set();
    const alpha = clamp((performance.now() - this.lastSnapshot) / this.snapshotInterval, 0, 1);
    this.renderAlpha = alpha;
    this.renderTime = this.previousTime + (this.state.time - this.previousTime) * alpha;
    for (const e of this.state.entities) {
      if (e.alive === false || e.x < left - margin || e.x > right + margin || e.y < top - margin || e.y > bottom + margin) continue;
      if (e.owner === 1 && !this.isVisible(e.x, e.y)) continue;
      if (e.kind === 'resource' && !this.isExplored(e.x, e.y)) continue;
      if (e.owner === 1 && e.kind === 'building') currentBuildings.add(e.id);
      visible.push(e);
    }
    for (const [id, e] of this.knownBuildings) if (!currentBuildings.has(id) && !this.isVisible(e.x, e.y) && e.x >= left - margin && e.x <= right + margin && e.y >= top - margin && e.y <= bottom + margin) visible.push({ ...e, stale: true });
    visible.sort((a, b) => a.x + a.y - b.x - b.y);
    this.visibleCount = visible.length;
    for (const e of visible) {
      const p = this.previous.get(e.id);
      const lerp = e.kind === 'unit' && p && Math.hypot(e.x - p.x, e.y - p.y) < 150;
      const wx = lerp ? p.x + (e.x - p.x) * alpha : e.x, wy = lerp ? p.y + (e.y - p.y) * alpha : e.y;
      const projected = projectWorld(wx, wy), x = projected.x, y = projected.y;
      const isSelected = selected.has(e.id);
      if (isSelected) {
        c.lineWidth = 1.5 / z;
        this.groundDiamond(c, x, y, Math.max(9, e.size + 3), '#f2d77b16', '#f7df86');
      }
      if (e.kind === 'resource') this.drawResource(c, e, x, y);
      else if (e.kind === 'building') this.drawBuilding(c, e, x, y);
      else this.drawUnit(c, e, x, y, timestamp);
      if (!e.stale && e.kind !== 'resource' && (isSelected || e.hp < e.maxHp || e.kind === 'building' && e.progress < 1)) this.drawBars(c, e, x, y);
      if (isSelected && e.kind === 'building' && e.rally) this.drawRally(c, e, x, y);
    }
    this.drawProjectiles(c, timestamp);
    this.drawEffects(c, timestamp);
    if (this.placement) this.drawPlacement(c);
    c.restore();
    c.drawImage(this.vignette, 0, 0, this.width, this.height);
    if (this.selectionBox) {
      const b = this.selectionBox; c.fillStyle = '#e8d17a1c'; c.strokeStyle = '#f0d789'; c.lineWidth = 1;
      c.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); c.strokeRect(b.x1 + 0.5, b.y1 + 0.5, b.x2 - b.x1, b.y2 - b.y1);
    }
    if (timestamp - this.lastMinimap > 100) { this.drawMinimap(selected); this.lastMinimap = timestamp; }
  }

  buildingSprite(type, owner, age = 0) {
    const key = `b:${type}:${owner}:${age}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    const img = surface(192, 210), c = img.getContext('2d');
    c.translate(96, 130); c.scale(1.5, 1.5);
    this.buildingArt(c, type, owner, age);
    this.sprites.set(key, img); return img;
  }

  buildingArt(c, type, owner, age) {
    const name = type.toLowerCase(), roof = owner === 1 ? '#467e8c' : '#b6452f', roofLight = owner === 1 ? '#6e9d9f' : '#d26442';
    const stone = age > 0 ? '#c9bb94' : '#d9cca6', wall = '#ad9d7c', dark = '#685a43';
    c.lineJoin = 'round'; c.lineWidth = 1;
    ellipse(c, 6, 16, 39, 16, '#16201a45');
    const block = (x, y, w, h, height, roofing = true) => {
      poly(c, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], '#b29d71', '#807457');
      poly(c, [[x, y - height], [x + w, y - height], [x + w, y + h - height], [x, y + h - height]], stone, dark);
      poly(c, [[x, y + h - height], [x + w, y + h - height], [x + w, y + h], [x, y + h]], wall, dark);
      poly(c, [[x + w, y - height], [x + w + 5, y - height + 4], [x + w + 5, y + h + 3], [x + w, y + h]], '#938568', dark);
      if (roofing) {
        poly(c, [[x - 4, y - height + 2], [x + w / 2, y - height - 13], [x + w + 4, y - height + 2], [x + w + 4, y + h - height + 4], [x - 4, y + h - height + 4]], roof, '#733c2d');
        poly(c, [[x - 4, y - height + 2], [x + w / 2, y - height - 13], [x + w / 2, y + h - height - 10], [x - 4, y + h - height + 4]], roofLight);
        for (let yy = y - height + 6; yy < y + h - height; yy += 4) line(c, x - 2, yy, x + w + 2, yy, '#391f162e');
      }
      for (let xx = x + 7; xx < x + w - 3; xx += 12) { c.fillStyle = dark; c.fillRect(xx, y + h - height + 4, 4, 6); }
    };
    const flag = (x, y) => { line(c, x, y + 19, x, y - 12, '#dbc69a', 1.4); poly(c, [[x, y - 12], [x + 12, y - 9], [x + 9, y - 3], [x, y - 5]], roofLight, roof); };
    const tower = (x, y, w = 13, h = 35) => {
      block(x, y, w, 12, h, false);
      c.fillStyle = stone; for (let i = 0; i < 3; i++) c.fillRect(x - 1 + i * w / 3, y - h - 4, w / 4, 6);
      c.fillStyle = dark; c.fillRect(x + w / 2 - 1.5, y + 8 - h / 2, 3, 7);
    };
    if (/farm/.test(name)) {
      poly(c, [[-37, -24], [33, -24], [40, 23], [-31, 23]], '#817744', '#615b35');
      for (let i = -28; i <= 28; i += 7) { line(c, i, -21, i + 7, 21, '#504f31', 3); for (let yy = -18; yy < 20; yy += 7) { line(c, i + (yy + 21) / 7, yy, i + (yy + 21) / 7 - 2, yy - 4, '#b3b765', 2); } }
      c.fillStyle = '#dbbe72'; c.fillRect(26, -26, 5, 7); return;
    }
    if (/wall|gate/.test(name)) {
      block(-35, -1, 70, 9, 20, false); for (let x = -35; x < 34; x += 9) { c.fillStyle = stone; c.fillRect(x, -25, 6, 7); }
      if (/gate/.test(name)) { tower(-36, 0, 14, 30); tower(22, 0, 14, 30); c.fillStyle = '#594a37'; c.fillRect(-12, -12, 24, 19); for (let i = -10; i < 13; i += 5) line(c, i, -11, i, 6, '#b7a07d'); } return;
    }
    if (/tower/.test(name)) { tower(-13, 10, 26, 57); flag(0, -52); return; }
    if (/fort|castle/.test(name)) {
      block(-30, -8, 59, 27, 25, false); block(-17, -17, 33, 24, 46); tower(-37, -5, 17, 38); tower(23, -5, 17, 38); tower(-37, 19, 17, 38); tower(23, 19, 17, 38); flag(2, -62); return;
    }
    if (/civic|town|forum|heart/.test(name)) {
      poly(c, [[-43, -29], [39, -29], [43, 29], [-40, 29]], '#b5aa80', '#827857');
      block(-34, -22, 68, 20, 20); block(-31, 3, 22, 18, 23); block(10, 3, 22, 18, 23);
      c.fillStyle = '#dccdae'; c.fillRect(-12, -2, 23, 13); c.fillStyle = '#73654b'; c.fillRect(-5, 2, 9, 13);
      for (const x of [-27, -16, 15, 26]) { c.fillStyle = '#e1d5b6'; c.fillRect(x, -2, 4, 22); }
      block(-8, -25, 16, 10, 31, false); flag(1, -64); return;
    }
    if (/house/.test(name)) { block(-23, -12, 45, 30, age ? 23 : 18); c.fillStyle = '#584836'; c.fillRect(-4, 0, 9, 18); if (age > 1) block(17, -15, 12, 14, 30, false); return; }
    if (/lumber|wood/.test(name)) {
      block(-25, -14, 42, 22, 15); for (let i = 0; i < 4; i++) { c.fillStyle = '#684931'; c.fillRect(8 + i * 5, 13 - i * 2, 24, 5); ellipse(c, 8 + i * 5, 15 - i * 2, 3, 2.5, '#b18b56'); }
      line(c, -32, 14, -32, -20, '#d1b98a', 2); line(c, -39, -12, -24, -12, '#786d56', 3); return;
    }
    if (/mining|mine/.test(name)) {
      block(-23, -13, 34, 24, 13); poly(c, [[9, 18], [16, -4], [28, -12], [39, 13]], '#818471', '#5b614f'); poly(c, [[17, 13], [21, -1], [29, 0], [33, 13]], '#333c32'); line(c, 17, 20, 39, 21, '#bca47a', 2); return;
    }
    if (/range|arch/.test(name)) {
      block(-31, -18, 53, 19, 18); poly(c, [[-26, 3], [32, 3], [36, 24], [-23, 24]], '#b49e71');
      for (let i = 0; i < 3; i++) { line(c, -18 + i * 21, 19, -18 + i * 21, 1, '#6c4a32', 2); ellipse(c, -18 + i * 21, 1, 6, 8, '#e0d4b0', '#6b4c37'); ellipse(c, -18 + i * 21, 1, 3.5, 5, '#b64f37'); ellipse(c, -18 + i * 21, 1, 1, 2, '#e8d594'); } return;
    }
    if (/stable/.test(name)) {
      block(-33, -20, 63, 30, 24); for (let i = 0; i < 3; i++) { c.fillStyle = '#624f3d'; c.fillRect(-25 + i * 20, -3, 12, 13); }
      line(c, -35, 22, 36, 22, '#d0b286', 3); for (let x = -35; x <= 35; x += 14) line(c, x, 13, x, 27, '#bb9d70', 2);
      ellipse(c, 1, 14, 8, 4, '#8e6340'); ellipse(c, 8, 8, 3.5, 5, '#8e6340'); return;
    }
    if (/market/.test(name)) {
      block(-19, -24, 40, 16, 19); for (let i = 0; i < 3; i++) {
        const x = -35 + i * 26; line(c, x, 26, x, 6, '#6f553a', 2); line(c, x + 21, 26, x + 21, 6, '#6f553a', 2);
        poly(c, [[x - 2, 5], [x + 10, -2], [x + 24, 5], [x + 22, 12], [x - 2, 12]], i === 1 ? '#d8bd78' : roofLight, '#78593a');
        c.fillStyle = '#816344'; c.fillRect(x, 18, 21, 6); for (let k = 0; k < 4; k++) ellipse(c, x + 4 + k * 4, 18, 2.5, 2, ['#bc8952', '#b7b966', '#a64a31'][i]);
      } return;
    }
    if (/smith|forge/.test(name)) {
      block(-28, -17, 48, 31, 20); block(17, -8, 13, 16, 41, false); c.fillStyle = '#352c23'; c.fillRect(-13, -2, 14, 16); ellipse(c, -5, 9, 5, 3, '#e99239'); poly(c, [[-32, 24], [-18, 24], [-15, 18], [-29, 18]], '#494944'); line(c, -23, 23, -23, 29, '#514d41', 3); return;
    }
    if (/workshop|siege|foundry/.test(name)) {
      block(-34, -20, 68, 32, 25); block(23, -16, 10, 13, age > 2 ? 49 : 34, false); ellipse(c, -18, 22, 10, 10, '#987a4e', '#463e30'); ellipse(c, -18, 22, 4, 4, '#544834'); line(c, 8, 25, 15, 4, '#b59360', 4); line(c, 1, 12, 24, 12, '#9d7c4a', 3); return;
    }
    if (/refinery|oil/.test(name)) {
      block(-34, -18, 31, 27, 18); block(-31, -15, 8, 9, 44, false);
      for (let i = 0; i < 2; i++) { const xx = 10 + i * 18; c.fillStyle = '#8f9990'; c.fillRect(xx - 8, -16, 16, 31); ellipse(c, xx, -16, 8, 4, '#bbc0ac', '#627366'); ellipse(c, xx, 15, 8, 4, '#859285', '#627366'); line(c, xx - 7, -1, xx + 7, -1, roof, 4); }
      line(c, -2, 23, 35, 23, '#7e7960', 4); return;
    }
    if (/barrack/.test(name)) {
      block(-34, -17, 65, 32, 25); c.fillStyle = '#69543d'; c.fillRect(-7, -3, 15, 18); flag(-28, -42); flag(27, -42);
      for (let i = 0; i < 3; i++) { ellipse(c, -22 + i * 22, 21, 5, 7, roof, '#e1c78b'); line(c, -20 + i * 22, 23, -15 + i * 22, 5, '#dad3b3', 1.5); } return;
    }
    block(-28, -17, 54, 32, 24); flag(0, -42);
  }

  drawBuilding(c, e, x, y) {
    const age = e.stale ? e.age : this.state.players?.find(p => p.id === e.owner)?.age || 0;
    const atlas = this.buildingAtlasCell(e.type);
    const sprite = atlas ? null : this.buildingSprite(e.type, e.owner, age), radius = e.size || BUILDINGS[e.type]?.size || 30, scale = radius / 43;
    c.save(); c.globalAlpha = e.stale ? 0.7 : 1;
    if (e.progress < 1) {
      this.groundDiamond(c, x, y, radius, '#baaa7855', '#e4ce91');
      c.globalAlpha *= 0.3 + e.progress * .7;
    }
    if (atlas) {
      const w = Math.max(76, radius * 3.75), h = w * atlas.image.height / atlas.image.width;
      c.drawImage(atlas.image, x - w * atlas.anchorX, y - h * atlas.anchorY, w, h);
      // The original art uses warm vermilion roofs. A clear world-space standard
      // identifies allegiance without tinting stone, plants, or metal blue.
      if (e.type !== 'farm' && !e.stale) {
        const fx = x + radius * .8, fy = y - radius * .35;
        line(c, fx, fy, fx, fy - 25, '#b8a172', 1.2);
        poly(c, [[fx, fy - 25], [fx + 12, fy - 22], [fx + 10, fy - 16], [fx, fy - 17]], e.owner === 1 ? '#488aa5' : '#a53125', '#ead49d');
      }
    } else c.drawImage(sprite, x - 64 * scale, y - 130 / 1.5 * scale, 128 * scale, 140 * scale);
    c.restore();
    if (e.progress < 1 && !e.stale) {
      c.save(); c.strokeStyle = '#caaa74'; c.lineWidth = 2;
      for (const side of [-1, 1]) { const sx = x + radius * side; line(c, sx, y + 12, sx, y - radius, '#b59c6a', 2); line(c, sx, y - radius, sx - side * radius * 2, y + 8, '#b59c6a', 1); }
      line(c, x - radius, y - radius * .4, x + radius, y - radius * .4, '#d3b57b', 2); c.restore();
    }
    if (!e.stale && /smith|forge|foundry/.test(e.type) && (e.progress ?? 1) >= 1) {
      const phase = (performance.now() / 1000 + hash(e.id) % 5) % 3;
      ellipse(c, x + radius * .55, y - radius - phase * 8, 2 + phase * 2, 3 + phase * 2, `rgba(218,210,186,${.23 * (1 - phase / 3)})`);
    }
  }

  resourceSprite(type, variant, source = '', hunted = false) {
    const key = `r:${type}:${variant}:${source}:${hunted}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    const img = surface(88, 100), c = img.getContext('2d'); c.translate(44, 68);
    ellipse(c, 5, 4, 23, 10, '#1c291847');
    if (type === 'wood') {
      line(c, 0, 5, -2, -33, '#73563a', 7); line(c, -1, -12, -14, -27, '#73563a', 3);
      const colors = ['#354f31', '#466535', '#5b793e', '#719147'];
      if (variant === 2) {
        for (let k = 0; k < 4; k++) poly(c, [[-22 + k * 3, -7 - k * 11], [0, -48 - k * 5], [23 - k * 3, -7 - k * 11]], colors[k], '#304b2d');
      } else {
        ellipse(c, -13, -30, 17, 17, colors[0]); ellipse(c, 13, -33, 18, 18, colors[1]); ellipse(c, -1, -47, 21, 18, colors[2]); ellipse(c, -9, -53, 11, 9, colors[3]);
        ellipse(c, 10, -42, 8, 7, '#8ba45133');
      }
    } else if (type === 'food' && source === 'animal') {
      const fur = variant === 1 ? '#98734c' : '#ae875c';
      if (hunted) {
        ellipse(c, 0, -2, 19, 6, fur, '#604d35');
        ellipse(c, 15, -3, 5, 4, '#b49a70', '#604d35');
        line(c, -10, 1, -17, 6, '#5b4935', 2); line(c, 8, 2, 15, 7, '#5b4935', 2);
        c.fillStyle = '#d8c9a0'; c.fillRect(-9, -5, 3, 2); c.fillRect(-1, -5, 3, 2);
      } else {
        for (const x of [-10, 9]) { line(c, x, -5, x - 3, 9, '#624d35', 2.5); line(c, x + 3, -5, x + 5, 8, '#90724e', 2); }
        ellipse(c, 0, -10, 18, 8, fur, '#715638'); ellipse(c, 11, -17, 5, 10, fur);
        ellipse(c, 15, -26, 6, 4, '#b49468', '#715638');
        poly(c, [[12, -28], [10, -35], [15, -30]], '#a7835b'); poly(c, [[17, -28], [22, -33], [20, -26]], '#a7835b');
        ellipse(c, 18, -27, 1, 1, '#272e22'); line(c, -16, -11, -22, -15, '#e7d8b5', 3);
        if (variant !== 2) { line(c, 12, -29, 9, -39, '#d0bd89', 1.5); line(c, 9, -36, 5, -39, '#d0bd89', 1.2); line(c, 17, -29, 20, -39, '#d0bd89', 1.5); line(c, 19, -36, 23, -39, '#d0bd89', 1.2); }
        for (const [xx, yy] of [[-8, -14], [-1, -11], [4, -15]]) ellipse(c, xx, yy, 1.5, 1, '#decea7');
      }
    } else if (type === 'food') {
      for (const [x, y, r] of [[-14, -5, 12], [12, -9, 13], [0, -16, 15]]) ellipse(c, x, y, r, r * .75, '#55753b', '#354c2e');
      for (let k = 0; k < 8; k++) ellipse(c, -19 + noise(k + variant, 3) * 38, -23 + noise(k, 2 + variant) * 21, 2.5, 2.5, '#c55445', '#713a2d');
    } else if (type === 'oil') {
      ellipse(c, 1, 1, 26, 13, '#84744b66');
      const sheen = c.createLinearGradient(-16, -10, 19, 10); sheen.addColorStop(0, '#3c4e46'); sheen.addColorStop(.4, '#1f2f29'); sheen.addColorStop(1, '#162520');
      poly(c, [[-23,-3],[-17,-9],[-7,-8],[1,-12],[10,-8],[22,-6],[24,1],[17,7],[8,6],[0,10],[-12,7],[-20,8],[-26,2]], sheen, '#655d4270');
      c.lineWidth = .7; ellipse(c, -6, -3, 12, 3, null, '#94a8934d');
      line(c, -12, -5, 1, -6, '#ccc39466', .8); line(c, 2, 5, 16, 3, '#788d7d66', .7);
      for (let k = 0; k < 5; k++) { const a = k * TAU / 5, xx = Math.cos(a) * 25, yy = Math.sin(a) * 12; ellipse(c, xx, yy, 2.5, 1.7, '#9c977c', '#635e44'); line(c, xx - 1, yy - 1, xx + 1, yy - 1, '#ccc5a4', .7); }
    } else {
      const base = type === 'gold' ? '#b8a253' : type === 'iron' ? '#77838a' : '#9caa98', light = type === 'gold' ? '#e2cd72' : type === 'iron' ? '#b1b5ae' : '#c5cbb6';
      for (let k = 0; k < 4; k++) {
        const x = -25 + k * 14, y = k % 2 * 6, h = 14 + noise(k, variant) * 10;
        poly(c, [[x, y], [x + 4, y - h], [x + 16, y - h - 4], [x + 26, y - 3], [x + 22, y + 7]], base, '#51594a');
        poly(c, [[x + 4, y - h], [x + 16, y - h - 4], [x + 12, y - 3]], light);
        if (type === 'gold') line(c, x + 15, y - h + 2, x + 20, y - 3, '#f5df8755', 2);
      }
    }
    this.sprites.set(key, img); return img;
  }

  drawResource(c, e, x, y) {
    const variant = hash(e.id) % 3, type = e.resource || e.type;
    const index = type === 'wood' ? variant : type === 'food' ? e.source === 'animal' ? 7 : 3 : ({ stone: 4, gold: 5, iron: 6 }[type]);
    const atlas = this.atlases.get('resources')?.[index];
    if (atlas && !e.hunted) {
      const width = type === 'wood' ? 72 + variant * 6 : e.source === 'animal' ? 43 : type === 'food' ? 48 : 52;
      const height = width * atlas.image.height / atlas.image.width;
      c.drawImage(atlas.image, x - width * atlas.anchorX, y - height * atlas.anchorY, width, height);
      return;
    }
    const sprite = this.resourceSprite(e.resource || e.type, hash(e.id) % 3, e.source, !!e.hunted), scale = (e.size || 16) / 20;
    c.drawImage(sprite, x - 44 * scale, y - 68 * scale, 88 * scale, 100 * scale);
  }

  drawUnit(c, e, x, y, timestamp) {
    const d = UNITS[e.type] || {}, category = d.category || e.category || 'infantry';
    if (this.camera.zoom < .42) {
      c.fillStyle = e.owner === 1 ? '#6eabb8' : '#c64b35'; c.fillRect(x - 2.5, y - 2.5, 5, 5); return;
    }
    const prior = this.previous.get(e.id), moving = prior && Math.hypot(e.x - prior.x, e.y - prior.y) > .4;
    const attackAge = this.renderTime - (e.attackTime ?? -100), attacking = attackAge >= 0 && attackAge < .4;
    const walkFrame = moving ? Math.floor((timestamp * .012 + hash(e.id) % 10) / (TAU / 4)) % 4 : -1;
    const attackFrame = attacking ? Math.min(3, Math.floor(attackAge * 10)) : -1;
    const facing = Number.isFinite(e.facing) ? e.facing : moving ? Math.atan2(e.y - prior.y, e.x - prior.x) : 0;
    const direction = projectWorld(Math.cos(facing), Math.sin(facing));
    const angle = Math.atan2(direction.y, direction.x);
    const face = (Math.round(angle / (TAU / 8)) + 8) % 8;
    const carry = e.carry?.amount > 0 ? e.carry.resource : '';
    const key = `${e.type}:${e.owner}:${d.age ?? 0}:${face}:${walkFrame}:${attackFrame}:${carry}:${this.dpr}`;
    let sprite = this.unitSprites.get(key);
    if (!sprite) {
      // Tight device-pixel bounds keep both blending cost and long-match cache
      // memory low. Even the artillery barrel and cavalry plume fit this box.
      sprite = surface(Math.round(64 * this.dpr), Math.round(64 * this.dpr));
      const sc = sprite.getContext('2d'); sc.scale(this.dpr, this.dpr);
      const row = category === 'worker' ? 0 : category === 'cavalry' ? 3 : category === 'infantry' && d.age < 3 ? 1 : category === 'ranged' && d.age < 2 ? 2 : -1;
      const atlas = row >= 0 ? this.atlases.get('units')?.[row * 8 + face] : null;
      const animation = {
        moving: walkFrame >= 0, phase: walkFrame * TAU / 4,
        sinceAttack: attackFrame >= 0 ? (attackFrame + .5) * .1 : 100,
        facing: face * TAU / 8
      };
      if (atlas) this.atlasUnitArt(sc, e, atlas, 32, 44, animation);
      else this.detailedUnitArt(sc, e, 32, 44, animation);
      this.unitSprites.set(key, sprite);
    }
    c.drawImage(sprite, x - 32, y - 44, 64, 64);
  }

  atlasUnitArt(c, e, atlas, x, y, animation) {
    const d = UNITS[e.type] || {}, cavalry = d.category === 'cavalry', h = cavalry ? 43 : d.category === 'worker' ? 31 : 35;
    const w = h * atlas.image.width / atlas.image.height, bob = animation.moving ? Math.sin(animation.phase) * .55 : 0;
    ellipse(c, x + 2, y + 1, cavalry ? 11 : 6.5, 3, '#17231c38');
    // The generated source is a directional standing sheet. Cached gait adds
    // weight transfer, boot motion and body bob; it is not a claimed walk atlas.
    if (animation.moving && !cavalry) {
      line(c, x - 2, y - 3, x - 2 - Math.sin(animation.phase) * 2, y + .5, '#665947', 1.6);
      line(c, x + 2, y - 3, x + 2 + Math.sin(animation.phase) * 2, y + .5, '#665947', 1.6);
    }
    c.drawImage(e.owner === 1 && atlas.enemyImage ? atlas.enemyImage : atlas.image, x - w * .5, y - h * atlas.anchorY + bob, w, h);
    const dir = { x: Math.cos(animation.facing), y: Math.sin(animation.facing) };
    const swing = animation.sinceAttack < .4 ? Math.sin(animation.sinceAttack / .4 * Math.PI) : 0;
    if (swing > 0 && d.category !== 'worker') {
      const ox = x + dir.x * 6, oy = y - (cavalry ? 20 : 16) + dir.y * 5;
      line(c, ox, oy, ox + dir.x * (8 + swing * 8), oy + dir.y * (8 + swing * 8), d.category === 'ranged' ? '#a08754' : '#d7dac9', 1.5);
    }
    if (e.carry?.amount > 0) ellipse(c, x - 5, y - 13 + bob, 3, 4, e.carry.resource === 'gold' ? '#c3aa58' : e.carry.resource === 'wood' ? '#89633c' : '#ad9262', '#564a35');
    if (e.type === 'dragoon') line(c, x + 2, y - 22, x + dir.x * 18, y - 22 + dir.y * 8, '#575c50', 1.8);
  }

  detailedUnitArt(c, e, x, y, animation) {
    const d = UNITS[e.type] || {}, category = d.category || 'infantry', age = d.age || 0;
    const color = e.owner === 1 ? '#477f96' : '#a93e2a', trim = '#d4bc7b';
    const dir = { x: Math.cos(animation.facing), y: Math.sin(animation.facing) };
    const side = dir.x >= 0 ? 1 : -1, stride = animation.moving ? Math.sin(animation.phase) * 2 : 0;
    const swing = animation.sinceAttack < .4 ? Math.sin(animation.sinceAttack / .4 * Math.PI) : 0;
    c.save(); c.translate(x, y); c.lineCap = 'round'; c.lineJoin = 'round';
    ellipse(c, 2, 1, category === 'siege' ? 16 : 7, category === 'siege' ? 5 : 3, '#17251d40');
    if (category === 'siege') {
      const forward = { x: dir.x * 16, y: dir.y * 8 }, lateral = { x: -dir.y * 9, y: dir.x * 5 };
      const deck = [[forward.x + lateral.x, forward.y + lateral.y], [forward.x - lateral.x, forward.y - lateral.y], [-forward.x - lateral.x, -forward.y - lateral.y], [-forward.x + lateral.x, -forward.y + lateral.y]];
      const elevated = deck.map(([xx, yy]) => [xx, yy - 7]);
      poly(c, [deck[0], deck[1], elevated[1], elevated[0]], '#615841', '#514b38');
      poly(c, [deck[0], deck[3], elevated[3], elevated[0]], '#797055', '#514b38');
      poly(c, elevated, age >= 3 ? '#89917b' : '#ab8b57', '#504e3c');
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        const wx = forward.x * a * .65 + lateral.x * b, wy = forward.y * a * .65 + lateral.y * b + 1;
        ellipse(c, wx, wy, 3.5, 4.5, '#514b36', '#baa278'); ellipse(c, wx, wy, 1.5, 2, '#b7a179');
      }
      if (e.type === 'tank') {
        for (const sign of [-1, 1]) { const a = deck[sign < 0 ? 1 : 0], b = deck[sign < 0 ? 2 : 3]; line(c, a[0], a[1], b[0], b[1], '#39493c', 5); }
        ellipse(c, 0, -12, 8, 5, '#899981', '#445643');
        line(c, dir.x * 3, -12 + dir.y * 2, dir.x * (21 - swing * 2), -12 + dir.y * 11, '#4a5749', 3.5);
        line(c, -4, -15, 4, -15, '#bdc1a6', .7);
      } else if (e.type === 'cannon') {
        const metal = c.createLinearGradient(-5, -13, 6, -5); metal.addColorStop(0, '#d1b06c'); metal.addColorStop(.45, '#a48a54'); metal.addColorStop(1, '#6d6949');
        line(c, -dir.x * 7, -9 - dir.y * 4, dir.x * (20 - swing * 3), -9 + dir.y * 10, metal, 5);
        ellipse(c, dir.x * (20 - swing * 3), -9 + dir.y * 10, 2, 2, '#384736', '#b29b67');
        line(c, -4, -13, 2, -12, '#d2b972', 1);
      } else if (e.type === 'ram') {
        const roof = elevated.map(([xx, yy]) => [xx, yy - (Math.abs(xx) < 6 ? 8 : 4)]);
        poly(c, roof, '#bd9c69', '#655338');
        line(c, -dir.x * 12, -9 - dir.y * 6, dir.x * (22 + swing * 2), -9 + dir.y * 11, '#7a5734', 4);
        ellipse(c, dir.x * (22 + swing * 2), -9 + dir.y * 11, 3, 3, '#929e89', '#53614c');
      } else {
        for (const sign of [-1, 1]) line(c, lateral.x * sign, lateral.y * sign - 3, 0, -21, '#8e6a3e', 2.5);
        line(c, -dir.x * 10, -8 - dir.y * 5, dir.x * (10 - swing * 16), -18 + dir.y * 5 - swing * 7, '#c1a16e', 3);
        ellipse(c, dir.x * (10 - swing * 16), -18 + dir.y * 5 - swing * 7, 4, 3, '#8f9682', '#565f4b');
      }
      c.fillStyle = color; c.fillRect(-4, -9, 6, 3); c.restore(); return;
    }
    const worker = category === 'worker', spear = category === 'spear';
    const firearm = age >= 2 && (category === 'ranged' || category === 'infantry');
    // Upright human proportions: long legs, a narrow torso, small head and
    // individually shaded gear. Only weapon aim and gait follow screen heading.
    line(c, -2.4, -10, -3 - stride * .5, -5, '#615d49', 2.4); line(c, -3 - stride * .5, -5, -3 - stride, -.5, '#504b39', 2.1);
    line(c, 2.4, -10, 3 + stride * .5, -5, '#8a8164', 2.4); line(c, 3 + stride * .5, -5, 3 + stride, -.5, '#5b513c', 2.1);
    ellipse(c, -3 - stride, 0, 2.2, 1, '#403d2f'); ellipse(c, 3 + stride, 0, 2.2, 1, '#403d2f');
    poly(c, [[-4,-22],[3,-22],[4.3,-10],[-4.3,-10]], worker ? '#b7a16e' : color, '#594f38');
    if (!worker && age < 3) {
      poly(c, [[-3,-21],[3,-21],[3.5,-13],[-3.5,-13]], '#b5ba9e', '#69735e');
      for (let i = -2; i <= 2; i += 2) line(c, i, -20, i, -14, '#d5d1ae', .6);
    }
    line(c, -4, -12, 4, -12, '#66513a', 1.4); ellipse(c, 0, -12, 1, 1, trim);
    ellipse(c, dir.x * .8, -26, 2.7, 3.1, '#c69f70', '#7d6849');
    if (age >= 3) { poly(c, [[-3.4,-27],[-2.8,-31],[2.8,-31],[3.6,-27]], '#4c6254', '#b8b18b'); line(c, -3, -27, 4, -27, '#747b5b', .8); }
    else if (worker) { ellipse(c, 0, -28.5, 4.7, 1.3, '#ccbb83', '#8e8056'); }
    else { ellipse(c, 0, -28, 3.6, 2.5, '#adb6a0', '#616f58'); line(c, -2, -29, 2, -29.5, '#e1d7b0', .8); line(c, 0, -31, side * 1.5, -34, color, 2); }
    if (dir.y >= 0) { ellipse(c, dir.x * 1.5, -25.7, .6, .6, '#4b4d37'); line(c, 0, -23, 1.5, -23, '#82613e', .6); }
    const handX = side * 5, handY = -17 - swing * 1.5;
    line(c, -4, -21, -5.5, -16, worker ? '#c49c69' : color, 2); line(c, 4, -21, handX, handY, worker ? '#c49c69' : color, 2);
    ellipse(c, handX, handY, 1.4, 1.4, '#d4ae79');
    if (spear) {
      ellipse(c, -side * 5.5, -16, 3.2, 5, color, trim); line(c, -side * 6, -19, -side * 5, -13, trim, .6);
      const tx = handX + dir.x * (20 + swing * 4), ty = handY + dir.y * 11 - 7;
      line(c, handX - dir.x * 8, handY - dir.y * 5 + 2, tx, ty, '#a1834e', 1.3);
      poly(c, [[tx - dir.y * 1.7, ty + dir.x * 1.7],[tx + dir.x * 4,ty + dir.y * 2],[tx + dir.y * 1.7,ty - dir.x * 1.7]], '#d4d6b9', '#7d866b');
    } else if (firearm) {
      const tx = handX + dir.x * (15 - swing * 1.5), ty = handY + dir.y * 9;
      line(c, handX - dir.x * 4, handY - dir.y * 2, tx, ty, '#565f4c', 2);
      line(c, handX - dir.x * 4, handY - dir.y * 2, handX + dir.x * 5, handY + dir.y * 3, '#967249', 2.6);
      line(c, handX + dir.x * 6, handY + dir.y * 3 - .7, tx, ty - .7, '#bfc4a6', .7);
      if (animation.sinceAttack < .1) { ellipse(c, tx, ty, 3, 2, '#e9c378'); }
    } else if (worker) {
      line(c, handX, handY + 7, handX + dir.x * 10, handY - 7, '#916c40', 1.5);
      line(c, handX + dir.x * 10 - 3, handY - 7, handX + dir.x * 10 + 4, handY - 7, '#b7bd9f', 2);
    } else { ellipse(c, -side * 5, -17, 3.5, 5.5, color, trim); line(c, handX, handY, handX + dir.x * (10 + swing * 5), handY + dir.y * 8 - 3, '#d8d8ba', 1.5); }
    if (e.carry?.amount > 0) ellipse(c, -5, -16, 3.5, 4.5, '#a99161', '#645138');
    c.restore();
  }

  unitArt(c, e, x, y, timestamp, animation) {
    const d = UNITS[e.type] || {}, category = d.category || e.category || 'infantry', age = d.age ?? this.state.players?.find(p => p.id === e.owner)?.age ?? 0;
    const faction = e.owner === 1 ? '#6eabb8' : '#c64b35', trim = e.owner === 1 ? '#b8d9dd' : '#e6c17b';
    if (this.camera.zoom < .42) { ellipse(c, x, y, 3.4, 3.4, faction, '#f2dcac'); return; }
    const p = this.previous.get(e.id), moving = animation?.moving ?? (p && Math.hypot(e.x - p.x, e.y - p.y) > .4);
    const phase = animation?.phase ?? (timestamp * .012 + hash(e.id) % 10), stride = moving ? Math.sin(phase) * 2.8 : 0;
    const sinceAttack = animation?.sinceAttack ?? ((this.renderTime || 0) - (e.attackTime ?? -100));
    const attack = sinceAttack >= 0 && sinceAttack < .4;
    const swing = attack ? Math.sin(sinceAttack / .4 * Math.PI) : 0;
    const facing = animation?.facing ?? (Number.isFinite(e.facing) ? e.facing : moving ? Math.atan2(e.y - p.y, e.x - p.x) : 0);
    const s = clamp((e.size || 8) / 8, .8, 1.5);
    c.save(); c.translate(x, y); c.scale(s, s); c.lineCap = 'round';
    ellipse(c, 2, 3, category === 'cavalry' || category === 'siege' ? 11 : 7, 4, '#1b281a66');
    if (/siege|artillery|mechanized/.test(category) || /ram|catapult|cannon|ballista/.test(e.type)) {
      c.save(); c.rotate(facing);
      const industrial = age >= 3;
      c.fillStyle = industrial ? '#65716a' : '#997442'; c.fillRect(-10, -6, 20, 12);
      for (const xx of [-7, 7]) { ellipse(c, xx, -7, 4, 2.5, '#443e32', '#b7a278'); ellipse(c, xx, 7, 4, 2.5, '#443e32', '#b7a278'); }
      if (industrial) {
        if (e.type === 'tank') { c.fillStyle = '#36473f'; c.fillRect(-12, -8, 24, 3); c.fillRect(-12, 5, 24, 3); }
        line(c, 0, 0, 18 - swing * 3, 0, '#444f4b', 5); ellipse(c, -3, 0, 7, 6, '#8c9890', '#48534c');
      } else if (e.type === 'ram') {
        poly(c, [[-13, -4], [-8, -10], [9, -10], [13, -4], [13, 5], [-13, 5]], '#b49763', '#6a5539'); line(c, -11, -3, 17 + swing * 3, -3, '#795634', 4); ellipse(c, 18 + swing * 3, -3, 3, 4, '#9ea392', '#4d5247');
      } else {
        poly(c, [[-8, -7], [-2, 0], [-8, 7]], '#9d774b', '#d4b57a'); line(c, -5, 0, 9 - swing * 12, -8 - swing * 4, '#cfb57e', 3); ellipse(c, 9 - swing * 12, -8 - swing * 4, 4, 4, '#626c5d', '#b6b59b');
      }
      c.fillStyle = faction; c.fillRect(-9, -3, 5, 6); c.restore(); c.restore(); return;
    }
    const mounted = /cavalry|scout/.test(category) || /scout|rider|knight|dragoon/.test(e.type);
    if (mounted) {
      const dir = Math.cos(facing) >= 0 ? 1 : -1;
      ellipse(c, 0, 0, 10, 5, age > 1 ? '#655646' : '#916b43', '#4c4032');
      line(c, -6, 1, -6 - stride, 8, '#594534', 2.5); line(c, 5, 1, 5 + stride, 8, '#594534', 2.5);
      poly(c, [[dir * 6, -2], [dir * 8, -10], [dir * 13, -12], [dir * 15, -7], [dir * 10, 1]], '#94734d', '#4f4030');
      line(c, -dir * 8, -1, -dir * 14, 4 + stride, '#544333', 2);
      c.fillStyle = faction; c.fillRect(-5, -5, 10, 6); c.translate(0, -6);
    }
    const worker = category === 'worker' || /worker|citizen/.test(e.type);
    const ranged = /ranged|archer|gunner/.test(category) || /archer|crossbow|rifle|musk|dragoon/.test(e.type);
    const spear = category === 'spear' || /spear|pike|lancer|halberd/.test(e.type);
    line(c, -2, -1, -3 - stride, 5, '#4b4435', 2.5); line(c, 2, -1, 3 + stride, 5, '#4b4435', 2.5);
    poly(c, [[-5, -10], [4, -10], [5, -1], [-4, -1]], worker ? '#d5bc85' : age > 0 && !ranged ? '#a3aaa0' : faction, '#4c4b3c');
    if (!worker) { c.fillStyle = faction; c.fillRect(-3, -7, 5, 7); }
    ellipse(c, 0, -13, 3.5, 4, '#d7ac79', '#695940');
    if (worker) { ellipse(c, 0, -16, 5, 2, '#dac488', '#9b855a'); }
    else if (age >= 3) { poly(c, [[-4, -15], [-3, -19], [4, -19], [5, -15]], '#535f58', '#c2b88f'); }
    else { ellipse(c, 0, -15, 4.3, 3.2, age >= 1 ? '#c1c9bf' : '#bda668', '#655f48'); if (!ranged) { line(c, -1, -18, 2, -22, faction, 2.3); } }
    const handY = -7 - swing * 3;
    line(c, -4, -8, -7, -5, '#d3ae7e', 2.2); line(c, 4, -8, 7, handY, '#d3ae7e', 2.2);
    if (worker) {
      line(c, 6, handY + 5, 9 + swing * 5, handY - 8, '#785a36', 2); line(c, 5 + swing * 5, handY - 7, 13 + swing * 5, handY - 7, '#b5baab', 2.5);
      if (e.carry?.amount > 0) { ellipse(c, -7, -8, 4, 5, e.carry.resource === 'gold' ? '#d1b355' : e.carry.resource === 'wood' ? '#8a6841' : '#b59b64', '#6c5d40'); }
    } else if (ranged) {
      if (age >= 2) { line(c, 6, handY + 4, 13 + swing * 4, handY - 10, '#4f554d', 2.5); if (attack && sinceAttack < .15) ellipse(c, 13 + swing * 4, handY - 12, 2.5, 2.5, '#f3cb69'); }
      else if (e.type === 'crossbow') { line(c, 6, handY + 4, 10, handY - 9, '#967441', 2.5); line(c, 3, handY - 5, 14, handY - 3, '#ceb778', 1.5); }
      else { c.beginPath(); c.arc(7, handY, 7, -1.3, 1.3); c.strokeStyle = '#d3b775'; c.lineWidth = 1.5; c.stroke(); line(c, 9, handY - 7, 9, handY + 7, '#ede0ac', .7); }
    } else {
      ellipse(c, -7, -5, 4, 6, faction, trim); line(c, -9, -6, -5, -6, trim, 1);
      if (spear) { line(c, 7, 5, 9 + swing * 3, -25, '#9d7844', 1.6); poly(c, [[7 + swing * 3, -24], [10 + swing * 3, -31], [12 + swing * 3, -24]], '#dad9bd'); }
      else { line(c, 6, handY + 3, 13 + swing * 6, handY - 10, '#d2d5c1', 2); line(c, 5, handY, 9, handY + 2, trim, 2); }
    }
    c.restore();
  }

  drawBars(c, e, x, y) {
    const z = this.camera.zoom, building = e.kind === 'building', w = building ? Math.max(34, e.size * 1.5) : 23, h = 4 / z;
    const a = building ? this.buildingAtlasCell(e.type) : null;
    const yy = y - (a ? Math.max(76, e.size * 3.75) * a.image.height / a.image.width * a.anchorY + 7 : building ? e.size * 1.4 : 37);
    c.fillStyle = '#17231cdb'; c.fillRect(x - w / 2 - 1, yy - 1, w + 2, h + 2);
    const hp = clamp(e.hp / e.maxHp, 0, 1); c.fillStyle = hp > .55 ? '#8fb85b' : hp > .25 ? '#d9b965' : '#d46144'; c.fillRect(x - w / 2, yy, w * hp, h);
    if (building && e.progress < 1) { c.fillStyle = '#1c2820'; c.fillRect(x - w / 2, yy + h + 2, w, h); c.fillStyle = '#d3b568'; c.fillRect(x - w / 2, yy + h + 2, w * e.progress, h); }
    else if (building && e.queue?.length) { c.fillStyle = '#222b28'; c.fillRect(x - w / 2, yy + h + 2, w, 2 / z); c.fillStyle = '#90c1c6'; c.fillRect(x - w / 2, yy + h + 2, w * clamp(e.queue[0].progress || 0, 0, 1), 2 / z); }
  }

  drawRally(c, e, x, y) {
    const r = projectWorld(e.rally.x, e.rally.y);
    c.save(); c.setLineDash([5 / this.camera.zoom, 5 / this.camera.zoom]); line(c, x, y + 8, r.x, r.y, '#e7ce8288', 1 / this.camera.zoom); c.setLineDash([]);
    line(c, r.x, r.y + 4, r.x, r.y - 20, '#efdfb1', 1.4 / this.camera.zoom);
    poly(c, [[r.x, r.y - 20], [r.x + 12, r.y - 16], [r.x, r.y - 11]], '#dba943', '#f4d982'); ellipse(c, r.x, r.y + 3, 7, 3, null, '#e7ce82'); c.restore();
  }

  drawPlacement(c) {
    const world = this.placement, p = { ...world, ...projectWorld(world.x, world.y) }, d = BUILDINGS[p.type] || {}, r = d.size || 30;
    c.save(); c.globalAlpha = .55;
    const a = this.buildingAtlasCell(p.type);
    if (a) { const w = Math.max(76, r * 3.75), h = w * a.image.height / a.image.width; c.drawImage(a.image, p.x - w * a.anchorX, p.y - h * a.anchorY, w, h); }
    else c.drawImage(this.buildingSprite(p.type, 0, this.state.players?.[0]?.age || 0), p.x - r * 64 / 43, p.y - r * (130 / 1.5) / 43, r * 128 / 43, r * 140 / 43);
    c.globalAlpha = 1; c.fillStyle = p.valid ? '#b5d27626' : '#df715d40'; c.strokeStyle = p.valid ? '#cee792' : '#ff9079'; c.lineWidth = 2 / this.camera.zoom;
    // Simulation placement uses a world-space collision radius. Its projected
    // footprint is an ellipse, while the outline diamond conveys world axes.
    ellipse(c, p.x, p.y, r * Math.SQRT2, r / Math.SQRT2, c.fillStyle, c.strokeStyle);
    this.groundDiamond(c, p.x, p.y, r, null, p.valid ? '#cee79280' : '#ff907980');
    c.restore();
  }

  drawProjectiles(c) {
    for (const p of this.state.projectiles || []) {
      const prior = this.previousProjectiles.get(p.id);
      const x = prior ? prior.x + (p.x - prior.x) * this.renderAlpha : p.x ?? p.fromX;
      const y = prior ? prior.y + (p.y - prior.y) * this.renderAlpha : p.y ?? p.fromY;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !this.isVisible(x, y)) continue;
      const dx = (p.tx ?? p.targetX ?? x) - (p.sx ?? p.startX ?? p.fromX ?? x), dy = (p.ty ?? p.targetY ?? y) - (p.sy ?? p.startY ?? p.fromY ?? y);
      const direction = projectWorld(dx, dy), a = Math.atan2(direction.y, direction.x), projected = projectWorld(x, y);
      const heavy = /stone|cannon|shell|artillery/.test(p.type || '');
      const arc = Math.sin(clamp(1 - (p.remaining || 0) / (p.duration || 1), 0, 1) * Math.PI) * (heavy ? 23 : 9);
      c.save(); c.translate(projected.x, projected.y - arc); c.rotate(a);
      if (heavy) { line(c, -10, 0, -1, 0, '#dac89888', 2); ellipse(c, 0, 0, 3.4, 3.4, '#343d37', '#d0b57e'); }
      else { line(c, -10, 0, 2, 0, '#ead6a4', 1.3); poly(c, [[3, 0], [-1, -2], [-1, 2]], '#f4e6bc'); line(c, -8, 0, -11, -2, '#806b46'); }
      c.restore();
    }
  }

  drawEffects(c) {
    for (const effect of this.state.effects || []) {
      if (!Number.isFinite(effect.x) || !Number.isFinite(effect.y) || !this.isVisible(effect.x, effect.y)) continue;
      const e = { ...effect, ...projectWorld(effect.x, effect.y) };
      const duration = e.duration || e.maxTtl || 1;
      const remaining = (e.ttl ?? e.life ?? e.time ?? duration) + this.state.time - this.renderTime;
      const t = clamp(1 - remaining / duration, 0, 1);
      const large = /destroy|explosion|death|collapse/.test(e.type || ''), r = (e.size || e.radius || (large ? 24 : 8)) * (.4 + t);
      c.save(); c.globalAlpha = 1 - t;
      if (large) {
        ellipse(c, e.x, e.y, r, r * .5, '#d1b17833', '#d4bc8555');
        for (let k = 0; k < 7; k++) {
          const a = k * TAU / 7 + hash(e.id || e.type) % 7, d = r * (.4 + t), xx = e.x + Math.cos(a) * d, yy = e.y + Math.sin(a) * d * .6;
          ellipse(c, xx, yy - t * 13, 3 + t * 6, 3 + t * 4, k % 2 ? '#b1a58b88' : '#dec28c99');
          if (t < .5) poly(c, [[xx - 2, yy], [xx, yy - 5], [xx + 4, yy + 2]], '#796c4d');
        }
      } else {
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + t; line(c, e.x + Math.cos(a) * r * .35, e.y + Math.sin(a) * r * .35, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, '#efce79', 1.5); }
      }
      c.restore();
    }
  }

  drawMinimap(selected) {
    if (!this.mctx || !this.state) return;
    const c = this.mctx, m = this.state.map, side = Math.min(this.mw, this.mh), ox = (this.mw - side) / 2, oy = (this.mh - side) / 2, scale = side / m.size;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#101819'; c.fillRect(0, 0, this.mw, this.mh);
    c.imageSmoothingEnabled = false; c.drawImage(this.mapCanvas, ox, oy, side, side);
    for (const e of this.state.entities) {
      if (e.alive === false || e.owner === 1 && !this.isVisible(e.x, e.y) || e.kind === 'resource' && !this.isExplored(e.x, e.y)) continue;
      const x = ox + e.x * scale, y = oy + e.y * scale;
      c.fillStyle = e.kind === 'resource' ? ({ wood: '#2c512f', gold: '#dcc269', food: '#b8bd73', stone: '#c9c8af', iron: '#bbc2be', oil: '#273739' }[e.resource || e.type] || '#a6b180') : selected.has(e.id) ? '#fff2b7' : e.owner === 0 ? '#f0aa70' : '#7dc1d0';
      const r = e.kind === 'building' ? Math.max(2.5, (e.size || 20) * scale) : e.kind === 'resource' ? 1.5 : 1.4;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const e of this.knownBuildings.values()) if (!this.isVisible(e.x, e.y)) { c.fillStyle = '#6d8f99'; const r = Math.max(2, e.size * scale); c.fillRect(ox + e.x * scale - r, oy + e.y * scale - r, r * 2, r * 2); }
    if (this.hasFog) c.drawImage(this.fogCanvas, ox, oy, side, side); c.imageSmoothingEnabled = true;
    c.strokeStyle = '#f5e3a6'; c.lineWidth = 1.25;
    const corners = this.viewportWorldCorners().map(p => [ox + p.x * scale, oy + p.y * scale]);
    c.save(); c.beginPath(); c.rect(ox, oy, side, side); c.clip(); poly(c, corners, null, '#f5e3a6'); c.restore();
    c.strokeStyle = '#9d8c58'; c.lineWidth = 1; c.strokeRect(ox + .5, oy + .5, side - 1, side - 1);
  }
}
