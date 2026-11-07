/* New World browser-hosted simulation core.
 * Pure game rules run on the host device. MQTT only transports snapshots and orders.
 */
(() => {
  'use strict';

  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const MAX_TREASURY = 2147483647;
  const DAYS_PER_FINANCIAL_PERIOD = 30;

  const clone = value => structuredClone(value);
  const id = () => globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(1));
        const n = bytes[0] & 15;
        return (c === 'x' ? n : (n & 3) | 8).toString(16);
      });

  function integer(value, label, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new Error(label + ' must be a safe integer of at least ' + minimum + '.');
    return BigInt(value);
  }

  function number(value, label) {
    if (value > MAX_SAFE || value < -MAX_SAFE)
      throw new Error(label + ' exceeds the browser simulation limit.');
    return Number(value);
  }

  function amount(source, key) {
    return integer(source?.[key] ?? 0, 'Inventory ' + key);
  }

  function pushActivity(game, description) {
    game.activity ||= [];
    game.activity.unshift(description);
    if (game.activity.length > 100) game.activity.length = 100;
  }

  function pushEvent(game, type, stateId, description) {
    game.events ||= [];
    game.eventSequence = (game.eventSequence || 0) + 1;
    game.events.push({
      id:id(), gameId:game.id, orderId:null, actorPlayerId:null, stateId:stateId || null,
      type, resultCode:null, occurredAtUtc:new Date().toISOString(),
      worldDate:game.worldDate, worldVersion:game.worldVersion + 1,
      description, sequence:game.eventSequence
    });
    if (game.events.length > 1000) game.events.splice(0, game.events.length - 1000);
  }

  function calculateGovernmentFinance(game, territory) {
    const buildings = Object.values(territory.buildings || {});
    const completed = buildings.filter(building => Number(building.daysRemaining || 0) <= 0);
    const controlled = Boolean(territory.ownerPlayerId);
    const territorialIncome = controlled
      ? Math.round(Number(territory.population || 0) / 1500 *
        (Number(territory.prosperity || 0) / 100))
      : 0;
    const cityIncome = controlled ? 85 + completed.reduce((sum,building) =>
      sum + Number(building.income || 0),0) : 0;
    const upkeep = completed.reduce((sum,building) =>
      sum + Number(building.upkeep || 0),0);
    return {territorialIncome,cityIncome,upkeep,
      monthlyBalance:territorialIncome + cityIncome - upkeep};
  }

  function accrueGovernmentBalances(game) {
    game.financialTransactions ||= [];
    for (const territory of game.territories) {
      const monthlyBalance = calculateGovernmentFinance(game, territory).monthlyBalance;
      const accumulated = integer(territory.dailyBalanceRemainder || 0, 'Treasury remainder', -Number.MAX_SAFE_INTEGER) +
        BigInt(monthlyBalance);
      let dailyChange = accumulated / BigInt(DAYS_PER_FINANCIAL_PERIOD);
      territory.dailyBalanceRemainder = number(
        accumulated % BigInt(DAYS_PER_FINANCIAL_PERIOD), 'Treasury remainder');
      const before = integer(territory.treasury || 0, 'State treasury');
      let after = before + dailyChange;
      if (after < 0n) {
        dailyChange = -before;
        after = 0n;
        territory.dailyBalanceRemainder = 0;
      } else if (after > BigInt(MAX_TREASURY)) {
        dailyChange = BigInt(MAX_TREASURY) - before;
        after = BigInt(MAX_TREASURY);
        territory.dailyBalanceRemainder = 0;
      }
      territory.treasury = number(after, 'State treasury');
      if (dailyChange !== 0n) {
        game.financialTransactions.push({
          id:id(), stateId:territory.stateId, currencyId:territory.currencyId,
          type:'DailyBalance', amount:number(dailyChange, 'Daily balance change'),
          balanceBefore:number(before, 'Previous treasury'),
          balanceAfter:territory.treasury, worldDate:game.worldDate,
          recordedAtUtc:new Date().toISOString(), orderId:null, membershipId:null,
          description:'Daily balance change from a monthly balance of ' + monthlyBalance + '.'
        });
      }
    }
    if (game.financialTransactions.length > 1000)
      game.financialTransactions.splice(0, game.financialTransactions.length - 1000);
  }

  function advanceProduction(game) {
    const recipes = new Map((game.productionRecipes || []).map(recipe => [recipe.id, recipe]));
    const results = [];
    for (const company of game.companies || []) {
      company.inventory ||= {};
      company.facilities ||= [];
      for (const facility of company.facilities) {
        const recipe = recipes.get(facility.recipeId);
        if (!recipe) throw new Error('Facility ' + facility.id + ' references a missing production recipe.');
        const days = Number(recipe.daysPerBatch);
        const cycleBatches = Number(facility.batchesPerCycle);
        const progressDays = Number(facility.progressDays || 0);
        if (!Number.isSafeInteger(days) || days < 1 ||
            !Number.isSafeInteger(cycleBatches) || cycleBatches < 1 ||
            !Number.isSafeInteger(progressDays) || progressDays < 0 || progressDays >= days)
          throw new Error('Production facility ' + facility.id + ' has invalid cycle settings.');

        const inputs = recipe.inputs || {};
        const outputs = recipe.outputs || {};
        let hasInputs = true;
        for (const [goodId, required] of Object.entries(inputs)) {
          const requiredAmount = integer(required, 'Recipe input ' + goodId, 1);
          if (amount(company.inventory, goodId) < requiredAmount) hasInputs = false;
        }
        if (!hasInputs) continue;

        const progress = progressDays + 1;
        if (progress < days) {
          facility.progressDays = progress;
          continue;
        }

        let batches = BigInt(cycleBatches);
        for (const [goodId, required] of Object.entries(inputs)) {
          const available = amount(company.inventory, goodId);
          batches = batches < available / integer(required, 'Recipe input ' + goodId, 1)
            ? batches : available / integer(required, 'Recipe input ' + goodId, 1);
        }
        for (const [goodId, produced] of Object.entries(outputs)) {
          const outputPerBatch = integer(produced, 'Recipe output ' + goodId, 1);
          const inputPerBatch = integer(inputs[goodId] || 0, 'Recipe input ' + goodId);
          const netOutput = outputPerBatch - inputPerBatch;
          const good = (game.goods || []).find(item => item.id === goodId);
          if (!good) throw new Error('Recipe references unknown good ' + goodId + '.');
          if (good.storageCapacity !== null && good.storageCapacity !== undefined && netOutput > 0n) {
            const capacity = integer(good.storageCapacity, 'Storage capacity ' + goodId, 1);
            const availableCapacity = capacity - amount(company.inventory, goodId);
            const capacityBatches = availableCapacity > 0n ? availableCapacity / netOutput : 0n;
            if (capacityBatches < batches) batches = capacityBatches;
          }
        }

        if (batches === 0n) {
          facility.progressDays = days - 1;
          continue;
        }

        const consumed = {};
        const produced = {};
        for (const [goodId, required] of Object.entries(inputs)) {
          const quantity = integer(required, 'Recipe input ' + goodId, 1) * batches;
          company.inventory[goodId] = number(amount(company.inventory, goodId) - quantity,
            'Inventory ' + goodId);
          consumed[goodId] = number(quantity, 'Consumed ' + goodId);
        }
        for (const [goodId, output] of Object.entries(outputs)) {
          const quantity = integer(output, 'Recipe output ' + goodId, 1) * batches;
          company.inventory[goodId] = number(amount(company.inventory, goodId) + quantity,
            'Inventory ' + goodId);
          produced[goodId] = number(quantity, 'Produced ' + goodId);
        }
        facility.progressDays = 0;
        results.push({companyId:company.id, facilityId:facility.id, recipeId:recipe.id,
          batches:number(batches, 'Production batches'), inputsConsumed:consumed, outputsProduced:produced});
      }
    }
    return results;
  }

  function addCompanyTransaction(game, company, currencyId, amountValue, before, after,
    goodId, quantity, unitPrice, type, description, routeId = null) {
    game.companyFinancialTransactions ||= [];
    game.companyFinancialTransactions.push({
      id:id(), companyId:company.id, stateId:company.stateId, currencyId,
      type, amount:amountValue, balanceBefore:before, balanceAfter:after,
      worldDate:game.worldDate, tradeRouteId:routeId, goodId, quantity, unitPrice, description
    });
  }

  function proportionalAllocation(offers, quantity) {
    if (quantity === 0n || offers.length === 0) return offers.map(offer => ({offer, quantity:0n}));
    const total = offers.reduce((sum, offer) => sum + offer.quantity, 0n);
    if (total < quantity) throw new Error('Market allocation exceeds available supply.');
    const allocations = offers.map(offer => ({
      offer, quantity:quantity * offer.quantity / total
    }));
    let remaining = quantity - allocations.reduce((sum, item) => sum + item.quantity, 0n);
    for (let index = 0; remaining > 0n; index++) {
      const allocation = allocations[index];
      if (allocation.quantity >= allocation.offer.quantity) continue;
      allocation.quantity += 1n;
      remaining -= 1n;
    }
    return allocations;
  }

  function proportionalShare(sold, populationDemand, totalDemand) {
    if (sold === 0n || populationDemand === 0n || totalDemand === 0n) return 0n;
    const numerator = sold * populationDemand;
    let share = numerator / totalDemand;
    const remainder = numerator % totalDemand;
    if (remainder * 2n >= totalDemand) share++;
    return share < populationDemand ? share : populationDemand;
  }

  function calculateMarketPrice(market, demand, supply) {
    const minimum = integer(market.minimumPrice, 'Minimum market price', 1);
    const maximum = integer(market.maximumPrice, 'Maximum market price', 1);
    const base = integer(market.basePrice, 'Base market price', 1);
    const current = integer(market.currentPrice, 'Current market price', 1);
    const smoothing = integer(market.priceSmoothingPercent ?? 100, 'Price smoothing', 0);
    if (maximum < minimum || base < minimum || base > maximum || current < minimum ||
        current > maximum || smoothing > 100n)
      throw new Error('Market price configuration is inconsistent.');
    let target;
    if (demand === 0n) target = minimum;
    else if (supply === 0n) target = maximum;
    else {
      target = base * demand / supply;
      if (target < minimum) target = minimum;
      if (target > maximum) target = maximum;
    }
    const difference = target - current;
    let change = difference * smoothing / 100n;
    if (change === 0n && difference !== 0n) change = difference > 0n ? 1n : -1n;
    let next = current + change;
    if (next < minimum) next = minimum;
    if (next > maximum) next = maximum;
    return {before:number(current, 'Market price'), after:number(next, 'Market price')};
  }

  function clearMarkets(game) {
    game.marketHistory ||= [];
    game.companyFinancialTransactions ||= [];
    const territories = new Map(game.territories.map(item => [item.stateId, item]));
    const companies = new Map((game.companies || []).map(item => [item.id, item]));
    const goods = new Map((game.goods || []).map(item => [item.id, item]));
    const blocked = new Map();
    const blockedAmount = (companyId, goodId) => blocked.get(companyId)?.get(goodId) || 0n;
    const addBlocked = (companyId, goodId, quantity) => {
      if (!blocked.has(companyId)) blocked.set(companyId, new Map());
      const values = blocked.get(companyId);
      values.set(goodId, (values.get(goodId) || 0n) + quantity);
    };
    const populationDemand = new Map();

    for (const group of game.populationGroups || []) {
      group.dailyDemandRemainders ||= {};
      const population = integer(group.population, 'Population group', 0);
      for (const need of group.needs || []) {
        const rate = integer(need.dailyQuantityPerThousandPeople, 'Population need ' + need.goodId, 0);
        if (!goods.has(need.goodId)) throw new Error('Population need references unknown good ' + need.goodId + '.');
        const previous = integer(group.dailyDemandRemainders[need.goodId] || 0,
          'Population demand remainder', 0);
        const dailyAmount = population * rate + previous;
        const quantity = dailyAmount / 1000n;
        if (quantity > MAX_SAFE) throw new Error('Population demand exceeds the supported market limit.');
        group.dailyDemandRemainders[need.goodId] = number(dailyAmount % 1000n, 'Population demand remainder');
        const key = group.stateId + '|' + need.goodId;
        populationDemand.set(key, (populationDemand.get(key) || 0n) + quantity);
      }
    }

    const routes = (game.tradeRoutes || []).filter(route => route.enabled !== false)
      .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // Fixed-quantity company contracts settle before open market sales.
    for (const route of routes.filter(item => item.exporterCompanyId)) {
      const exporter = companies.get(route.exporterCompanyId);
      const importer = companies.get(route.importerCompanyId);
      const exportState = territories.get(route.exportStateId);
      const importState = territories.get(route.importStateId);
      const good = goods.get(route.goodId);
      if (!exporter || !importer || !exportState || !importState || !good)
        throw new Error('A bilateral trade route references missing game data.');
      const capacity = integer(route.dailyCapacity, 'Trade route capacity', 0);
      const contracted = integer(route.dailyQuantity, 'Contracted trade quantity', 0);
      const unitPrice = integer(route.unitPrice, 'Contract unit price', 1);
      const exporterStock = amount(exporter.inventory, route.goodId) - blockedAmount(exporter.id, route.goodId);
      const importerStock = amount(importer.inventory, route.goodId);
      const importerCapacity = good.storageCapacity == null
        ? MAX_SAFE - importerStock
        : integer(good.storageCapacity, 'Storage capacity ' + good.id, 1) - importerStock;
      const currencyId = importState.currencyId;
      const buyerCash = integer(importer.cashBalances?.[currencyId] || 0, 'Importer cash');
      const sellerCash = integer(exporter.cashBalances?.[currencyId] || 0, 'Exporter cash');
      const quantity = [contracted, capacity, exporterStock, importerCapacity, buyerCash / unitPrice]
        .reduce((minimum, value) => value < minimum ? value : minimum);
      if (quantity <= 0n) continue;
      const payment = quantity * unitPrice;
      if (sellerCash + payment > MAX_SAFE) throw new Error('Company cash balance would exceed the supported limit.');
      exporter.inventory[route.goodId] = number(amount(exporter.inventory, route.goodId) - quantity,
        'Exporter inventory');
      importer.inventory[route.goodId] = number(importerStock + quantity, 'Importer inventory');
      importer.cashBalances ||= {};
      exporter.cashBalances ||= {};
      importer.cashBalances[currencyId] = number(buyerCash - payment, 'Importer cash');
      exporter.cashBalances[currencyId] = number(sellerCash + payment, 'Exporter cash');
      addBlocked(importer.id, route.goodId, quantity);
      addCompanyTransaction(game, importer, currencyId, -number(payment, 'Trade payment'),
        number(buyerCash, 'Importer cash'), importer.cashBalances[currencyId], route.goodId,
        number(quantity, 'Trade quantity'), number(unitPrice, 'Unit price'), 'TradePurchase',
        'Purchased ' + number(quantity, 'Trade quantity') + ' ' + good.unit + ' ' + good.name +
          ' from ' + exportState.name + '.', route.id);
      addCompanyTransaction(game, exporter, currencyId, number(payment, 'Trade payment'),
        number(sellerCash, 'Exporter cash'), exporter.cashBalances[currencyId], route.goodId,
        number(quantity, 'Trade quantity'), number(unitPrice, 'Unit price'), 'TradeSale',
        'Sold ' + number(quantity, 'Trade quantity') + ' ' + good.unit + ' ' + good.name +
          ' to ' + importState.name + '.', route.id);
      pushActivity(game, 'Contract settled: ' + exporter.name + ' supplied ' +
        number(quantity, 'Trade quantity') + ' ' + good.name + ' to ' + importer.name + '.');
      pushEvent(game, 'economy.trade_completed', importState.stateId,
        'Bilateral contract delivered ' + number(quantity, 'Trade quantity') + ' ' + good.name + '.');
    }

    const markets = (game.markets || []).slice().sort((a, b) => {
      const stateOrder = (territories.get(a.stateId)?.index ?? 0) -
        (territories.get(b.stateId)?.index ?? 0);
      return stateOrder || String(a.goodId).localeCompare(String(b.goodId));
    });
    for (const market of markets) {
      const territory = territories.get(market.stateId);
      const good = goods.get(market.goodId);
      if (!territory || !good) throw new Error('A market references a missing State or good.');
      const key = market.stateId + '|' + market.goodId;
      const groupDemand = populationDemand.get(key) || 0n;
      const baselineDemand = integer(market.dailyDemand, 'Daily market demand', 0);
      const totalDemand = baselineDemand + groupDemand;
      if (totalDemand > MAX_SAFE) throw new Error('Market demand exceeds the supported limit.');

      const offers = [];
      let domesticSupply = 0n;
      let importedSupply = 0n;
      const localCompanies = [...companies.values()]
        .filter(company => company.stateId === market.stateId)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (const company of localCompanies) {
        const available = amount(company.inventory, market.goodId) - blockedAmount(company.id, market.goodId);
        if (available > 0n) {
          offers.push({company, quantity:available, routeId:null});
          domesticSupply += available;
        }
      }

      const publicRoutes = routes.filter(route => route.importStateId === market.stateId &&
        route.goodId === market.goodId && !route.exporterCompanyId &&
        route.exportStateId !== market.stateId);
      const routeReservations = new Map();
      for (const route of publicRoutes) {
        const exporters = [...companies.values()]
          .filter(company => company.stateId === route.exportStateId)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .map(company => ({
            company,
            quantity:amount(company.inventory, market.goodId) - blockedAmount(company.id, market.goodId) -
              (routeReservations.get(company.id) || 0n),
            routeId:route.id
          })).filter(offer => offer.quantity > 0n);
        const capacity = integer(route.dailyCapacity, 'Public trade route capacity', 0);
        const supply = exporters.reduce((sum, offer) => sum + offer.quantity, 0n);
        const routed = supply < capacity ? supply : capacity;
        for (const allocation of proportionalAllocation(exporters, routed)) {
          if (allocation.quantity > 0n) {
            offers.push({company:allocation.offer.company, quantity:allocation.quantity, routeId:route.id});
            routeReservations.set(allocation.offer.company.id,
              (routeReservations.get(allocation.offer.company.id) || 0n) + allocation.quantity);
            importedSupply += allocation.quantity;
          }
        }
      }

      const totalSupply = offers.reduce((sum, offer) => sum + offer.quantity, 0n);
      const price = calculateMarketPrice(market, totalDemand, totalSupply);
      const consumerBudget = integer(market.dailyConsumerBudget || 0, 'Daily consumer budget');
      const affordableDemand = consumerBudget / BigInt(price.after);
      const sold = [totalDemand, totalSupply, affordableDemand]
        .reduce((minimum, value) => value < minimum ? value : minimum);
      const spending = sold * BigInt(price.after);
      const populationSold = proportionalShare(sold, groupDemand, totalDemand);

      for (const allocation of proportionalAllocation(offers, sold)) {
        if (allocation.quantity === 0n) continue;
        const company = allocation.offer.company;
        const currencyId = territory.currencyId;
        const quantity = allocation.quantity;
        const revenue = quantity * BigInt(price.after);
        company.inventory[market.goodId] = number(
          amount(company.inventory, market.goodId) - quantity, 'Company inventory');
        company.cashBalances ||= {};
        const before = integer(company.cashBalances[currencyId] || 0, 'Company cash');
        if (before + revenue > MAX_SAFE) throw new Error('Company cash balance would exceed the supported limit.');
        company.cashBalances[currencyId] = number(before + revenue, 'Company cash');
        const transactionType = allocation.offer.routeId ? 'TradeSale' : 'MarketSale';
        const description = allocation.offer.routeId
          ? 'Exported ' + number(quantity, 'Sold quantity') + ' ' + good.unit + ' ' + good.name +
            ' to ' + territory.name + '.'
          : 'Sold ' + number(quantity, 'Sold quantity') + ' ' + good.unit + ' ' + good.name +
            ' in the domestic market.';
        addCompanyTransaction(game, company, currencyId, number(revenue, 'Sale revenue'),
          number(before, 'Company cash'), company.cashBalances[currencyId], market.goodId,
          number(quantity, 'Sold quantity'), price.after, transactionType, description,
          allocation.offer.routeId);
        if (transactionType === 'TradeSale') {
          pushActivity(game, company.name + ': ' + description);
          pushEvent(game, 'economy.trade_completed', company.stateId, description);
        }
      }

      market.currentPrice = price.after;
      const settlement = {
        stateId:market.stateId, goodId:market.goodId, currencyId:territory.currencyId,
        worldDate:game.worldDate, demand:number(totalDemand, 'Market demand'),
        domesticSupply:number(domesticSupply, 'Domestic supply'),
        importedSupply:number(importedSupply, 'Imported supply'),
        quantitySold:number(sold, 'Quantity sold'),
        unmetDemand:number(totalDemand - sold, 'Unmet demand'),
        priceBefore:price.before, priceAfter:price.after,
        consumerBudget:number(consumerBudget, 'Daily consumer budget'),
        consumerSpending:number(spending, 'Consumer spending'),
        populationDemand:number(groupDemand, 'Population demand'),
        populationQuantitySold:number(populationSold, 'Population quantity sold'),
        populationUnmetDemand:number(groupDemand - populationSold, 'Unmet population demand')
      };
      game.marketHistory.push(settlement);
      const description = territory.name + ' market cleared ' + good.name + ': sold ' +
        settlement.quantitySold + ' of ' + settlement.demand + ' ' + good.unit +
        ' demanded at ' + price.after + ' per ' + good.unit + '; ' +
        settlement.unmetDemand + ' demand unmet.';
      pushActivity(game, description);
      pushEvent(game, 'economy.market_cleared', territory.stateId, description);
    }

    if (game.marketHistory.length > 1000)
      game.marketHistory.splice(0, game.marketHistory.length - 1000);
  }

  function getSettlementMetrics(territory) {
    const buildings = Object.values(territory?.buildings || {});
    const completed = buildings.filter(building => Number(building.daysRemaining || 0) <= 0);
    const sum = key => completed.reduce((total,building) =>
      total + Math.max(0,Number(building[key]) || 0),0);
    const population = Math.max(0,Number(territory?.population) || 0);
    return {
      housingCapacity:Math.max(0,Number(territory?.baseHousingCapacity) || 0)+sum('housingCapacity'),
      foodCapacity:Math.max(0,Number(territory?.baseFoodCapacity) || 0)+sum('foodCapacity'),
      waterCapacity:Math.max(0,Number(territory?.baseWaterCapacity) || 0)+sum('waterCapacity'),
      healthCapacity:sum('healthCapacity'),
      educationCapacity:sum('educationCapacity'),
      jobCapacity:Math.max(0,Number(territory?.baseJobCapacity) || 0)+sum('jobSlots'),
      workingAgePopulation:Math.floor(population * 0.55),
      availableJobs:Math.max(0,Math.max(0,Number(territory?.baseJobCapacity) || 0)+sum('jobSlots'))
    };
  }

  function advanceConstruction(game) {
    for (const territory of game.territories || []) {
      for (const [plot,building] of Object.entries(territory.buildings || {})) {
        const remaining = Number(building.daysRemaining || 0);
        if (!Number.isSafeInteger(remaining) || remaining < 0)
          throw new Error('Building at plot ' + plot + ' has an invalid construction duration.');
        if (remaining === 0) continue;
        building.daysRemaining = remaining - 1;
        if (building.daysRemaining === 0) {
          const description = building.name + ' construction completed in ' + territory.name + '.';
          pushActivity(game,description);
          pushEvent(game,'construction.completed',territory.stateId,description);
        }
      }
    }
  }

  function updateSettlementPopulation(game) {
    for (const territory of game.territories || []) {
      const metrics = getSettlementMetrics(territory);
      Object.assign(territory,metrics);
      if (!territory.ownerPlayerId) {
        territory.populationGrowthLastDay = 0;
        continue;
      }
      const capacity = Math.min(metrics.housingCapacity,metrics.foodCapacity,metrics.waterCapacity);
      const residents = Math.max(0,Number(territory.population) || 0);
      const room = Math.max(0,capacity-residents);
      const growth = room > 0 ? Math.min(room,Math.max(1,Math.floor(residents*0.0015))) : 0;
      territory.population = residents + growth;
      territory.populationGrowthLastDay = growth;
      if (growth > 0) {
        for (const group of game.populationGroups || []) {
          if (group.stateId === territory.stateId)
            group.population = Math.max(0,Number(group.population) || 0) + growth;
        }
      }
      if (growth > 0 && growth >= Math.max(10,Math.floor(residents*0.001))) {
        const description = territory.name + ' population increased by ' + growth.toLocaleString('en-US') + '.';
        pushActivity(game,description);
        pushEvent(game,'population.growth',territory.stateId,description);
      }
    }
  }

  function advanceDay(game) {
    if (!game || !Array.isArray(game.territories) || !Array.isArray(game.players))
      return {ok:false, error:'The host world snapshot is invalid.'};
    try {
      const draft = clone(game);
      if (!Number.isSafeInteger(draft.day) || draft.day < 1 || draft.day >= 2147483647)
        throw new Error('The world reached the supported calendar limit.');
      const date = new Date(String(draft.worldDate) + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime())) throw new Error('The world calendar date is invalid.');
      date.setUTCDate(date.getUTCDate() + 1);
      if (!Number.isFinite(date.getTime())) throw new Error('The world calendar cannot advance further.');
      draft.day++;
      draft.worldDate = date.toISOString().slice(0, 10);

      // Finish work orders first, then update residents and public finance.
      advanceConstruction(draft);
      updateSettlementPopulation(draft);
      accrueGovernmentBalances(draft);
      const production = advanceProduction(draft);
      for (const result of production) {
        const company = draft.companies.find(item => item.id === result.companyId);
        const outputs = Object.entries(result.outputsProduced).map(([goodId, quantity]) => {
          const good = draft.goods.find(item => item.id === goodId);
          return quantity + ' ' + (good?.unit || 'units') + ' ' + (good?.name || goodId);
        });
        const description = company.name + ' completed ' + result.batches +
          ' production batch(es): ' + outputs.join(', ') + '.';
        pushActivity(draft, description);
        pushEvent(draft, 'economy.production_completed', company.stateId, description);
      }
      clearMarkets(draft);

      const dayDescription = draft.worldDate + ' began (day ' + draft.day + ').';
      pushActivity(draft, dayDescription);
      pushEvent(draft, 'world.day_advanced', null, dayDescription);
      draft.worldVersion = (draft.worldVersion || 0) + 1;
      Object.assign(game, draft);
      return {ok:true, day:game.day, productionCount:production.length,
        marketSettlementCount:(game.markets || []).length};
    } catch (error) {
      return {ok:false, error:error?.message || 'The simulation cycle failed.'};
    }
  }

  function createStarterEconomy(territories, createId = id) {
    const goods = [
      {id:'grain',name:'Grain',unit:'tonnes',category:'Resource',storageCapacity:50000},
      {id:'flour',name:'Flour',unit:'tonnes',category:'Intermediate',storageCapacity:25000},
      {id:'timber',name:'Timber',unit:'tonnes',category:'Resource',storageCapacity:30000},
      {id:'tools',name:'Tools',unit:'items',category:'Capital',storageCapacity:12000}
    ];
    const productionRecipes = [
      {id:'grow-grain',name:'Grain harvest',daysPerBatch:1,inputs:{},outputs:{grain:300}},
      {id:'mill-flour',name:'Flour milling',daysPerBatch:1,inputs:{grain:100},outputs:{flour:100}},
      {id:'harvest-timber',name:'Timber harvest',daysPerBatch:1,inputs:{},outputs:{timber:50}},
      {id:'forge-tools',name:'Tool manufacturing',daysPerBatch:1,inputs:{timber:20},outputs:{tools:10}}
    ];
    const companies = [];
    const markets = [];
    const populationGroups = [];
    const companyDefinitions = [
      {id:'farm',name:'Agricultural Cooperative',sector:'Agriculture',
        inventory:{grain:40},recipeId:'grow-grain',batchesPerCycle:1},
      {id:'mill',name:'Flour Mill',sector:'Food processing',
        inventory:{grain:100,flour:8},recipeId:'mill-flour',batchesPerCycle:1},
      {id:'sawmill',name:'Timber Works',sector:'Forestry',
        inventory:{timber:20},recipeId:'harvest-timber',batchesPerCycle:1},
      {id:'foundry',name:'Tool Foundry',sector:'Manufacturing',
        inventory:{timber:30,tools:2},recipeId:'forge-tools',batchesPerCycle:1}
    ];
    for (const territory of territories) {
      const currencyId = territory.currencyId;
      for (const definition of companyDefinitions) {
        const companyId = createId();
        const inventory = {grain:0,flour:0,timber:0,tools:0,...definition.inventory};
        const facilities = [{
          id:createId(),recipeId:definition.recipeId,batchesPerCycle:definition.batchesPerCycle,progressDays:0
        }];
        companies.push({
          id:companyId,stateId:territory.stateId,currencyId,
          cashBalances:{[currencyId]:5000},
          name:definition.name + ' — ' + territory.name,sector:definition.sector,
          inventory,facilities
        });
      }
      populationGroups.push({
        id:createId(),stateId:territory.stateId,name:'Households',
        population:territory.population,
        needs:[
          {goodId:'grain',dailyQuantityPerThousandPeople:1},
          {goodId:'flour',dailyQuantityPerThousandPeople:1}
        ],
        dailyDemandRemainders:{}
      });
      for (const goodId of ['grain','flour','tools']) {
        markets.push({
          stateId:territory.stateId,goodId,
          dailyDemand:goodId === 'tools' ? Math.max(1,Math.floor(territory.population / 10000)) : 0,
          dailyConsumerBudget:25000,
          basePrice:10,currentPrice:10,minimumPrice:2,maximumPrice:60,
          priceSmoothingPercent:25
        });
      }
    }
    return {
      goods,productionRecipes,companies,markets,tradeRoutes:[],populationGroups,
      economyVersion:1
    };
  }

  const api = Object.freeze({advanceDay, createStarterEconomy, getSettlementMetrics});
  globalThis.NewWorldSimulation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();