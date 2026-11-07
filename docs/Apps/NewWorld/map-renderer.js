(() => {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = value => value * value * (3 - 2 * value);

  class NewWorldMapRenderer {
    constructor({ canvas, viewport, manifestUrl = './assets/sprite-manifest.json', onPlotSelected = null }) {
      this.canvas = canvas;
      this.viewport = viewport;
      this.ctx = canvas?.getContext('2d', { alpha: true });
      this.manifestUrl = manifestUrl;
      this.onPlotSelected = typeof onPlotSelected === 'function' ? onPlotSelected : () => {};
      this.worldSize = 1024;
      this.worldCenter = this.worldSize / 2;
      this.plotSize = 12;
      this.regionIndex = 0;
      this.regionName = 'Beleland';
      this.zoom = 1;
      this.camera = { x: 0, y: 0 };
      this.active = false;
      this.ready = false;
      this.loading = false;
      this.failed = false;
      this.pages = [];
      this.sprites = [];
      this.pools = { residential: [], commercial: [], utility: [], village: [] };
      this.buildingData = new Map();
      this.buildingSprites = new Map();
      this.selectedPlot = null;
      this.hoverPlot = null;
      this.pointer = null;
      this.lastWidth = 0;
      this.lastHeight = 0;
      this.dpr = 1;
      this.resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.render())
        : null;

      if (this.resizeObserver && this.viewport) this.resizeObserver.observe(this.viewport);
      window.addEventListener('resize', () => this.render(), { passive: true });

      if (this.canvas) {
        this.canvas.addEventListener('pointerdown', event => this.handlePointerDown(event));
        this.canvas.addEventListener('pointermove', event => this.handlePointerMove(event));
        this.canvas.addEventListener('pointerup', event => this.handlePointerUp(event));
        this.canvas.addEventListener('pointercancel', () => this.cancelPointer());
        this.canvas.addEventListener('lostpointercapture', () => this.cancelPointer());
      }
    }

    tileWidth() {
      const scale = clamp(0.88 + (this.zoom - 1.65) * 0.15, 0.88, 1.53);
      return 54 * scale;
    }

    tileHeight() {
      return this.tileWidth() / 2;
    }

    hash(row, col, salt = 0) {
      let value = Math.imul(row + 1, 374761393) ^
        Math.imul(col + 1, 668265263) ^
        Math.imul(this.regionIndex + salt + 1, 1442695041);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      value = Math.imul(value ^ (value >>> 16), 2246822519);
      return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
    }

    valueNoise(row, col, scale, salt) {
      const x = row / scale;
      const y = col / scale;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = smooth(x - x0);
      const ty = smooth(y - y0);
      const a = lerp(this.hash(x0, y0, salt), this.hash(x0 + 1, y0, salt), tx);
      const b = lerp(this.hash(x0, y0 + 1, salt), this.hash(x0 + 1, y0 + 1, salt), tx);
      return lerp(a, b, ty);
    }

    terrainAt(row, col) {
      if (!Number.isInteger(row) || !Number.isInteger(col) ||
          row < 0 || col < 0 || row >= this.worldSize || col >= this.worldSize) return null;

      const moisture = this.valueNoise(row, col, 23, 17);
      const elevation = this.valueNoise(row, col, 37, 31);
      const soil = this.valueNoise(row, col, 15, 53);
      const fine = this.hash(row, col, 71);
      const water = elevation < 0.105 && moisture > 0.77;
      const dry = !water && soil > 0.69 && moisture < 0.48;
      const woodland = moisture > 0.69;
      const treeChance = woodland ? 0.17 : 0.006;
      const tree = !water && this.hash(row, col, 83) < treeChance;
      const rock = !water && !tree && this.hash(row, col, 97) < 0.005;

      return {
        type: water ? 'water' : dry ? 'dry' : 'grass',
        variation: fine,
        tree,
        rock,
        treeScale: 0.72 + this.hash(row, col, 89) * 0.54,
        treeTone: this.hash(row, col, 101)
      };
    }

    getPlotCell(index) {
      const plot = Number(index);
      if (!Number.isInteger(plot) || plot < 0) return null;
      if (plot < this.plotSize * this.plotSize) return this.getLegacyPlotCell(plot);
      const worldIndex = plot - this.plotSize * this.plotSize;
      if (worldIndex >= this.worldSize * this.worldSize) return null;
      return {
        row: Math.floor(worldIndex / this.worldSize),
        col: worldIndex % this.worldSize
      };
    }

    getLegacyPlotCell(index) {
      const plot = Number(index);
      if (!Number.isInteger(plot) || plot < 0 || plot >= this.plotSize * this.plotSize) return null;
      const start = this.worldCenter - this.plotSize / 2;
      return {
        row: start + Math.floor(plot / this.plotSize),
        col: start + (plot % this.plotSize)
      };
    }

    getPlotIndexForCell(row, col) {
      if (!Number.isInteger(row) || !Number.isInteger(col) ||
          row < 0 || col < 0 || row >= this.worldSize || col >= this.worldSize) return null;
      return this.plotSize * this.plotSize + row * this.worldSize + col;
    }

    getAdjacentPlotIndex(centerIndex, localIndex) {
      if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= this.plotSize * this.plotSize)
        return null;
      const center = this.getPlotCell(centerIndex);
      if (!center) return null;
      const row = center.row + Math.floor(localIndex / this.plotSize) - this.plotSize / 2;
      const col = center.col + (localIndex % this.plotSize) - this.plotSize / 2;
      const plotIndex = this.getPlotIndexForCell(row, col);
      if (plotIndex === null || this.terrainAt(row, col)?.type === 'water') return null;
      return plotIndex;
    }

    centerOnPlot(index) {
      const cell = this.getPlotCell(index);
      if (!cell) return;
      this.camera.x = -(cell.col - cell.row) * this.tileWidth() / 2;
      this.camera.y = -(cell.row + cell.col - this.worldSize) * this.tileHeight() / 2;
      this.clampCamera();
    }

    plotIndexAtScreen(x, y) {
      const rect = this.canvas?.getBoundingClientRect();
      if (!rect) return null;
      const tileW = this.tileWidth();
      const tileH = tileW / 2;
      const dx = (x - rect.left - rect.width / 2 - this.camera.x) * 2 / tileW;
      const dy = (y - rect.top - rect.height / 2 - this.camera.y) * 2 / tileH;
      const row = Math.round((this.worldSize + dy - dx) / 2);
      const col = Math.round((this.worldSize + dy + dx) / 2);
      const plotIndex = this.getPlotIndexForCell(row, col);
      if (plotIndex === null || this.terrainAt(row, col)?.type === 'water') return null;
      return plotIndex;
    }

    handlePointerDown(event) {
      if (!this.active || event.button !== 0) return;
      this.pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cameraX: this.camera.x,
        cameraY: this.camera.y,
        moved: false
      };
      this.canvas.setPointerCapture?.(event.pointerId);
      this.canvas.style.cursor = 'grabbing';
      event.preventDefault();
    }

    handlePointerMove(event) {
      if (!this.active) return;
      if (this.pointer && this.pointer.id === event.pointerId) {
        const dx = event.clientX - this.pointer.x;
        const dy = event.clientY - this.pointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.pointer.moved = true;
        this.camera.x = this.pointer.cameraX + dx;
        this.camera.y = this.pointer.cameraY + dy;
        this.clampCamera();
        this.render();
        return;
      }

      const nextPlot = this.plotIndexAtScreen(event.clientX, event.clientY);
      if (nextPlot !== this.hoverPlot) {
        this.hoverPlot = nextPlot;
        this.canvas.style.cursor = nextPlot === null ? 'grab' : 'pointer';
        this.render();
      }
    }

    handlePointerUp(event) {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const pointer = this.pointer;
      this.pointer = null;
      this.canvas.style.cursor = 'grab';
      if (!pointer.moved) {
        const plot = this.plotIndexAtScreen(event.clientX, event.clientY);
        if (plot !== null) {
          this.selectedPlot = plot;
          this.onPlotSelected(plot);
          this.render();
        }
      }
    }

    cancelPointer() {
      this.pointer = null;
      if (this.canvas) this.canvas.style.cursor = this.hoverPlot === null ? 'grab' : 'pointer';
    }

    clampCamera() {
      const width = this.viewport?.clientWidth || 1;
      const height = this.viewport?.clientHeight || 1;
      const limitX = this.worldSize * this.tileWidth() / 2 + width / 2;
      const limitY = this.worldSize * this.tileHeight() / 2 + height / 2;
      this.camera.x = clamp(this.camera.x, -limitX, limitX);
      this.camera.y = clamp(this.camera.y, -limitY, limitY);
    }

    setRegion(index, name) {
      this.regionIndex = Math.max(0, Number(index) || 0);
      this.regionName = String(name || 'Beleland');
      this.camera = { x: 0, y: 0 };
      this.hoverPlot = null;
      this.centerOnPlot(this.selectedPlot);
      this.buildingSprites.clear();
      this.rebuildBuildingSprites();
      this.render();
    }

    setBuildings(buildings) {
      this.buildingData.clear();
      for (const [key, value] of Object.entries(buildings || {})) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || !value) continue;
        const cell = index < this.plotSize * this.plotSize
          ? this.getLegacyPlotCell(index)
          : this.getPlotCell(index);
        const worldIndex = cell ? this.getPlotIndexForCell(cell.row, cell.col) : null;
        if (worldIndex !== null) this.buildingData.set(worldIndex, value);
      }
      this.rebuildBuildingSprites();
      this.render();
    }

    setSelectedPlot(index) {
      this.selectedPlot = Number.isInteger(index) ? index : null;
      this.render();
    }

    rebuildBuildingSprites() {
      this.buildingSprites.clear();
      if (!this.ready) return;
      for (const [index, building] of this.buildingData) {
        let pool = this.pools.residential;
        if (building.id === 'farm') pool = this.pools.village.length ? this.pools.village : this.pools.residential;
        if (building.id === 'market' || building.id === 'workshop') pool = this.pools.commercial;
        if (building.id === 'utility') pool = this.pools.utility;
        if (!pool.length) continue;
        const cell = this.getPlotCell(index);
        const random = this.hash(cell.row, cell.col, 113);
        this.buildingSprites.set(index, pool[Math.floor(random * pool.length)]);
      }
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
        this.rebuildBuildingSprites();
        this.canvas.dataset.atlas = 'ready';
      } catch (error) {
        this.failed = true;
        this.canvas.dataset.atlas = 'unavailable';
        console.warn('[new-world] Building sprites are unavailable; open terrain remains active:', error.message);
      } finally {
        this.loading = false;
        this.render();
      }
    }

    setCamera(zoom) {
      this.zoom = Number(zoom) || 1;
      this.active = this.zoom >= 1.65;
      this.viewport?.classList.toggle('is-city-detail', this.active);
      if (this.active && !this.ready && !this.loading && !this.failed) this.loadAtlas();

      const label = document.getElementById('map-zoom-level');
      if (label) {
        label.textContent = this.active
          ? (this.zoom >= 3.15 ? 'TERRAIN DETAIL' : 'OPEN TERRITORY')
          : 'WORLD VIEW';
      }
      const coordinates = document.getElementById('map-coordinates');
      if (coordinates) {
        coordinates.textContent = this.active
          ? this.regionName.toUpperCase() + ' · OPEN TERRITORY'
          : 'BELELAND · WORLD 001';
      }
      const hint = document.querySelector('.map-foot-hint');
      if (hint) {
        hint.textContent = this.active
          ? 'SELECT A DEVELOPMENT PLOT · DRAG TO EXPLORE · SCROLL TO ZOOM'
          : 'CLICK A STATE TO INSPECT · DRAG TO PAN · SCROLL TO ZOOM';
      }
      this.clampCamera();
      this.render();
    }

    setZoomAt(zoom, x, y) {
      const oldWidth = this.tileWidth();
      this.zoom = clamp(Number(zoom) || this.zoom, 1.65, 6);
      const ratio = this.tileWidth() / oldWidth;
      const width = this.viewport?.clientWidth || 1;
      const height = this.viewport?.clientHeight || 1;
      this.camera.x = (x - width / 2) * (1 - ratio) + this.camera.x * ratio;
      this.camera.y = (y - height / 2) * (1 - ratio) + this.camera.y * ratio;
      this.clampCamera();
      this.render();
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

    drawTree(x, y, scale, tone) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(23, 34, 26, .2)';
      ctx.beginPath();
      ctx.ellipse(x + 2 * scale, y + 4 * scale, 7 * scale, 3.2 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#594b39';
      ctx.fillRect(x - scale, y - 2 * scale, 2 * scale, 7 * scale);
      const foliage = tone > 0.66 ? '#526b43' : tone > 0.33 ? '#60794a' : '#718454';
      ctx.fillStyle = foliage;
      ctx.beginPath();
      ctx.arc(x, y - 7 * scale, 6.5 * scale, 0, Math.PI * 2);
      ctx.arc(x - 4.2 * scale, y - 4 * scale, 4.8 * scale, 0, Math.PI * 2);
      ctx.arc(x + 4.2 * scale, y - 4 * scale, 4.8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(184, 190, 126, .42)';
      ctx.beginPath();
      ctx.arc(x - 1.8 * scale, y - 9 * scale, 2.4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    drawTerrain(cell, row, col, cx, cy, tileW, tileH, scale) {
      const ctx = this.ctx;
      const halfW = tileW / 2;
      const halfH = tileH / 2;
      const grass = ['#738761', '#7d9068', '#84946e', '#6e805c', '#788b63'];
      const dry = ['#998d69', '#a39670', '#8e8663'];

      this.polygon(cx, cy, halfW, halfH);
      ctx.fillStyle = cell.type === 'water'
        ? '#547a7d'
        : cell.type === 'dry'
          ? dry[Math.floor(cell.variation * dry.length)]
          : grass[Math.floor(cell.variation * grass.length)];
      ctx.fill();
      ctx.strokeStyle = cell.type === 'water'
        ? 'rgba(183, 213, 198, .22)'
        : 'rgba(35, 48, 31, .12)';
      ctx.lineWidth = Math.max(0.45, scale * 0.42);
      ctx.stroke();

      if (cell.type === 'water') {
        ctx.strokeStyle = 'rgba(195, 218, 202, .24)';
        ctx.lineWidth = Math.max(0.7, scale * 0.65);
        ctx.beginPath();
        ctx.moveTo(cx - halfW * 0.38, cy - halfH * 0.12);
        ctx.lineTo(cx + halfW * 0.28, cy + halfH * 0.04);
        ctx.stroke();
      } else if (cell.tree) {
        this.drawTree(cx - tileW * 0.03, cy - tileH * 0.02,
          scale * cell.treeScale, cell.treeTone);
      } else if (cell.rock) {
        ctx.fillStyle = '#77776b';
        ctx.beginPath();
        ctx.ellipse(cx + tileW * 0.06, cy, tileW * 0.105, tileH * 0.12, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(220, 215, 188, .28)';
        ctx.fillRect(cx + tileW * 0.025, cy - tileH * 0.055, tileW * 0.055, Math.max(1, scale));
      }

      const plotIndex = this.getPlotIndexForCell(row, col);
      const building = plotIndex === null ? null : this.buildingSprites.get(plotIndex);
      if (building) this.drawBuilding(building, cx, cy, tileW, tileH);
      if (plotIndex !== null && (plotIndex === this.selectedPlot || plotIndex === this.hoverPlot)) {
        this.polygon(cx, cy, halfW * 0.96, halfH * 0.96);
        ctx.strokeStyle = plotIndex === this.selectedPlot
          ? 'rgba(232, 198, 126, .96)'
          : 'rgba(239, 225, 183, .72)';
        ctx.lineWidth = Math.max(1.2, scale * 1.2);
        ctx.stroke();
      }
    }

    drawBuilding(sprite, cx, cy, tileW, tileH) {
      const ctx = this.ctx;
      const atlas = this.pages[sprite.page];
      if (!atlas) return;
      const drawWidth = tileW * 1.08;
      const aspect = sprite.height / Math.max(1, sprite.width);
      const drawHeight = Math.min(tileW * 2.35, drawWidth * aspect);
      const baseY = cy + tileH * 0.32;

      ctx.save();
      ctx.fillStyle = 'rgba(16, 29, 26, .23)';
      ctx.beginPath();
      ctx.ellipse(cx + tileW * 0.05, baseY - 1, tileW * 0.38, tileH * 0.18, 0, 0, Math.PI * 2);
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
      if (!this.active || !this.ctx || !this.canvas || !this.viewport) return;
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

      const tileW = this.tileWidth();
      const tileH = tileW / 2;
      const scale = tileW / 54;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#667d69';
      ctx.fillRect(0, 0, width, height);

      const projectToWorld = (screenX, screenY) => {
        const dx = (screenX - width / 2 - this.camera.x) * 2 / tileW;
        const dy = (screenY - height / 2 - this.camera.y) * 2 / tileH;
        return {
          row: (this.worldSize + dy - dx) / 2,
          col: (this.worldSize + dy + dx) / 2
        };
      };
      const corners = [
        projectToWorld(-tileW, -tileH),
        projectToWorld(width + tileW, -tileH),
        projectToWorld(-tileW, height + tileH),
        projectToWorld(width + tileW, height + tileH)
      ];
      const padding = 4;
      const minRow = clamp(Math.floor(Math.min(...corners.map(point => point.row)) - padding), 0, this.worldSize - 1);
      const maxRow = clamp(Math.ceil(Math.max(...corners.map(point => point.row)) + padding), 0, this.worldSize - 1);
      const minCol = clamp(Math.floor(Math.min(...corners.map(point => point.col)) - padding), 0, this.worldSize - 1);
      const maxCol = clamp(Math.ceil(Math.max(...corners.map(point => point.col)) + padding), 0, this.worldSize - 1);
      const sumMin = Math.max(minRow + minCol, Math.floor(minRow + minCol));
      const sumMax = maxRow + maxCol;
      const originX = width / 2 + this.camera.x;
      const originY = height / 2 + this.camera.y;

      for (let diagonal = sumMin; diagonal <= sumMax; diagonal++) {
        const rowStart = Math.max(minRow, diagonal - maxCol);
        const rowEnd = Math.min(maxRow, diagonal - minCol);
        for (let row = rowStart; row <= rowEnd; row++) {
          const col = diagonal - row;
          const cx = originX + (col - row) * tileW / 2;
          const cy = originY + (row + col - this.worldSize) * tileH / 2;
          if (cx < -tileW * 2 || cx > width + tileW * 2 ||
              cy < -tileH * 3 || cy > height + tileH * 3) continue;
          const terrain = this.terrainAt(row, col);
          if (terrain) this.drawTerrain(terrain, row, col, cx, cy, tileW, tileH, scale);
        }
      }

      ctx.save();
      const vignette = ctx.createRadialGradient(width / 2, height / 2,
        Math.min(width, height) * 0.24, width / 2, height / 2, Math.max(width, height) * 0.82);
      vignette.addColorStop(0, 'rgba(13, 24, 22, 0)');
      vignette.addColorStop(1, 'rgba(13, 24, 22, .22)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  window.NewWorldMapRenderer = NewWorldMapRenderer;
})();
