(() => {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  class NewWorldMapRenderer {
    constructor({ canvas, viewport, manifestUrl = './assets/sprite-manifest.json' }) {
      this.canvas = canvas;
      this.viewport = viewport;
      this.ctx = canvas?.getContext('2d', { alpha: true });
      this.manifestUrl = manifestUrl;
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.regionIndex = 0;
      this.regionName = 'Beleland';
      this.ready = false;
      this.active = false;
      this.loading = false;
      this.failed = false;
      this.pages = [];
      this.sprites = [];
      this.pools = { residential: [], commercial: [], utility: [], village: [] };
      this.layout = [];
      this.lastWidth = 0;
      this.lastHeight = 0;
      this.dpr = 1;
      this.resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.render())
        : null;

      if (this.resizeObserver && this.viewport) this.resizeObserver.observe(this.viewport);
      window.addEventListener('resize', () => this.render(), { passive: true });
    }

    async loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not load sprite atlas page: ' + url));
        image.src = url;
      });
    }

    async loadAtlas() {
      if (this.ready || this.loading || this.failed) return;
      this.loading = true;
      try {
        const response = await fetch(this.manifestUrl, { cache: 'force-cache' });
        if (!response.ok) throw new Error('Sprite manifest returned HTTP ' + response.status);
        const manifest = await response.json();
        if (!Array.isArray(manifest.pages) || !manifest.pages.length ||
            !manifest.sprites || typeof manifest.sprites !== 'object') {
          throw new Error('Sprite manifest has an invalid structure.');
        }

        const baseUrl = new URL(this.manifestUrl, document.baseURI);
        const pages = await Promise.all(manifest.pages.map(path =>
          this.loadImage(new URL(path, baseUrl).href)));
        const sprites = Object.values(manifest.sprites)
          .filter(sprite => Number.isInteger(sprite.page) && pages[sprite.page] &&
            Number.isFinite(sprite.x) && Number.isFinite(sprite.y) &&
            Number.isFinite(sprite.width) && Number.isFinite(sprite.height))
          .sort((a, b) => String(a.key).localeCompare(String(b.key)));

        if (!sprites.length) throw new Error('The sprite atlas contains no usable sprites.');
        this.pages = pages;
        this.sprites = sprites;
        this.pools.residential = sprites.filter(sprite =>
          sprite.category === 'houses' || sprite.category === 'village');
        this.pools.village = sprites.filter(sprite => sprite.category === 'village');
        this.pools.commercial = sprites.filter(sprite =>
          sprite.category === 'stores' || sprite.category === 'restaurants');
        this.pools.utility = sprites.filter(sprite => sprite.category === 'watertower');
        this.ready = true;
        this.buildLayout();
        this.setCamera(this.zoom, this.pan);
        this.canvas.dataset.atlas = 'ready';
      } catch (error) {
        this.ready = false;
        this.failed = true;
        this.canvas.dataset.atlas = 'unavailable';
        console.warn('[new-world] City-detail sprites are not available yet:', error.message);
      } finally {
        this.loading = false;
      }
    }

    setRegion(index, name) {
      this.regionIndex = Math.max(0, Number(index) || 0);
      this.regionName = String(name || 'Beleland');
      this.buildLayout();
      this.render();
    }

    setCamera(zoom, pan) {
      this.zoom = Number(zoom) || 1;
      this.pan = { x: Number(pan?.x) || 0, y: Number(pan?.y) || 0 };
      if (this.zoom >= 1.65 && !this.ready && !this.loading && !this.failed) this.loadAtlas();
      this.active = this.ready && this.zoom >= 1.65;
      this.viewport?.classList.toggle('is-city-detail', this.active);

      const label = document.getElementById('map-zoom-level');
      if (label) {
        label.textContent = this.active
          ? (this.zoom >= 3.15 ? 'STREET DETAIL' : 'CITY DETAIL')
          : 'WORLD VIEW';
      }
      const coordinates = document.getElementById('map-coordinates');
      if (coordinates) {
        coordinates.textContent = this.active
          ? this.regionName.toUpperCase() + ' · LOCAL DISTRICT'
          : 'BELELAND · WORLD 001';
      }
      this.render();
    }

    randomGenerator(seed) {
      let value = (Math.imul(seed + 1, 0x45d9f3b) ^ 0x9e3779b9) >>> 0;
      return () => {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        return (value >>> 0) / 4294967296;
      };
    }

    buildLayout() {
      const random = this.randomGenerator(this.regionIndex + 1);
      const size = 28;
      const layout = [];
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const roll = random();
          const avenue = row === 13 || col === 13;
          const road = avenue || row % 7 === 0 || col % 7 === 0;
          const riverColumn = 4 + row * 0.58 + Math.sin(row * 0.31 + this.regionIndex) * 1.8;
          const river = !road && Math.abs(col - riverColumn) < 0.62;
          const park = !road && !river && roll < 0.12;
          let building = null;

          if (!road && !river && !park && roll < 0.34) {
            const district = (Math.floor(col / 7) + Math.floor(row / 7) + this.regionIndex) % 4;
            const pool = district === 2 || district === 3
              ? this.pools.commercial
              : this.pools.residential;
            const chosenPool = district === 3 && random() < 0.22 && this.pools.utility.length
              ? this.pools.utility
              : pool;
            if (chosenPool.length) building = chosenPool[Math.floor(random() * chosenPool.length)];
          }

          layout.push({ row, col, road, river, park, building, variation: random() });
        }
      }
      this.layout = layout;
    }

    polygon(cx, cy, halfW, halfH) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(cx, cy - halfH);
      ctx.lineTo(cx + halfW, cy);
      ctx.lineTo(cx, cy + halfH);
      ctx.lineTo(cx - halfW, cy);
      ctx.closePath();
    }

    drawTree(x, y, scale) {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = 'rgba(19, 36, 28, 0.27)';
      ctx.beginPath();
      ctx.ellipse(x + 2 * scale, y + 5 * scale, 8 * scale, 4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#554c3b';
      ctx.fillRect(x - 1.4 * scale, y - 3 * scale, 2.8 * scale, 10 * scale);
      ctx.fillStyle = '#365d3b';
      ctx.beginPath();
      ctx.arc(x, y - 9 * scale, 7.5 * scale, 0, Math.PI * 2);
      ctx.arc(x - 5 * scale, y - 5 * scale, 5.5 * scale, 0, Math.PI * 2);
      ctx.arc(x + 5 * scale, y - 5 * scale, 5.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#72905b';
      ctx.beginPath();
      ctx.arc(x - 2 * scale, y - 11 * scale, 3.2 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawTile(cell, cx, cy, tileW, tileH, scale) {
      const ctx = this.ctx;
      const halfW = tileW / 2;
      const halfH = tileH / 2;
      const grass = ['#71865d', '#788d63', '#81936a', '#6d8159'];

      this.polygon(cx, cy, halfW, halfH);
      ctx.fillStyle = cell.river ? '#527d83'
        : cell.road ? '#545b55'
          : cell.park ? '#58774f'
            : grass[Math.floor(cell.variation * grass.length)];
      ctx.fill();
      ctx.strokeStyle = cell.river ? 'rgba(176, 207, 194, .22)' : 'rgba(29, 47, 34, .19)';
      ctx.lineWidth = Math.max(0.6, scale * 0.65);
      ctx.stroke();

      if (cell.river) {
        ctx.strokeStyle = 'rgba(189, 215, 202, .38)';
        ctx.lineWidth = Math.max(1, scale * 1.3);
        ctx.beginPath();
        ctx.moveTo(cx - halfW * 0.48, cy - halfH * 0.07);
        ctx.lineTo(cx + halfW * 0.48, cy + halfH * 0.07);
        ctx.stroke();
      } else if (cell.road) {
        const vertical = cell.col % 7 === 0 && cell.row % 7 !== 0;
        ctx.strokeStyle = '#bdb79a';
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = Math.max(0.8, scale * 0.8);
        ctx.setLineDash([3 * scale, 4 * scale]);
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(cx, cy - halfH * 0.68);
          ctx.lineTo(cx, cy + halfH * 0.68);
        } else {
          ctx.moveTo(cx - halfW * 0.68, cy);
          ctx.lineTo(cx + halfW * 0.68, cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else if (cell.park) {
        const treeScale = Math.max(0.65, scale * 0.68);
        this.drawTree(cx - tileW * 0.15, cy + tileH * 0.06, treeScale);
        if (cell.variation > 0.48) this.drawTree(cx + tileW * 0.16, cy - tileH * 0.08, treeScale * 0.78);
      }

      if (cell.building) this.drawBuilding(cell.building, cx, cy, tileW, tileH, scale);
    }

    drawBuilding(sprite, cx, cy, tileW, tileH, scale) {
      const ctx = this.ctx;
      const atlas = this.pages[sprite.page];
      if (!atlas) return;
      const targetWidth = tileW * 1.05;
      const aspect = sprite.height / Math.max(1, sprite.width);
      const drawWidth = targetWidth;
      const drawHeight = Math.min(tileW * 2.15, drawWidth * aspect);
      const baseY = cy + tileH * 0.34;

      ctx.save();
      ctx.fillStyle = 'rgba(16, 29, 26, .25)';
      ctx.beginPath();
      ctx.ellipse(cx + tileW * 0.06, baseY - 1, tileW * 0.45, tileH * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        atlas,
        sprite.x, sprite.y, sprite.width, sprite.height,
        cx - drawWidth / 2, baseY - drawHeight, drawWidth, drawHeight
      );
      ctx.restore();
    }

    render() {
      if (!this.ready || !this.active || !this.ctx || !this.canvas || !this.viewport) return;
      const rect = this.viewport.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (!width || !height) return;

      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      if (width !== this.lastWidth || height !== this.lastHeight ||
          this.canvas.width !== Math.round(width * this.dpr) ||
          this.canvas.height !== Math.round(height * this.dpr)) {
        this.lastWidth = width;
        this.lastHeight = height;
        this.canvas.width = Math.round(width * this.dpr);
        this.canvas.height = Math.round(height * this.dpr);
      }

      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#58747a';
      ctx.fillRect(0, 0, width, height);

      const sceneScale = clamp(0.88 + (this.zoom - 1.65) * 0.42, 0.88, 2.35);
      const tileW = 64 * sceneScale;
      const tileH = tileW / 2;
      const rows = 28;
      const cols = 28;
      const panFactor = this.zoom >= 1.65 ? clamp(0.32 / this.zoom, 0.05, 0.22) : 0;
      const originX = width / 2 + this.pan.x * panFactor;
      const originY = height / 2 - (rows + cols) * tileH / 4 + 18 + this.pan.y * panFactor;
      const cells = new Map(this.layout.map(cell => [cell.row + ':' + cell.col, cell]));

      for (let diagonal = 0; diagonal < rows + cols - 1; diagonal++) {
        const rowStart = Math.max(0, diagonal - (cols - 1));
        const rowEnd = Math.min(rows - 1, diagonal);
        for (let row = rowStart; row <= rowEnd; row++) {
          const col = diagonal - row;
          const cell = cells.get(row + ':' + col);
          if (!cell) continue;
          const cx = originX + (col - row) * tileW / 2;
          const cy = originY + (col + row) * tileH / 2;
          this.drawTile(cell, cx, cy, tileW, tileH, sceneScale);
        }
      }

      ctx.save();
      const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2,
        width / 2, height / 2, Math.max(width, height) * 0.78);
      vignette.addColorStop(0, 'rgba(13, 24, 22, 0)');
      vignette.addColorStop(1, 'rgba(13, 24, 22, .28)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  window.NewWorldMapRenderer = NewWorldMapRenderer;
})();
