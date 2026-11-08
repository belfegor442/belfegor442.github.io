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
      this.spriteIndex = new Map();
      this.placementPreview = null;
      this.canPlacePlot = () => false;
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
      return 54 * clamp(this.zoom, 0.04, 1.53);
    }

    tileHeight() {
      return this.tileWidth() / 2;
    }

    renderStep() {
      if (this.zoom <= 0.06) return 8;
      if (this.zoom <= 0.12) return 4;
      if (this.zoom <= 0.22) return 2;
      return 1;
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

      const phase = this.regionIndex * 0.61;
      const warpRow = (this.valueNoise(row, col, 190, 11) - 0.5) * 120 +
        (this.valueNoise(row, col, 68, 13) - 0.5) * 36;
      const warpCol = (this.valueNoise(row, col, 175, 19) - 0.5) * 116 +
        (this.valueNoise(row, col, 62, 23) - 0.5) * 34;
      const y = row + warpRow;
      const x = col + warpCol;

      const continentalDistance = Math.hypot(
        (y - 510 - 34 * Math.sin(x / 230 + phase)) / 565,
        (x - 512 - 45 * Math.sin(y / 260 + phase * 0.8)) / 560
      );
      const coastNoise = this.valueNoise(y, x, 142, 29) * 0.65 +
        this.valueNoise(y, x, 58, 31) * 0.35;
      const coast = continentalDistance + (0.5 - coastNoise) * 0.27;

      const mainRiverCol = 279 + row * 0.537 +
        62 * Math.sin(row / 118 + phase) + 22 * Math.sin(row / 37 + phase * 0.7);
      const mainRiverDistance = Math.abs(col - mainRiverCol) / Math.sqrt(1 + 0.537 * 0.537);
      const tributaryRow = 850 - col * 0.28 + 36 * Math.sin(col / 110 + phase + 1.1);
      const tributaryDistance = Math.abs(row - tributaryRow) / Math.sqrt(1 + 0.28 * 0.28);
      const northernLake = Math.pow((row - 255 + 10 * Math.sin(col / 90)) / 92, 2) +
        Math.pow((col - 770 + 12 * Math.sin(row / 75)) / 122, 2);
      const southernLake = Math.pow((row - 815 + 8 * Math.sin(col / 58)) / 58, 2) +
        Math.pow((col - 215 + 10 * Math.sin(row / 62)) / 72, 2);

      const ocean = coast > 1.0;
      const river = mainRiverDistance < 2.15 || tributaryDistance < 1.7;
      const lake = northernLake < 1 || southernLake < 1;
      const water = ocean || river || lake;
      const riverbank = !water && (mainRiverDistance < 7.5 || tributaryDistance < 6.5);
      const shoreline = !water && coast > 0.94;

      const baseElevation = this.valueNoise(y, x, 210, 37) * 0.58 +
        this.valueNoise(y, x, 96, 41) * 0.29 +
        this.valueNoise(y, x, 38, 43) * 0.13;
      const ridgeCenter = 250 + 100 * Math.sin(x / 145 + phase) +
        30 * Math.sin(x / 53 + phase * 0.7);
      const ridgeDistance = Math.abs(y - ridgeCenter);
      const ridgeInfluence = Math.max(0, 1 - ridgeDistance / 108);
      const elevation = baseElevation * 0.67 + ridgeInfluence * 0.33;
      const moisture = this.valueNoise(y, x, 190, 47) * 0.55 +
        this.valueNoise(y, x, 84, 53) * 0.3 +
        this.valueNoise(y, x, 34, 59) * 0.15 +
        (Math.min(mainRiverDistance, tributaryDistance) < 22 ? 0.13 : 0);

      const mountain = !water && !riverbank && !shoreline &&
        ridgeDistance < 24 && elevation > 0.43;
      const hills = !water && !riverbank && !shoreline && !mountain &&
        (ridgeDistance < 64 || elevation > 0.79);
      const wetland = !water && !riverbank && !shoreline && !mountain &&
        moisture > 0.78 && elevation < 0.58;
      const dry = !water && !riverbank && !shoreline && !mountain && !hills &&
        moisture < 0.27 && baseElevation > 0.3;
      const woodland = !water && !riverbank && !shoreline && !mountain &&
        !hills && !wetland && !dry && moisture > 0.63;

      const type = water ? 'water' : riverbank || shoreline ? 'shore' :
        mountain ? 'mountain' : hills ? 'hills' : wetland ? 'wetland' :
        dry ? 'dry' : woodland ? 'forest' : 'grass';
      const variation = this.valueNoise(y, x, 34, 71);
      const forestChance = woodland ? 0.34 + Math.max(0, moisture - 0.68) * 0.28 :
        wetland ? 0.12 : hills ? 0.035 : 0.004;
      const tree = !water && !mountain && this.hash(row, col, 83) < forestChance;
      const peak = mountain && this.hash(Math.floor(y / 8), Math.floor(x / 8), 97) < 0.28;
      const rock = !water && !tree && (peak ||
        (hills && this.hash(row, col, 97) < 0.018));

      return {
        type,
        variation,
        elevation,
        moisture,
        tree,
        rock,
        peak,
        treeScale: 0.82 + this.hash(row, col, 89) * 0.48,
        treeTone: this.valueNoise(y, x, 27, 101)
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
        const valid = nextPlot !== null && (!this.placementPreview || this.canPlacePlot(nextPlot));
        this.canvas.style.cursor = this.placementPreview
          ? (valid ? 'crosshair' : 'not-allowed')
          : (nextPlot === null ? 'grab' : 'pointer');
        this.render();
      }
    }

    handlePointerUp(event) {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const pointer = this.pointer;
      this.pointer = null;
      this.canvas.style.cursor = this.placementPreview ? 'crosshair' : 'grab';
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
      if (this.canvas) this.canvas.style.cursor = this.placementPreview
        ? (this.hoverPlot !== null && this.canPlacePlot(this.hoverPlot) ? 'crosshair' : 'not-allowed')
        : (this.hoverPlot === null ? 'grab' : 'pointer');
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

    getSprite(spriteKey, orientation = 0) {
      if (!spriteKey) return null;
      const direction = ((Number(orientation) || 0) % 4 + 4) % 4;
      return this.spriteIndex.get(String(spriteKey) + '/orientation-' + direction) || null;
    }

    async getCatalogSprites() {
      if (!this.ready && !this.loading && !this.failed) this.loadAtlas();
      while (this.loading) await new Promise(resolve => setTimeout(resolve,40));
      return this.ready
        ? this.sprites.filter(sprite => sprite.orientation === 0)
          .map(sprite => ({
            key:String(sprite.key).replace('/orientation-0',''),
            category:sprite.category,
            sourceSheet:sprite.sourceSheet,
            width:sprite.width,
            height:sprite.height
          }))
        : [];
    }

    drawSpriteThumbnail(canvas, spriteKey, orientation = 0) {
      const sprite = this.getSprite(spriteKey,orientation);
      if (!canvas || !sprite) return false;
      const atlas = this.pages[sprite.page];
      const ctx = canvas.getContext('2d');
      if (!atlas || !ctx) return false;
      const width = canvas.width || 128;
      const height = canvas.height || 96;
      ctx.clearRect(0,0,width,height);
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min((width - 10) / sprite.width,(height - 8) / sprite.height);
      const drawWidth = sprite.width * scale;
      const drawHeight = sprite.height * scale;
      ctx.drawImage(atlas,sprite.x,sprite.y,sprite.width,sprite.height,
        (width-drawWidth)/2,(height-drawHeight)/2,drawWidth,drawHeight);
      return true;
    }

    setPlacementPreview(placement, validator = null) {
      this.placementPreview = placement ? {...placement} : null;
      this.canPlacePlot = typeof validator === 'function' ? validator : (() => false);
      if (this.canvas) {
        const valid = this.hoverPlot !== null && this.canPlacePlot(this.hoverPlot);
        this.canvas.style.cursor = this.placementPreview
          ? (valid ? 'crosshair' : 'not-allowed')
          : (this.hoverPlot === null ? 'grab' : 'pointer');
      }
      this.render();
    }

    rebuildBuildingSprites() {
      this.buildingSprites.clear();
      if (!this.ready) return;
      for (const [index, building] of this.buildingData) {
        const variant = this.getSprite(building.spriteKey,building.rotation || 0);
        if (variant) {
          this.buildingSprites.set(index,variant);
          continue;
        }
        let pool = this.pools.residential;
        if (building.id === 'farm') pool = this.pools.village.length ? this.pools.village : this.pools.residential;
        if (building.id === 'market' || building.id === 'workshop' ||
            building.id === 'clinic' || building.id === 'school') pool = this.pools.commercial;
        if (building.id === 'waterworks' || building.id === 'utility') pool = this.pools.utility;
        if (building.id === 'road') continue;
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
        this.spriteIndex = new Map(sprites.map(sprite => [sprite.key,sprite]));
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

    setCamera(zoom, detailMode = null) {
      this.zoom = clamp(Number(zoom) || 1, 0.04, 6);
      this.active = detailMode === null ? this.zoom >= 1.65 : Boolean(detailMode);
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
          ? this.regionName.toUpperCase() + ' Â· OPEN TERRITORY'
          : 'BELELAND Â· WORLD 001';
      }
      const hint = document.querySelector('.map-foot-hint');
      if (hint) {
        hint.textContent = this.active
          ? 'SELECT A DEVELOPMENT PLOT Â· DRAG TO EXPLORE Â· SCROLL TO ZOOM'
          : 'DOUBLE-CLICK A TERRITORY TO OPEN ITS MAP Â· DRAG TO PAN';
      }
      this.clampCamera();
      this.render();
    }

    setZoomAt(zoom, x, y) {
      const oldWidth = this.tileWidth();
      this.zoom = clamp(Number(zoom) || this.zoom, 0.04, 6);
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
      const canopy = tone > 0.67 ? '#344d37' : tone > 0.34 ? '#405e3d' : '#526c45';
      const highlight = tone > 0.55 ? '#72865a' : '#8b9765';
      ctx.fillStyle = 'rgba(28, 40, 29, .2)';
      ctx.beginPath();
      ctx.ellipse(x + 2.2 * scale, y + 4.4 * scale,
        7.8 * scale, 3.1 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#66543d';
      ctx.fillRect(x - 0.8 * scale, y - 2 * scale, 1.8 * scale, 7 * scale);
      ctx.fillStyle = canopy;
      ctx.beginPath();
      ctx.moveTo(x, y - 17 * scale);
      ctx.lineTo(x + 7.3 * scale, y - 4 * scale);
      ctx.lineTo(x + 4.4 * scale, y - 4 * scale);
      ctx.lineTo(x + 8.7 * scale, y + 1.1 * scale);
      ctx.lineTo(x - 8.7 * scale, y + 1.1 * scale);
      ctx.lineTo(x - 4.4 * scale, y - 4 * scale);
      ctx.lineTo(x - 7.3 * scale, y - 4 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.moveTo(x, y - 14 * scale);
      ctx.lineTo(x - 1.8 * scale, y - 5.5 * scale);
      ctx.lineTo(x - 5.2 * scale, y - 3.2 * scale);
      ctx.closePath();
      ctx.fill();
    }

    drawMountain(x, y, tileW, tileH, strength) {
      const ctx = this.ctx;
      const scale = Math.min(1, Math.max(0.2, tileW / 32));
      const height = tileH * (0.58 + strength * 0.36);
      const halfWidth = tileW * (0.23 + strength * 0.08);
      ctx.fillStyle = 'rgba(35, 39, 34, .2)';
      ctx.beginPath();
      ctx.ellipse(x + tileW * 0.07, y + tileH * 0.2,
        halfWidth * 1.45, tileH * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#777e76';
      ctx.beginPath();
      ctx.moveTo(x - halfWidth, y + tileH * 0.2);
      ctx.lineTo(x - halfWidth * 0.12, y - height);
      ctx.lineTo(x + halfWidth * 1.05, y + tileH * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b5b5a3';
      ctx.beginPath();
      ctx.moveTo(x - halfWidth * 0.12, y - height);
      ctx.lineTo(x + halfWidth * 0.45, y - height * 0.18);
      ctx.lineTo(x + halfWidth * 1.05, y + tileH * 0.2);
      ctx.lineTo(x - halfWidth * 0.12, y + tileH * 0.2);
      ctx.closePath();
      ctx.fill();
      if (strength > 0.68) {
        ctx.fillStyle = '#e2dfd0';
        ctx.beginPath();
        ctx.moveTo(x - halfWidth * 0.12, y - height);
        ctx.lineTo(x + halfWidth * 0.2, y - height * 0.52);
        ctx.lineTo(x + halfWidth * 0.45, y - height * 0.18);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawTerrain(cell, row, col, cx, cy, tileW, tileH, scale) {
      const ctx = this.ctx;
      const halfW = tileW / 2;
      const halfH = tileH / 2;
      const palettes = {
        water: ['#527b85', '#587f88', '#4b737f', '#60858c'],
        shore: ['#b2a47d', '#b9aa82', '#a89d78'],
        grass: ['#87966d', '#8d9a71', '#7e9069', '#929d75'],
        dry: ['#aa976d', '#b3a075', '#a3926b'],
        forest: ['#5f7957', '#68825b', '#58724f', '#6e855f'],
        wetland: ['#74866b', '#7d8e70', '#6b7e67'],
        hills: ['#7c896d', '#858f72', '#727f67'],
        mountain: ['#80867b', '#898d81', '#767e75']
      };
      const palette = palettes[cell.type] || palettes.grass;
      const colourIndex = Math.min(palette.length - 1,
        Math.floor(clamp(cell.variation, 0, 0.9999) * palette.length));

      this.polygon(cx, cy, halfW, halfH);
      ctx.fillStyle = palette[colourIndex];
      ctx.fill();

      if (cell.type === 'water') {
        if (this.hash(row, col, 107) < 0.12 && scale > 0.12) {
          ctx.strokeStyle = 'rgba(202, 221, 207, .22)';
          ctx.lineWidth = Math.max(0.6, scale * 0.7);
          ctx.beginPath();
          ctx.moveTo(cx - halfW * 0.36, cy - halfH * 0.08);
          ctx.quadraticCurveTo(cx, cy + halfH * 0.12, cx + halfW * 0.3, cy + halfH * 0.02);
          ctx.stroke();
        }
      } else if (cell.type === 'mountain' && cell.peak) {
        this.drawMountain(cx, cy, tileW, tileH, cell.elevation);
      } else if (cell.type === 'hills' && this.hash(row, col, 109) < 0.08 && scale > 0.2) {
        ctx.strokeStyle = 'rgba(55, 68, 47, .13)';
        ctx.lineWidth = Math.max(0.5, scale * 0.55);
        ctx.beginPath();
        ctx.arc(cx, cy + tileH * 0.1, tileW * 0.21, Math.PI * 1.08, Math.PI * 1.88);
        ctx.stroke();
      } else if (cell.tree) {
        this.drawTree(cx - tileW * 0.03, cy - tileH * 0.03,
          scale * cell.treeScale, cell.treeTone);
      } else if (cell.rock) {
        ctx.fillStyle = '#74786d';
        ctx.beginPath();
        ctx.moveTo(cx - tileW * 0.12, cy + tileH * 0.05);
        ctx.lineTo(cx - tileW * 0.04, cy - tileH * 0.11);
        ctx.lineTo(cx + tileW * 0.12, cy - tileH * 0.02);
        ctx.lineTo(cx + tileW * 0.09, cy + tileH * 0.12);
        ctx.closePath();
        ctx.fill();
      }

      const blockStep = Math.max(1, Math.round(tileW / this.tileWidth()));
      let plotIndex = this.getPlotIndexForCell(row, col);
      let buildingData = plotIndex === null ? null : this.buildingData.get(plotIndex);
      if (!buildingData && blockStep > 1) {
        for (let blockRow = row; blockRow < Math.min(this.worldSize, row + blockStep) && !buildingData; blockRow++) {
          for (let blockCol = col; blockCol < Math.min(this.worldSize, col + blockStep); blockCol++) {
            const candidateIndex = this.getPlotIndexForCell(blockRow, blockCol);
            const candidate = candidateIndex === null ? null : this.buildingData.get(candidateIndex);
            if (candidate) {
              plotIndex = candidateIndex;
              buildingData = candidate;
              break;
            }
          }
        }
      }
      const building = plotIndex === null ? null : this.buildingSprites.get(plotIndex);
      if (buildingData?.id === 'road') {
        ctx.save();
        if (Number(buildingData.daysRemaining) > 0) ctx.globalAlpha = 0.48;
        this.polygon(cx, cy, halfW * 0.92, halfH * 0.92);
        ctx.fillStyle = '#555d58';
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 216, 188, .55)';
        ctx.lineWidth = Math.max(0.8, scale * 1.15);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(238, 226, 194, .72)';
        ctx.lineWidth = Math.max(0.55, scale * 0.65);
        ctx.setLineDash([Math.max(1, tileW * 0.12), Math.max(1, tileW * 0.1)]);
        ctx.beginPath();
        ctx.moveTo(cx - tileW * 0.22, cy);
        ctx.lineTo(cx + tileW * 0.22, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (building) {
        this.drawBuilding(building, cx, cy, tileW, tileH, buildingData);
      }
      if (this.placementPreview && plotIndex !== null && plotIndex === this.hoverPlot) {
        const valid = !buildingData && this.canPlacePlot(plotIndex);
        const previewSprite = this.getSprite(
          this.placementPreview.spriteKey,this.placementPreview.orientation || 0);
        ctx.save();
        this.polygon(cx,cy,halfW * 0.96,halfH * 0.96);
        ctx.fillStyle = valid ? 'rgba(114, 170, 91, .28)' : 'rgba(190, 83, 67, .32)';
        ctx.fill();
        ctx.strokeStyle = valid ? '#b1df82' : '#e58c79';
        ctx.lineWidth = Math.max(1.8,scale * 1.8);
        ctx.setLineDash([Math.max(2,scale * 2),Math.max(1,scale)]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (previewSprite) {
          ctx.globalAlpha = valid ? 0.72 : 0.25;
          this.drawBuilding(previewSprite,cx,cy,tileW,tileH,{preview:true});
        } else if (this.placementPreview.typeId === 'road') {
          ctx.globalAlpha = valid ? 0.78 : 0.3;
          this.polygon(cx,cy,halfW * 0.82,halfH * 0.82);
          ctx.fillStyle = '#555d58';
          ctx.fill();
          ctx.strokeStyle = valid ? '#d4d0b1' : '#e58c79';
          ctx.lineWidth = Math.max(1.2,scale * 1.05);
          ctx.setLineDash([Math.max(2,tileW * 0.12),Math.max(1,tileW * 0.1)]);
          ctx.beginPath();
          ctx.moveTo(cx - tileW * 0.2,cy);
          ctx.lineTo(cx + tileW * 0.2,cy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
      if (plotIndex !== null && (plotIndex === this.selectedPlot || plotIndex === this.hoverPlot)) {
        this.polygon(cx, cy, halfW * 0.96, halfH * 0.96);
        ctx.strokeStyle = plotIndex === this.selectedPlot
          ? 'rgba(232, 198, 126, .96)'
          : 'rgba(239, 225, 183, .72)';
        ctx.lineWidth = Math.max(1.2, scale * 1.2);
        ctx.stroke();
      }
    }

    drawBuilding(sprite, cx, cy, tileW, tileH, building = null) {
      const ctx = this.ctx;
      const atlas = this.pages[sprite.page];
      if (!atlas) return;
      const drawWidth = tileW * 1.08;
      const aspect = sprite.height / Math.max(1, sprite.width);
      const drawHeight = Math.min(tileW * 2.35, drawWidth * aspect);
      const baseY = cy + tileH * 0.32;

      ctx.save();
      if (building?.preview) ctx.globalAlpha = Math.min(ctx.globalAlpha,0.72);
      else if (Number(building?.daysRemaining) > 0) ctx.globalAlpha = 0.48;
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
      const sumMin = minRow + minCol;
      const sumMax = maxRow + maxCol;
      const originX = width / 2 + this.camera.x;
      const originY = height / 2 + this.camera.y;
      const step = this.renderStep();
      const blockWidth = tileW * step;
      const blockHeight = tileH * step;
      const blockScale = scale * step;
      const firstDiagonal = Math.floor(sumMin / step) * step;

      for (let diagonal = firstDiagonal; diagonal <= sumMax; diagonal += step) {
        const rowStart = Math.ceil(Math.max(minRow, diagonal - maxCol) / step) * step;
        const rowEnd = Math.floor(Math.min(maxRow, diagonal - minCol) / step) * step;
        for (let row = rowStart; row <= rowEnd; row += step) {
          const col = diagonal - row;
          const cx = originX + (col - row) * tileW / 2;
          const cy = originY + (row + col + step - 1 - this.worldSize) * tileH / 2;
          if (cx < -blockWidth * 2 || cx > width + blockWidth * 2 ||
              cy < -blockHeight * 3 || cy > height + blockHeight * 3) continue;
          const sampleOffset = Math.floor((step - 1) / 2);
          const sampleRow = Math.min(this.worldSize - 1, row + sampleOffset);
          const sampleCol = Math.min(this.worldSize - 1, col + sampleOffset);
          const terrain = this.terrainAt(sampleRow, sampleCol);
          if (terrain) {
            this.drawTerrain(terrain, row, col, cx, cy,
              blockWidth, blockHeight, blockScale);
          }
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
