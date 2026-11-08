(() => {
  'use strict';

  const CATEGORY_ORDER = [
    {id:'recent',label:'Recent',icon:'◷'},
    {id:'all',label:'All',icon:'▦'},
    {id:'residential',label:'Residential',icon:'⌂'},
    {id:'commercial',label:'Commercial',icon:'▤'},
    {id:'industrial',label:'Industrial',icon:'⚒'},
    {id:'agriculture',label:'Agriculture',icon:'♧'},
    {id:'services',label:'Services',icon:'✚'},
    {id:'utilities',label:'Water',icon:'◉'},
    {id:'transport',label:'Transport',icon:'⇄'}
  ];

  const CATEGORY_BY_TYPE = {
    housing:'residential',
    market:'commercial',
    workshop:'industrial',
    farm:'agriculture',
    clinic:'services',
    school:'services',
    waterworks:'utilities',
    road:'transport'
  };

  const VALID_SPRITES = {
    farm:sprite => sprite.category === 'village' &&
      ['1x1_farmhouse_barn','1x1_fisherman_hut'].includes(sprite.asset),
    market:sprite => (
      (sprite.category === 'restaurants' || sprite.category === 'stores') &&
      sprite.asset.startsWith('1x1_commercial_') &&
      sprite.asset !== '1x1_commercial_57_clinic'
    ) || (sprite.category === 'village' && sprite.asset === '1x1_market_stall'),
    workshop:sprite => sprite.category === 'village' && sprite.asset === '1x1_lumber_shed',
    housing:sprite => (
      sprite.category === 'houses' &&
      sprite.asset.startsWith('1x1_house') &&
      Number.isInteger(Number(sprite.asset.slice(9)))
    ) || (
      sprite.category === 'village' &&
      ['1x1_dovecote','1x1_longhouse','1x1_round_cottage'].includes(sprite.asset)
    ),
    waterworks:sprite => sprite.category === 'watertower' && sprite.asset.startsWith('1x1_'),
    clinic:sprite => (
      sprite.category === 'stores' && sprite.asset === '1x1_commercial_57_clinic'
    ) || (
      sprite.category === 'village' && sprite.asset === '1x1_apothecary'
    ),
    school:sprite => sprite.category === 'village' && sprite.asset === '1x1_village_hall'
  };

  const CATEGORY_NAMES = {
    recent:'RECENTLY USED',
    all:'ALL BUILDINGS',
    residential:'RESIDENTIAL',
    commercial:'COMMERCIAL',
    industrial:'INDUSTRIAL',
    agriculture:'AGRICULTURE',
    services:'PUBLIC SERVICES',
    utilities:'WATER SUPPLY',
    transport:'TRANSPORT'
  };

  const money = amount => '¤ ' + Math.round(Number(amount) || 0).toLocaleString('en-US');
  const titleCase = value => String(value || '').replace(/[_-]+/g,' ')
    .replace(/\b([a-z])/g,letter => letter.toUpperCase());

  function resolveBuildingType(sprite) {
    const parts = String(sprite?.key || '').split('/');
    if (parts.length !== 2) return null;
    const candidate = {category:parts[0],asset:parts[1]};
    return Object.keys(VALID_SPRITES).find(type => VALID_SPRITES[type](candidate)) || null;
  }

  function displayName(asset, type) {
    const known = {
      '1x1_farmhouse_barn':'Farmhouse barn',
      '1x1_fisherman_hut':"Fisherman's hut",
      '1x1_market_stall':'Market stall',
      '1x1_lumber_shed':'Lumber shed',
      '1x1_dovecote':'Dovecote',
      '1x1_longhouse':'Longhouse',
      '1x1_round_cottage':'Round cottage',
      '1x1_apothecary':'Village apothecary',
      '1x1_village_hall':'Village school',
      '1x1_commercial_57_clinic':'Small clinic'
    };
    if (known[asset]) return known[asset];
    if (/^1x1_house\d+$/.test(asset)) return 'House ' + asset.slice('1x1_house'.length);
    if (/^1x1_commercial_\d+/.test(asset)) {
      const number = asset.match(/^1x1_commercial_(\d+)/)?.[1];
      const suffix = asset.replace(/^1x1_commercial_\d+_?/,'').replace(/_16bit$/,'');
      return 'Commercial ' + number + (suffix ? ' · ' + titleCase(suffix) : '');
    }
    const cleaned = asset.replace(/^1x1_/,'').replace(/_16bit$/,'');
    return titleCase(cleaned) || titleCase(type);
  }

  function createCatalog(sprites, buildingTypes) {
    const bases = new Map((buildingTypes || []).map(item => [item.id,item]));
    const catalog = [];
    const represented = new Set();

    for (const sprite of sprites || []) {
      const type = resolveBuildingType(sprite);
      const base = bases.get(type);
      if (!type || !base) continue;
      const asset = String(sprite.key).split('/')[1];
      catalog.push({
        ...base,
        id:String(sprite.key),
        buildingId:type,
        name:displayName(asset,type),
        spriteKey:String(sprite.key),
        sourceSheet:String(sprite.sourceSheet || ''),
        category:CATEGORY_BY_TYPE[type]
      });
      represented.add(type);
    }

    for (const base of buildingTypes || []) {
      if (represented.has(base.id)) continue;
      catalog.push({
        ...base,
        id:'base:' + base.id,
        buildingId:base.id,
        name:titleCase(base.name),
        spriteKey:'',
        sourceSheet:'',
        category:CATEGORY_BY_TYPE[base.id]
      });
    }

    const order = new Map((buildingTypes || []).map((item,index) => [item.id,index]));
    catalog.sort((a,b) =>
      (order.get(a.buildingId) ?? 99) - (order.get(b.buildingId) ?? 99) ||
      a.name.localeCompare(b.name)
    );
    return catalog;
  }

  class NewWorldBuildMenu {
    constructor({mapRenderer,buildingTypes,getContext,canPlace,onPlace,onSelectedPlot}) {
      this.mapRenderer = mapRenderer;
      this.buildingTypes = buildingTypes || [];
      this.getContext = typeof getContext === 'function' ? getContext : () => ({});
      this.canPlace = typeof canPlace === 'function' ? canPlace : () => false;
      this.onPlace = typeof onPlace === 'function' ? onPlace : () => false;
      this.onSelectedPlot = typeof onSelectedPlot === 'function' ? onSelectedPlot : () => {};
      this.root = document.getElementById('theotown-build-menu');
      this.categoryHost = document.getElementById('build-categories');
      this.listHost = document.getElementById('build-catalog-grid');
      this.search = document.getElementById('build-search');
      this.selectedId = null;
      this.selectedItem = null;
      this.items = [];
      this.category = 'all';
      this.recentIds = [];
      this.rotation = 0;
      this.placing = false;
      this.loaded = false;
      this.loadPromise = null;

      document.getElementById('build-menu-close')?.addEventListener('click',() => this.close());
      document.getElementById('build-confirm')?.addEventListener('click',() => this.beginPlacement());
      document.getElementById('build-rotate')?.addEventListener('click',() => this.rotate());
      document.getElementById('build-cancel-placement')?.addEventListener('click',() => this.cancelPlacement());
      this.search?.addEventListener('input',() => this.renderList());
      document.addEventListener('keydown',event => this.handleKeydown(event));

      this.root?.addEventListener('pointerdown',event => event.stopPropagation());
      this.renderEmpty();
    }

    async open() {
      if (!this.root) return;
      this.root.hidden = false;
      this.updateContext();
      if (!this.loaded) {
        this.setStatus('LOADING THE BUILDING ATLAS…');
        this.loadPromise ||= this.loadCatalog();
        await this.loadPromise;
      } else {
        this.renderCategories();
        this.renderList();
        this.renderSelected();
      }
      this.updateContext();
    }

    close() {
      this.cancelPlacement();
      if (this.root) this.root.hidden = true;
    }

    async loadCatalog() {
      let sprites = [];
      try {
        sprites = await this.mapRenderer?.getCatalogSprites() || [];
      } catch (error) {
        console.warn('[new-world] Could not load the building catalogue:',error);
      }
      this.items = createCatalog(sprites,this.buildingTypes);
      this.loaded = true;
      this.renderCategories();
      this.renderList();
      if (this.items.length) this.selectItem(this.items[0],false);
      else this.renderEmpty();
      const total = document.getElementById('build-catalog-total');
      if (total) total.textContent = this.items.length + ' BUILD OPTIONS';
    }

    renderEmpty() {
      if (this.listHost) {
        this.listHost.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'build-empty';
        empty.textContent = 'Loading available buildings…';
        this.listHost.appendChild(empty);
      }
    }

    renderCategories() {
      if (!this.categoryHost) return;
      this.categoryHost.replaceChildren();
      for (const category of CATEGORY_ORDER) {
        const count = this.items.filter(item => this.inCategory(item,category.id)).length;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'build-category' + (this.category === category.id ? ' active' : '');
        button.dataset.category = category.id;
        button.title = category.label + ' · ' + count + ' items';
        const symbol = document.createElement('span');
        symbol.className = 'build-category-symbol';
        symbol.textContent = category.icon;
        const label = document.createElement('small');
        label.textContent = category.label;
        button.append(symbol,label);
        button.addEventListener('click',() => {
          this.category = category.id;
          this.renderCategories();
          this.renderList();
        });
        this.categoryHost.appendChild(button);
      }
    }

    inCategory(item,category) {
      if (category === 'all') return true;
      if (category === 'recent') return this.recentIds.includes(item.id);
      return item.category === category;
    }

    filteredItems() {
      const query = String(this.search?.value || '').trim().toLowerCase();
      return this.items.filter(item =>
        this.inCategory(item,this.category) &&
        (!query || (item.name + ' ' + item.buildingId + ' ' + item.sourceSheet)
          .toLowerCase().includes(query))
      );
    }

    renderList() {
      if (!this.listHost) return;
      const items = this.filteredItems();
      const heading = document.getElementById('build-category-title');
      const count = document.getElementById('build-category-count');
      if (heading) heading.textContent = CATEGORY_NAMES[this.category] || 'BUILDINGS';
      if (count) count.textContent = items.length + ' ITEMS';
      this.listHost.replaceChildren();

      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'build-empty';
        empty.textContent = this.category === 'recent'
          ? 'No recently used buildings. Choose an item from another category.'
          : 'No buildings match this category or search.';
        this.listHost.appendChild(empty);
        return;
      }

      if (!items.some(item => item.id === this.selectedId)) {
        if (this.placing) this.cancelPlacement();
        this.selectedId = items[0].id;
        this.selectedItem = items[0];
      }

      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'build-item' + (item.id === this.selectedId ? ' selected' : '');
        button.setAttribute('aria-pressed',String(item.id === this.selectedId));
        button.title = item.name + ' · ' + money(item.cost);

        const thumbnail = document.createElement('canvas');
        thumbnail.className = 'build-item-thumbnail';
        thumbnail.width = 104;
        thumbnail.height = 72;
        thumbnail.setAttribute('aria-hidden','true');
        this.drawThumbnail(thumbnail,item);

        const copy = document.createElement('span');
        copy.className = 'build-item-copy';
        const name = document.createElement('strong');
        name.textContent = item.name;
        const price = document.createElement('small');
        price.textContent = money(item.cost);
        copy.append(name,price);
        button.append(thumbnail,copy);
        button.addEventListener('click',() => this.selectItem(item));
        this.listHost.appendChild(button);
      }

      this.renderSelected();
    }

    selectItem(item,remember = true) {
      if (!item) return;
      if (this.placing && item.id !== this.selectedId) this.cancelPlacement();
      this.selectedId = item.id;
      this.selectedItem = item;
      this.rotation = 0;
      if (remember) {
        this.recentIds = [item.id,...this.recentIds.filter(id => id !== item.id)].slice(0,12);
      }
      this.renderList();
      this.renderSelected();
    }

    drawThumbnail(canvas,item,orientation = 0) {
      if (item.spriteKey && this.mapRenderer?.drawSpriteThumbnail(
        canvas,item.spriteKey,orientation)) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = '#253538';
      ctx.fillRect(0,0,w,h);
      ctx.strokeStyle = '#62716b';
      ctx.lineWidth = 2;
      if (item.buildingId === 'road') {
        ctx.fillStyle = '#59605a';
        ctx.beginPath();
        ctx.moveTo(w * .12,h * .8);
        ctx.lineTo(w * .48,h * .2);
        ctx.lineTo(w * .9,h * .2);
        ctx.lineTo(w * .52,h * .8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([7,5]);
        ctx.strokeStyle = '#e0d5b5';
        ctx.beginPath();
        ctx.moveTo(w * .29,h * .65);
        ctx.lineTo(w * .69,h * .35);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = '#d5c7a2';
        ctx.font = 'bold 27px Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.icon || '▦',w/2,h/2);
      }
    }

    renderSelected() {
      const item = this.selectedItem;
      const preview = document.getElementById('build-selected-preview');
      const title = document.getElementById('build-selected-title');
      const category = document.getElementById('build-selected-category');
      const description = document.getElementById('build-selected-description');
      const cost = document.getElementById('build-selected-cost');
      const time = document.getElementById('build-selected-time');
      const stats = document.getElementById('build-selected-stats');
      const confirm = document.getElementById('build-confirm');

      if (!item) {
        if (title) title.textContent = 'Choose a building';
        if (category) category.textContent = 'NO BUILDING SELECTED';
        if (description) description.textContent = 'Select an item from the catalogue.';
        if (cost) cost.textContent = '—';
        if (time) time.textContent = '—';
        if (stats) stats.replaceChildren();
        if (confirm) confirm.disabled = true;
        return;
      }

      if (title) title.textContent = item.name;
      if (category) category.textContent = (CATEGORY_NAMES[item.category] || 'BUILDING') +
        ' / ' + item.buildingId.toUpperCase();
      if (description) description.textContent = item.desc || item.description ||
        'A local development asset for this settlement.';
      if (cost) cost.textContent = money(item.cost);
      if (time) time.textContent = item.days + ' WORLD DAY' + (item.days === 1 ? '' : 'S');

      if (stats) {
        stats.replaceChildren();
        const values = [
          ['MONTHLY INCOME',money(item.income)],
          ['MONTHLY UPKEEP',money(item.upkeep)],
          ['WORKERS',item.jobSlots ? Number(item.jobSlots).toLocaleString('en-US') : '—'],
          ['CAPACITY',this.capacitySummary(item)]
        ];
        for (const [label,value] of values) {
          const cell = document.createElement('div');
          const small = document.createElement('small');
          const strong = document.createElement('strong');
          small.textContent = label;
          strong.textContent = value;
          cell.append(small,strong);
          stats.appendChild(cell);
        }
      }

      if (preview) this.drawThumbnail(preview,item,this.rotation);
      if (confirm) confirm.disabled = !this.getContext().canBuild ||
        Number(this.getContext().treasury) < Number(item.cost);
      this.updateContext();
    }

    capacitySummary(item) {
      const values = [
        item.housingCapacity && 'Housing ' + Number(item.housingCapacity).toLocaleString('en-US'),
        item.foodCapacity && 'Food ' + Number(item.foodCapacity).toLocaleString('en-US'),
        item.waterCapacity && 'Water ' + Number(item.waterCapacity).toLocaleString('en-US'),
        item.healthCapacity && 'Health ' + Number(item.healthCapacity).toLocaleString('en-US'),
        item.educationCapacity && 'Education ' + Number(item.educationCapacity).toLocaleString('en-US')
      ].filter(Boolean);
      return values.join(' · ') || 'Local';
    }

    updateContext() {
      const context = this.getContext() || {};
      const region = document.getElementById('build-region-name');
      const budget = document.getElementById('build-budget');
      const total = document.getElementById('build-catalog-total');
      const confirm = document.getElementById('build-confirm');
      const rotate = document.getElementById('build-rotate');
      const cancel = document.getElementById('build-cancel-placement');
      if (region) region.textContent = String(context.regionName || 'NO SETTLEMENT SELECTED').toUpperCase();
      if (budget) budget.textContent = money(context.treasury);
      if (confirm) confirm.disabled = !context.canBuild || !this.selectedItem ||
        Number(context.treasury) < Number(this.selectedItem.cost) || this.placing;
      if (rotate) rotate.disabled = !this.placing;
      if (cancel) cancel.disabled = !this.placing;
      if (total && this.loaded) total.textContent = this.items.length + ' BUILD OPTIONS';
      if (!this.placing) {
        if (!this.selectedItem) {
          this.setStatus('CHOOSE AN OBJECT FROM THE CATALOGUE.');
        } else if (!context.canBuild) {
          this.setStatus('CONNECT TO A RUNNING MULTIPLAYER WORLD TO PLACE BUILDINGS.');
        } else if (Number(context.treasury) < Number(this.selectedItem.cost)) {
          this.setStatus('INSUFFICIENT TREASURY · ' + money(this.selectedItem.cost) + ' REQUIRED.');
        } else {
          this.setStatus('READY · PRESS BUILD, THEN CLICK AN EMPTY PLOT ON THE MAP.');
        }
      }
    }

    beginPlacement() {
      const context = this.getContext() || {};
      const item = this.selectedItem;
      if (!item || !context.canBuild) {
        this.setStatus('JOIN A GOVERNMENT AND START THE WORLD BEFORE BUILDING.');
        return;
      }
      if (Number(context.treasury) < Number(item.cost)) {
        this.setStatus('INSUFFICIENT TREASURY FOR THIS BUILDING.');
        return;
      }
      this.placing = true;
      this.rotation = 0;
      this.root?.classList.add('is-placing');
      this.mapRenderer?.setPlacementPreview({
        typeId:item.buildingId,
        spriteKey:item.spriteKey,
        orientation:this.rotation
      },index => this.canPlace(item,index));
      this.updateContext();
      this.setStatus('PLACE ' + item.name.toUpperCase() + ' ON OPEN LAND · R TO ROTATE · ESC TO CANCEL');
    }

    placeAt(index) {
      if (!this.placing || !this.selectedItem) {
        this.onSelectedPlot(index);
        return false;
      }
      const item = this.selectedItem;
      if (!this.canPlace(item,index)) {
        this.setStatus('THIS PLOT CANNOT BE USED. CHOOSE EMPTY, DRY LAND IN YOUR SETTLEMENT.');
        return false;
      }
      const queued = this.onPlace(item,index,this.rotation);
      if (!queued) {
        this.setStatus('THE BUILD ORDER COULD NOT BE SENT. CHECK THE MULTIPLAYER CONNECTION.');
        return false;
      }
      this.recentIds = [item.id,...this.recentIds.filter(id => id !== item.id)].slice(0,12);
      this.placing = false;
      this.root?.classList.remove('is-placing');
      this.mapRenderer?.setPlacementPreview(null);
      this.onSelectedPlot(index);
      this.updateContext();
      this.setStatus('BUILD ORDER SENT · WAITING FOR HOST CONFIRMATION.');
      return true;
    }

    rotate() {
      if (!this.placing || !this.selectedItem) return;
      this.rotation = (this.rotation + 1) % 4;
      this.mapRenderer?.setPlacementPreview({
        typeId:this.selectedItem.buildingId,
        spriteKey:this.selectedItem.spriteKey,
        orientation:this.rotation
      },index => this.canPlace(this.selectedItem,index));
      this.renderSelected();
      this.setStatus('ROTATION ' + this.rotation + ' / 4 · CLICK OPEN LAND TO PLACE.');
    }

    cancelPlacement() {
      const wasPlacing = this.placing;
      this.placing = false;
      this.root?.classList.remove('is-placing');
      this.mapRenderer?.setPlacementPreview(null);
      this.updateContext();
      if (wasPlacing) this.setStatus('PLACEMENT CANCELLED.');
      return wasPlacing;
    }

    setStatus(message) {
      const status = document.getElementById('build-placement-status');
      if (status) status.textContent = String(message || '');
    }

    handleKeydown(event) {
      if (!this.placing) return;
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        this.rotate();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelPlacement();
      }
    }
  }

  if (typeof window !== 'undefined') window.NewWorldBuildMenu = NewWorldBuildMenu;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.freeze({
      NewWorldBuildMenu,
      createCatalog,
      resolveBuildingType,
      displayName,
      CATEGORY_ORDER
    });
  }
})();