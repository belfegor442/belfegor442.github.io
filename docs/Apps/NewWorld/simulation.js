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
      territory.monthlyBalance = monthlyBalance;
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

        let progressIncrement=1;
        const defaultWorkers=defaultCompanyLabor(company.sector).workers;
        const workersRequired=safeLaborCount(facility.workersRequired,
          'Facility workers required',defaultWorkers);
        const employees=safeLaborCount(facility.employees,'Facility employees',0);
        if(workersRequired>0) {
          if(employees>workersRequired)
            throw new Error('Facility staffing exceeds its configured workforce requirement.');
          const previousProgress=safeLaborCount(facility.laborProgress,
            'Facility labour progress',0);
          if(previousProgress>=1000)
            throw new Error('Facility labour progress is outside the supported range.');
          const previousRemainder=safeLaborCount(facility.laborRemainder,
            'Facility labour remainder',0)%workersRequired;
          const workNumerator=BigInt(employees)*1000n+BigInt(previousRemainder);
          const earnedUnits=workNumerator/BigInt(workersRequired);
          facility.laborRemainder=number(workNumerator%BigInt(workersRequired),
            'Facility labour remainder');
          const accumulated=BigInt(previousProgress)+earnedUnits;
          progressIncrement=Number(accumulated/1000n);
          facility.laborProgress=number(accumulated%1000n,'Facility labour progress');
        }
        if(progressIncrement===0) continue;
        const progress=progressDays+progressIncrement;
        if(progress<days) {
          facility.progressDays=progress;
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
          const reserveKey={timber:'timber',ore:'ore',stone:'stone'}[goodId];
          const resourceReserves=(game.civicSystems||[])
            .find(item=>item.stateId===company.stateId)?.agriculture?.resourceReserves;
          if(reserveKey && resourceReserves) {
            const available=integer(resourceReserves[reserveKey]||0,'Natural reserve '+reserveKey);
            const resourceBatches=available/outputPerBatch;
            if(resourceBatches<batches) batches=resourceBatches;
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
    game.populationFinancialTransactions ||= [];    const populationDemand = new Map();

    for (const group of game.populationGroups || []) {
      group.dailyDemandRemainders ||= {};
      group.dailyDemandToday = {};
      group.dailyNeedsOutcome = {
        worldDate:game.worldDate,requested:0,fulfilled:0,unmet:0,satisfactionPercent:null
      };
      const population = integer(group.population, 'Population group', 0);
      group.cashBalances ||= {};
      group.dailyConsumptionSpendingToday=0;
      group.dailyWageIncomeToday=integer(group.dailyWageIncomeToday||0,'Daily household wage income');
      const territory=territories.get(group.stateId);
      const currencyId=territory?.currencyId;
      if(currencyId && !Object.hasOwn(group.cashBalances,currencyId)) {
        const openingBalance=population/10n;
        group.cashBalances[currencyId]=number(openingBalance,'Opening household cash');
        group.openingCashGranted=true;
        if(openingBalance>0n) game.populationFinancialTransactions.push({
          id:id(),stateId:group.stateId,populationGroupId:group.id,currencyId,
          type:'OpeningBalance',amount:number(openingBalance,'Opening household cash'),
          balanceBefore:0,balanceAfter:number(openingBalance,'Opening household cash'),
          worldDate:game.worldDate,day:game.day,
          description:'Opening household cash reserve for the market economy.'
        });
      } else if(currencyId) {
        integer(group.cashBalances[currencyId]??0,'Household cash balance');
      }
      for (const need of group.needs || []) {
        const rate = integer(need.dailyQuantityPerThousandPeople, 'Population need ' + need.goodId, 0);
        if (!goods.has(need.goodId)) throw new Error('Population need references unknown good ' + need.goodId + '.');
        const previous = integer(group.dailyDemandRemainders[need.goodId] || 0,
          'Population demand remainder', 0);
        const dailyAmount = population * rate + previous;
        const quantity = dailyAmount / 1000n;
        if (quantity > MAX_SAFE) throw new Error('Population demand exceeds the supported market limit.');
        group.dailyDemandRemainders[need.goodId] = number(dailyAmount % 1000n, 'Population demand remainder');
        const previousNeed = integer(group.dailyDemandToday[need.goodId] || 0,
          'Daily group demand ' + need.goodId);
        group.dailyDemandToday[need.goodId] = number(
          previousNeed + quantity,'Daily group demand ' + need.goodId);
        const key = group.stateId + '|' + need.goodId;
        populationDemand.set(key, (populationDemand.get(key) || 0n) + quantity);
      }
    }

    const routes = (game.tradeRoutes || []).filter(route => route.enabled !== false)
      .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // Fixed-quantity company contracts settle before open market sales.
    for (const route of routes.filter(item => item.enabled !== false && item.exporterCompanyId)) {
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

      const publicRoutes = routes.filter(route => route.enabled !== false &&
        route.importStateId === market.stateId &&
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
      const consumerBudget=integer(market.dailyConsumerBudget||0,'Daily consumer budget');
      const groupOffers=(game.populationGroups || [])
        .filter(group=>group.stateId===market.stateId)
        .map(group=>{
          const requested=integer(group.dailyDemandToday?.[market.goodId]||0,
            'Daily group demand '+market.goodId);
          const cash=integer(group.cashBalances?.[territory.currencyId]??0,
            'Household cash balance');
          const affordable=cash/BigInt(price.after);
          return {group,requested,quantity:requested<affordable?requested:affordable};
        }).filter(item=>item.requested>0n);
      const affordableGroupDemand=groupOffers.reduce((sum,item)=>sum+item.quantity,0n);
      const budgetAffordable=consumerBudget/BigInt(price.after);
      const affordableBaselineDemand=baselineDemand<budgetAffordable
        ?baselineDemand:budgetAffordable;
      const totalAffordableDemand=affordableGroupDemand+affordableBaselineDemand;
      const sold=[totalDemand,totalSupply,totalAffordableDemand]
        .reduce((minimum,value)=>value<minimum?value:minimum);
      const spending=sold*BigInt(price.after);
      const populationSold=sold===totalDemand
        ?groupDemand:proportionalShare(sold,affordableGroupDemand,totalAffordableDemand);
      if(groupDemand>0n) {
        for(const allocation of proportionalAllocation(groupOffers,populationSold)) {
          const group=allocation.offer.group;
          const requested=allocation.offer.requested;
          const fulfilled=allocation.quantity;
          const unmet=requested-fulfilled;
          const payment=fulfilled*BigInt(price.after);
          const currencyId=territory.currencyId;
          group.cashBalances ||= {};
          const balanceBefore=integer(group.cashBalances[currencyId]??0,
            'Household cash before purchase');
          if(payment>balanceBefore)
            throw new Error('Household purchases exceed the available cash balance.');
          const balanceAfter=number(balanceBefore-payment,'Household cash after purchase');
          if(payment>0n) group.cashBalances[currencyId]=balanceAfter;
          const paymentNumber=number(payment,'Household purchase payment');
          group.dailyConsumptionSpendingToday=number(
            BigInt(integer(group.dailyConsumptionSpendingToday||0,'Daily household spending'))+
              payment,'Daily household spending');
          group.cumulativeConsumptionSpending=number(
            BigInt(integer(group.cumulativeConsumptionSpending||0,'Cumulative household spending'))+
              payment,'Cumulative household spending');
          if(payment>0n) game.populationFinancialTransactions.push({
            id:id(),stateId:group.stateId,populationGroupId:group.id,currencyId,
            type:'Consumption',amount:-paymentNumber,goodId:market.goodId,
            quantity:number(fulfilled,'Household quantity purchased'),unitPrice:price.after,
            balanceBefore:number(balanceBefore,'Household cash before purchase'),
            balanceAfter,worldDate:game.worldDate,day:game.day,
            description:'Household group purchased '+good.name+' in the domestic market.'
          });
          group.dailyNeedsOutcome ||= {
            worldDate:game.worldDate,requested:0,fulfilled:0,unmet:0,satisfactionPercent:null
          };
          group.dailyNeedsOutcome.requested=number(
            BigInt(group.dailyNeedsOutcome.requested||0)+requested,'Group daily needs');
          group.dailyNeedsOutcome.fulfilled=number(
            BigInt(group.dailyNeedsOutcome.fulfilled||0)+fulfilled,'Group fulfilled needs');
          group.dailyNeedsOutcome.unmet=number(
            BigInt(group.dailyNeedsOutcome.unmet||0)+unmet,'Group unmet needs');
          group.dailyNeedsStatus ||= {};
          group.dailyNeedsStatus[market.goodId]={
            worldDate:game.worldDate,requested:number(requested,'Group need demand'),
            fulfilled:number(fulfilled,'Group need fulfilment'),
            unmet:number(unmet,'Group unmet demand'),
            satisfactionPercent:requested>0n?Number(fulfilled*100n/requested):100
          };
        }
      }
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
        const civicState=(game.civicSystems||[]).find(item=>item.stateId===company.stateId);
        const taxRate=BigInt(civicState
          ? Math.max(0,Math.min(300,Math.floor(Number(civicState.administration?.taxRatePermille ?? 55))))
          : 0);
        const salesTax=revenue*taxRate/1000n;
        if(salesTax>0n) {
          const companyBeforeTax=integer(company.cashBalances[currencyId]||0,'Company cash before sales tax');
          if(salesTax>companyBeforeTax) throw new Error('Sales tax exceeds the company cash balance.');
          const companyAfterTax=number(BigInt(companyBeforeTax)-salesTax,'Company cash after sales tax');
          company.cashBalances[currencyId]=companyAfterTax;
          const taxAmount=number(salesTax,'Collected sales tax');
          const taxRecipient=territories.get(company.stateId);
          if(!taxRecipient) throw new Error('Sales tax recipient State is unavailable.');
          const treasuryBefore=integer(taxRecipient.treasury||0,'State treasury');
          const treasuryAfter=treasuryBefore+salesTax;
          if(treasuryAfter>MAX_SAFE) throw new Error('State treasury would exceed the supported limit after tax collection.');
          taxRecipient.treasury=number(treasuryAfter,'State treasury after sales tax');
          addCompanyTransaction(game,company,currencyId,-taxAmount,companyBeforeTax,
            companyAfterTax,market.goodId,0,0,'SalesTax',
            'Public sales tax withheld at '+taxRate+' per mille.');
          game.financialTransactions ||= [];
          game.financialTransactions.push({
            id:id(),stateId:company.stateId,currencyId,type:'marketSalesTax',
            amount:taxAmount,balanceBefore:number(treasuryBefore,'Treasury before tax'),
            balanceAfter:number(treasuryAfter,'Treasury after tax'),
            description:'Sales tax collected from '+company.name+'.',
            worldDate:game.worldDate,recordedAtUtc:new Date().toISOString(),
            orderId:null,membershipId:null
          });
          pushEvent(game,'finance.sales_tax_collected',company.stateId,
            company.name+' paid '+taxAmount+' in public sales tax.');
        }
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

    for (const group of game.populationGroups || []) {
      const outcome=group.dailyNeedsOutcome;
      if (outcome && outcome.requested>0) {
        outcome.satisfactionPercent=Math.floor(outcome.fulfilled*100/outcome.requested);
      }
    }

    if (game.populationFinancialTransactions.length > 2000)
      game.populationFinancialTransactions.splice(0,game.populationFinancialTransactions.length-2000);
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

  function initializeDemography(territory) {
    const population = Math.max(0, Number(territory.population) || 0);
    const bands = [
      {start:0,end:14,share:0.25},
      {start:15,end:64,share:0.65},
      {start:65,end:100,share:0.10}
    ];
    const cohorts = Array.from({length:101},(_,age)=>({
      age,population:0,agingRemainder:0,deathRemainder:0
    }));
    let assigned = 0;
    for (const band of bands) {
      const amount = Math.floor(population * band.share);
      const perAge = Math.floor(amount / (band.end-band.start+1));
      for (let age=band.start;age<=band.end;age++) {
        cohorts[age].population = perAge;
        assigned += perAge;
      }
    }
    cohorts[40].population += population-assigned;
    territory.demography = {
      version:1,cohorts,birthRatePerThousandYear:18,
      migrationNetPerThousandYear:0,birthRemainder:0,
      migrationRemainder:0,totalBirths:0,totalDeaths:0,
      netMigration:0
    };
    return territory.demography;
  }

  function advanceDemography(territory) {
    const profile = territory.demography || initializeDemography(territory);
    if (!Array.isArray(profile.cohorts) || profile.cohorts.length !== 101)
      throw new Error('Demography requires exactly 101 age cohorts.');
    const rate = (value,label,min,max) => {
      const n=Number(value);
      if (!Number.isFinite(n) || n<min || n>max)
        throw new Error(label+' is outside its supported range.');
      return n;
    };
    const birthRate=rate(profile.birthRatePerThousandYear ?? 18,'Birth rate',0,100);
    const migrationRate=rate(profile.migrationNetPerThousandYear ?? 0,'Net migration rate',-500,500);
    let population=0,births=0,deaths=0;
    for (const cohort of profile.cohorts) {
      if (!Number.isSafeInteger(cohort.population) || cohort.population<0)
        throw new Error('Demographic cohort population must be a non-negative safe integer.');
      population += cohort.population;
    }
    const birthNumerator=population*birthRate+(Number(profile.birthRemainder)||0);
    births=Math.floor(birthNumerator/365000);
    profile.birthRemainder=birthNumerator%365000;
    const migrationNumerator=population*migrationRate+(Number(profile.migrationRemainder)||0);
    const migration=Math.trunc(migrationNumerator/365000);
    profile.migrationRemainder=migrationNumerator-migration*365000;

    const moved=Array(101).fill(0);
    for (let age=100;age>=0;age--) {
      const cohort=profile.cohorts[age];
      const annualDeathRate=age<15?4:age<65?2:35;
      const deathNumerator=cohort.population*annualDeathRate+(Number(cohort.deathRemainder)||0);
      const cohortDeaths=Math.min(cohort.population,Math.floor(deathNumerator/365000));
      cohort.deathRemainder=deathNumerator%365000;
      deaths+=cohortDeaths;
      const survivors=cohort.population-cohortDeaths;
      if (age===100) {
        moved[age]+=survivors;
        continue;
      }
      const agingNumerator=survivors+(Number(cohort.agingRemainder)||0);
      const aged=Math.floor(agingNumerator/365);
      cohort.agingRemainder=agingNumerator%365;
      moved[age]+=survivors-aged;
      moved[age+1]+=aged;
    }
    moved[0]+=births;
    if (migration>=0) moved[30]+=migration;
    else {
      let toRemove=-migration;
      for (const age of [30,25,40,20,50,15,60,65,10,70,5,80,0,90,100]) {
        const removed=Math.min(moved[age],toRemove);
        moved[age]-=removed;
        toRemove-=removed;
        if (!toRemove) break;
      }
    }
    profile.cohorts=moved.map((count,age)=>({
      age,population:count,
      agingRemainder:Number(profile.cohorts[age]?.agingRemainder)||0,
      deathRemainder:Number(profile.cohorts[age]?.deathRemainder)||0
    }));
    profile.totalBirths=(Number(profile.totalBirths)||0)+births;
    profile.totalDeaths=(Number(profile.totalDeaths)||0)+deaths;
    profile.netMigration=(Number(profile.netMigration)||0)+migration;
    const nextPopulation=moved.reduce((sum,value)=>sum+value,0);
    const delta=nextPopulation-population;
    territory.population=nextPopulation;
    territory.populationGrowthLastDay=delta;
    const sum=(start,end)=>moved.slice(start,end+1).reduce((a,b)=>a+b,0);
    territory.demographicIndicators={
      children:sum(0,14),workingAge:sum(15,64),seniors:sum(65,100),
      birthsLastDay:births,deathsLastDay:deaths,netMigrationLastDay:migration,
      dependencyRatio:sum(15,64)>0
        ? Math.round((sum(0,14)+sum(65,100))*1000/sum(15,64))/10: null
    };
    return {births,deaths,migration,delta,population:nextPopulation};
  }

  function updateSettlementPopulation(game) {
    for (const territory of game.territories || []) {
      const demographicResult = territory.demography && territory.ownerPlayerId
        ? advanceDemography(territory) : null;
      const metrics = getSettlementMetrics(territory);
      if (territory.demographicIndicators)
        metrics.workingAgePopulation = territory.demographicIndicators.workingAge;
      Object.assign(territory,metrics);
      if (!territory.ownerPlayerId) {
        territory.populationGrowthLastDay = 0;
        continue;
      }
      const capacity = Math.min(metrics.housingCapacity,metrics.foodCapacity,metrics.waterCapacity);
      const residents = Math.max(0,Number(territory.population) || 0);
      const room = Math.max(0,capacity-residents);
      const growthBonus = globalThis.NewWorldStrategy?.effectValue?.(game,territory.stateId,'population_growth_bonus') || 0;
      const growth = demographicResult
        ? demographicResult.delta
        : room > 0
          ? Math.min(room,Math.max(1,Math.floor(residents*0.0015*(1+growthBonus))))
          : 0;
      if (!demographicResult) {
        territory.population = residents + growth;
        territory.populationGrowthLastDay = growth;
        if (growth > 0 && !territory.demography) initializeDemography(territory);
      }

      const coverage = (available,needed) => needed <= 0
        ? 1
        : Math.max(0,Math.min(1,available/needed));
      const housingCoverage = coverage(metrics.housingCapacity,residents);
      const foodCoverage = coverage(metrics.foodCapacity,residents);
      const waterCoverage = coverage(metrics.waterCapacity,residents);
      const healthCoverage = coverage(metrics.healthCapacity,residents*.25);
      const educationCoverage = coverage(metrics.educationCapacity,metrics.workingAgePopulation*.45);
      const employmentCoverage = coverage(metrics.availableJobs,metrics.workingAgePopulation);
      const prosperityChange =
        (housingCoverage-.90)*.25 +
        (foodCoverage-.90)*.45 +
        (waterCoverage-.90)*.45 +
        (healthCoverage-.50)*.20 +
        (educationCoverage-.50)*.10 +
        (employmentCoverage-.70)*.30;
      const roundedProsperityChange = Math.round(prosperityChange*100)/100;
      territory.housingCoverage = Math.round(housingCoverage*100);
      territory.foodCoverage = Math.round(foodCoverage*100);
      territory.waterCoverage = Math.round(waterCoverage*100);
      territory.healthCoverage = Math.round(healthCoverage*100);
      territory.educationCoverage = Math.round(educationCoverage*100);
      territory.employmentCoverage = Math.round(employmentCoverage*100);
      territory.prosperityChangeLastDay = roundedProsperityChange;
      territory.prosperity = Math.max(0,Math.min(100,
        (Number(territory.prosperity)||0)+roundedProsperityChange));

      if (growth !== 0) {
        for (const group of game.populationGroups || []) {
          if (group.stateId === territory.stateId)
            group.population = Math.max(0,(Number(group.population) || 0) + growth);
        }
      }
      if (demographicResult && (demographicResult.births || demographicResult.deaths || demographicResult.migration)) {
        const description = territory.name + ' demographic update: ' +
          demographicResult.births + ' births, ' + demographicResult.deaths +
          ' deaths and net migration of ' + demographicResult.migration + '.';
        pushActivity(game,description);
        pushEvent(game,'population.demographic_update',territory.stateId,description);
      } else if (growth > 0 && growth >= Math.max(10,Math.floor(residents*0.001))) {
        const description = territory.name + ' population increased by ' + growth.toLocaleString('en-US') + '.';
        pushActivity(game,description);
        pushEvent(game,'population.growth',territory.stateId,description);
      }
    }
  }

  function evaluateWorldEvents(game) {
    game.eventDefinitions ||= [];
    game.eventOccurrences ||= [];
    const occurred = [];
    const latestDayFor = (definitionId,stateId) => (game.eventOccurrences || [])
      .filter(item => item.definitionId===definitionId && (item.stateId || null)===(stateId || null))
      .reduce((latest,item) => Math.max(latest,Number(item.day)||0),0);

    for (const definition of game.eventDefinitions) {
      if (definition.enabled===false) continue;
      const trigger=definition.trigger || {};
      const stateId=definition.stateId || trigger.stateId || null;
      let matched=false;
      let cause='';
      if (trigger.type==='marketShortage') {
        if(!stateId || !trigger.goodId)
          throw new Error('Market-shortage events require a State ID and good ID.');
        const minimum=integer(trigger.minimumUnmetDemand,'Event minimum unmet demand',1);
        const latest=(game.marketHistory || []).find(item =>
          item.stateId===stateId && item.goodId===trigger.goodId && item.worldDate===game.worldDate);
        if (latest && latest.unmetDemand>=minimum) {
          matched=true;
          cause='Market shortage: '+latest.unmetDemand+' '+trigger.goodId+
            ' units of demand were unmet.';
        }
      } else if (trigger.type==='treasuryBelow') {
        if(!stateId) throw new Error('Treasury events require a State ID.');
        const territory=(game.territories || []).find(item => item.stateId===stateId);
        const threshold=integer(trigger.threshold,'Event treasury threshold',0);
        if (territory && Number(territory.treasury)<=Number(threshold)) {
          matched=true;
          cause='Public treasury fell to '+territory.treasury+'.';
        }
      } else if (trigger.type==='prosperityBelow') {
        if(!stateId) throw new Error('Prosperity events require a State ID.');
        const territory=(game.territories || []).find(item => item.stateId===stateId);
        const threshold=integer(trigger.threshold,'Event prosperity threshold',0);
        if (territory && Number(territory.prosperity)<=Number(threshold)) {
          matched=true;
          cause='Territorial prosperity fell to '+territory.prosperity+'.';
        }
      } else if (trigger.type==='warActive') {
        if(Boolean(trigger.stateAId)!==Boolean(trigger.stateBId))
          throw new Error('War events must define both State IDs or neither.');
        const relation=(game.diplomaticRelations || []).find(item =>
          item.status==='war' && (!trigger.stateAId || !trigger.stateBId ||
            (item.stateAId===trigger.stateAId && item.stateBId===trigger.stateBId) ||
            (item.stateAId===trigger.stateBId && item.stateBId===trigger.stateAId)));
        if (relation) {
          matched=true;
          cause='An active war is recorded between two States.';
        }
      } else {
        throw new Error('World event '+String(definition.id||'unknown')+
          ' uses an unsupported trigger type.');
      }
      if (!matched) continue;
      const eventId=String(definition.id || '').trim();
      const title=String(definition.title || '').trim();
      const description=String(definition.description || '').trim();
      if (!eventId || !title || !description)
        throw new Error('Every enabled world event requires an ID, title and description.');
      const lastDay=latestDayFor(eventId,stateId);
      const repeatInterval=definition.repeatIntervalDays == null
        ? 0 : integer(definition.repeatIntervalDays,'Event repeat interval',1);
      if (lastDay && (!repeatInterval || game.day-lastDay<Number(repeatInterval))) continue;

      const occurrence={
        id:id(),definitionId:eventId,gameId:game.id,stateId,
        category:String(definition.category || 'general'),
        severity:String(definition.severity || 'information'),
        title,description,cause,worldDate:game.worldDate,day:game.day,
        status:'recorded'
      };
      game.eventOccurrences.push(occurrence);
      occurred.push(occurrence);
      pushActivity(game,title+': '+description+' Cause: '+cause);
      pushEvent(game,'world_event.occurred',stateId,title+'. '+description+' Cause: '+cause);
    }

    if (game.eventOccurrences.length>1000)
      game.eventOccurrences.splice(0,game.eventOccurrences.length-1000);
    return occurred;
  }

  function defaultCompanyLabor(sector) {
    const profiles = {
      'Agriculture':{workers:6,wage:2},
      'Food processing':{workers:5,wage:3},
      'Forestry':{workers:4,wage:2},
      'Mining':{workers:7,wage:3},
      'Manufacturing':{workers:5,wage:4}
    };
    return profiles[sector] || {workers:4,wage:2};
  }

  function safeLaborCount(value,label,fallback=0) {
    const result=value === undefined || value === null ? fallback : value;
    if (!Number.isSafeInteger(result) || result < 0)
      throw new Error(label + ' must be a non-negative safe integer.');
    return result;
  }

  function allocateCompanyWorkforce(game) {
    const territories = new Map((game.territories || []).map(item => [item.stateId,item]));
    const slotsByState = new Map();
    for (const territory of game.territories || []) {
      territory.companyEmployees=0;
      territory.companyWorkersRequired=0;
      territory.companyVacancies=0;
      territory.dailyPayrollDue=0;
      territory.dailyPayrollPaid=0;
      territory.wageArrears=0;
      territory.householdWageIncomeToday=0;
    }

    for (const company of game.companies || []) {
      const profile=defaultCompanyLabor(company.sector);
      company.facilities ||= [];
      let requiredTotal=0;
      const companySlots=[];
      for (const facility of company.facilities) {
        const required=safeLaborCount(facility.workersRequired,'Facility workers required',profile.workers);
        const wage=safeLaborCount(facility.dailyWage,'Facility daily wage',profile.wage);
        if (required>0 && wage===0)
          throw new Error('A staffed facility must have a positive daily wage.');
        requiredTotal+=required;
        if (!Number.isSafeInteger(requiredTotal))
          throw new Error('Company workforce demand exceeds the supported limit.');
        facility.workersRequired=required;
        facility.dailyWage=wage;
        facility.employees=0;
        companySlots.push({company,facility,required,remainder:0n});
      }
      company.workforce={
        workersRequired:requiredTotal,employees:0,vacancies:requiredTotal,
        averageDailyWage:0,dailyPayrollDue:0,dailyPayrollPaid:0,
        wageArrears:safeLaborCount(company.wageArrears,'Company wage arrears',
          safeLaborCount(company.workforce?.wageArrears,'Recorded wage arrears',0))
      };
      const territory=territories.get(company.stateId);
      if (territory) {
        const slots=slotsByState.get(company.stateId) || [];
        slots.push(...companySlots);
        slotsByState.set(company.stateId,slots);
        territory.companyWorkersRequired+=requiredTotal;
        if (!Number.isSafeInteger(territory.companyWorkersRequired))
          throw new Error('State private-sector workforce demand exceeds the supported limit.');
      }
    }

    for (const territory of game.territories || []) {
      const slots=slotsByState.get(territory.stateId) || [];
      const totalDemand=slots.reduce((sum,item)=>sum+item.required,0);
      const workingAge=safeLaborCount(territory.workingAgePopulation,
        'State working-age population',Math.floor(Math.max(0,Number(territory.population)||0)*.55));
      const jobCapacity=safeLaborCount(territory.jobCapacity,'State job capacity',0);
      const available=Math.min(workingAge,jobCapacity);
      const allocated=Math.min(available,totalDemand);
      if (allocated===totalDemand) {
        for (const item of slots) item.facility.employees=item.required;
      } else if (allocated>0 && totalDemand>0) {
        let assigned=0;
        for (const item of slots) {
          const numerator=BigInt(allocated)*BigInt(item.required);
          const base=Number(numerator/BigInt(totalDemand));
          item.remainder=numerator%BigInt(totalDemand);
          item.facility.employees=base;
          assigned+=base;
        }
        let remaining=allocated-assigned;
        const ranked=slots.slice().sort((a,b) =>
          a.remainder===b.remainder
            ? String(a.company.id).localeCompare(String(b.company.id)) ||
              String(a.facility.id).localeCompare(String(b.facility.id))
            : a.remainder>b.remainder?-1:1);
        for (const item of ranked) {
          if (remaining<=0) break;
          if (item.facility.employees<item.required) {
            item.facility.employees++;
            remaining--;
          }
        }
      }

      const employeesByCompany=new Map();
      for (const item of slots) {
        const previous=employeesByCompany.get(item.company.id) || 0;
        const employees=previous+item.facility.employees;
        if (!Number.isSafeInteger(employees))
          throw new Error('Company employee count exceeds the supported limit.');
        employeesByCompany.set(item.company.id,employees);
      }
      for (const company of game.companies || []) {
        if (company.stateId!==territory.stateId) continue;
        const employees=employeesByCompany.get(company.id) || 0;
        company.workforce.employees=employees;
        company.workforce.vacancies=company.workforce.workersRequired-employees;
        territory.companyEmployees+=employees;
        territory.companyVacancies+=company.workforce.vacancies;
      }
      if (territory.companyEmployees>available)
        throw new Error('Private-sector staffing exceeds the State workforce or job capacity.');
    }
  }

  function settleCompanyPayroll(game) {
    game.companyFinancialTransactions ||= [];
    let totalDue=0n,totalPaid=0n,totalArrears=0n,transactionCount=0;
    game.populationFinancialTransactions ||= [];
    for (const group of game.populationGroups || []) group.dailyWageIncomeToday=0;
    const stateTotals=new Map((game.territories || []).map(item=>[item.stateId,{
      due:0n,paid:0n,arrears:0n,employees:0
    }]));
    for (const company of game.companies || []) {
      const territory=(game.territories || []).find(item=>item.stateId===company.stateId);
      const currencyId=company.currencyId || territory?.currencyId || null;
      let dailyDue=0n,employees=0;
      for (const facility of company.facilities || []) {
        const staff=BigInt(safeLaborCount(facility.employees,'Facility employees',0));
        const wage=BigInt(safeLaborCount(facility.dailyWage,'Facility daily wage',0));
        dailyDue+=staff*wage;
        employees+=Number(staff);
      }
      const previousArrears=integer(company.wageArrears ??
        company.workforce?.wageArrears ?? 0,'Company wage arrears');
      const liability=previousArrears+dailyDue;
      const dueNumber=number(dailyDue,'Daily company payroll');
      company.cashBalances ||= {};
      const balanceBefore=currencyId
        ?integer(company.cashBalances[currencyId] ?? 0,'Company cash for payroll'):0n;
      const paid=currencyId?(balanceBefore<liability?balanceBefore:liability):0n;
      const balanceAfter=balanceBefore-paid;
      const arrears=liability-paid;
      if(currencyId) company.cashBalances[currencyId]=number(balanceAfter,'Company cash after payroll');
      company.wageArrears=number(arrears,'Outstanding company wages');
      company.workforce ||= {};
      const workersRequired=safeLaborCount(company.workforce.workersRequired,'Company workers required',0);
      Object.assign(company.workforce,{
        workersRequired,employees,vacancies:Math.max(0,workersRequired-employees),
        averageDailyWage:employees>0?Math.round(dueNumber/employees):0,
        dailyPayrollDue:dueNumber,dailyPayrollPaid:number(paid,'Company payroll paid'),
        wageArrears:company.wageArrears
      });
      company.payrollLastDay=game.day;
      if (paid>0n) {
        const paidNumber=number(paid,'Company payroll paid');
        addCompanyTransaction(game,company,currencyId,-paidNumber,
          number(balanceBefore,'Company cash before payroll'),company.cashBalances[currencyId],
          null,employees,employees>0?Math.round(dueNumber/employees):0,'Payroll',
          'Paid wages to '+employees+' employee(s), including outstanding wage liabilities.');
        transactionCount++;
      }
      if (arrears>previousArrears && previousArrears===0n) {
        pushEvent(game,'economy.wage_arrears',company.stateId,
          company.name+' could not meet its full payroll; '+number(arrears,'Wage arrears')+
          ' remains owed to employees.');
      } else if (previousArrears>0n && arrears===0n) {
        pushEvent(game,'economy.wage_arrears_cleared',company.stateId,
          company.name+' has paid all outstanding wage arrears.');
      }
      const state=stateTotals.get(company.stateId);
      if (state) {
        state.due+=dailyDue;
        state.paid+=paid;
        state.arrears+=arrears;
        state.employees+=employees;
      }
      totalDue+=dailyDue;
      totalPaid+=paid;
      totalArrears+=arrears;
    }

    for (const territory of game.territories || []) {
      const totals=stateTotals.get(territory.stateId) || {due:0n,paid:0n,arrears:0n,employees:0};
      territory.dailyPayrollDue=number(totals.due,'State daily payroll due');
      territory.dailyPayrollPaid=number(totals.paid,'State daily payroll paid');
      territory.wageArrears=number(totals.arrears,'State wage arrears');
      territory.householdWageIncomeToday=territory.dailyPayrollPaid;
      const recipients=(game.populationGroups || [])
        .filter(group=>group.stateId===territory.stateId)
        .map(group=>({
          group,population:BigInt(safeLaborCount(group.population,'Household population',0)),
          amount:0n,remainder:0n
        })).filter(item=>item.population>0n);
      const totalPopulation=recipients.reduce((sum,item)=>sum+item.population,0n);
      let distributed=0n;
      if(totalPopulation>0n && totals.paid>0n) {
        for(const item of recipients) {
          const numerator=totals.paid*item.population;
          item.amount=numerator/totalPopulation;
          item.remainder=numerator%totalPopulation;
          distributed+=item.amount;
        }
        let remaining=totals.paid-distributed;
        const ranked=recipients.slice().sort((a,b)=>
          a.remainder===b.remainder
            ?String(a.group.id).localeCompare(String(b.group.id))
            :a.remainder>b.remainder?-1:1);
        for(const item of ranked) {
          if(remaining<=0n) break;
          item.amount++;
          remaining--;
        }
        distributed=0n;
        for(const item of recipients) {
          const received=number(item.amount,'Household wage income');
          item.group.dailyWageIncomeToday=received;
          item.group.cumulativeWageIncome=number(
            BigInt(safeLaborCount(item.group.cumulativeWageIncome,'Cumulative household wage income',0))+
            item.amount,'Cumulative household wage income');
          distributed+=item.amount;
          if(item.amount>0n) {
            const currencyId=territory.currencyId;
            if(!currencyId) throw new Error('Household wage payment requires a valid State currency.');
            item.group.cashBalances ||= {};
            const balanceBefore=integer(item.group.cashBalances[currencyId]??0,
              'Household cash before wage payment');
            const balanceAfter=number(balanceBefore+item.amount,'Household cash after wage payment');
            item.group.cashBalances[currencyId]=balanceAfter;
            game.populationFinancialTransactions.push({
              id:id(),stateId:territory.stateId,populationGroupId:item.group.id,
              currencyId,type:'WageIncome',amount:received,
              balanceBefore:number(balanceBefore,'Household cash before wage payment'),
              balanceAfter,worldDate:game.worldDate,day:game.day,
              description:'Household group received company wage income.'
            });
          }
        }
      }
      territory.householdWageIncomeToday=number(distributed,'Distributed household wage income');
      territory.unallocatedWageIncomeToday=number(totals.paid-distributed,
        'Unallocated household wage income');
      if (territory.companyEmployees!==totals.employees)
        throw new Error('Company payroll employee totals do not match assigned State employment.');
    }
    if(game.populationFinancialTransactions.length>2000)
      game.populationFinancialTransactions.splice(0,game.populationFinancialTransactions.length-2000);
    return {
      due:number(totalDue,'World daily payroll due'),
      paid:number(totalPaid,'World daily payroll paid'),
      arrears:number(totalArrears,'World outstanding wage arrears'),
      transactionCount
    };
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
      allocateCompanyWorkforce(draft);
      accrueGovernmentBalances(draft);
      const production = advanceProduction(draft);
      draft.productionHistory ||= [];
      for (const result of production) {
        const producingCompany=draft.companies.find(item=>item.id===result.companyId);
        draft.productionHistory.push({
          companyId:result.companyId,stateId:producingCompany?.stateId||null,
          facilityId:result.facilityId,recipeId:result.recipeId,
          worldDate:draft.worldDate,day:draft.day,batches:result.batches,
          inputsConsumed:clone(result.inputsConsumed),outputsProduced:clone(result.outputsProduced)
        });
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
      if(draft.productionHistory.length>2000)
        draft.productionHistory.splice(0,draft.productionHistory.length-2000);
      clearMarkets(draft);
      const payroll=settleCompanyPayroll(draft);
      globalThis.NewWorldStrategy?.advanceDay?.(draft);
      globalThis.NewWorldCivicSystems?.advanceDay?.(draft);
      evaluateWorldEvents(draft);

      const dayDescription = draft.worldDate + ' began (day ' + draft.day + ').';
      pushActivity(draft, dayDescription);
      pushEvent(draft, 'world.day_advanced', null, dayDescription);
      draft.worldVersion = (draft.worldVersion || 0) + 1;
      Object.assign(game, draft);
      return {ok:true, day:game.day, productionCount:production.length,
        marketSettlementCount:(game.markets || []).length,payrollPaid:payroll.paid,
        wageArrears:payroll.arrears,payrollTransactionCount:payroll.transactionCount};
    } catch (error) {
      return {ok:false, error:error?.message || 'The simulation cycle failed.'};
    }
  }

  function createStarterEconomy(territories, createId = id) {
    const goods = [
      {id:'grain',name:'Grain',unit:'tonnes',category:'Resource',storageCapacity:50000},
      {id:'flour',name:'Flour',unit:'tonnes',category:'Intermediate',storageCapacity:25000},
      {id:'timber',name:'Timber',unit:'tonnes',category:'Resource',storageCapacity:30000},
      {id:'ore',name:'Ore',unit:'tonnes',category:'Resource',storageCapacity:20000},
      {id:'stone',name:'Stone',unit:'tonnes',category:'Resource',storageCapacity:40000},
      {id:'tools',name:'Tools',unit:'items',category:'Capital',storageCapacity:12000}
    ];
    const productionRecipes = [
      {id:'grow-grain',name:'Grain harvest',daysPerBatch:1,inputs:{},outputs:{grain:300}},
      {id:'mill-flour',name:'Flour milling',daysPerBatch:1,inputs:{grain:100},outputs:{flour:100}},
      {id:'harvest-timber',name:'Timber harvest',daysPerBatch:1,inputs:{},outputs:{timber:50}},
      {id:'extract-ore',name:'Ore extraction',daysPerBatch:2,inputs:{tools:2},outputs:{ore:25}},
      {id:'quarry-stone',name:'Stone quarrying',daysPerBatch:1,inputs:{tools:1},outputs:{stone:80}},
      {id:'forge-tools',name:'Tool manufacturing',daysPerBatch:1,inputs:{timber:20},outputs:{tools:10}}
    ];
    const companies = [];
    const markets = [];
    const populationGroups = [];
    const companyDefinitions = [
      {id:'farm',name:'Agricultural Cooperative',sector:'Agriculture',workersPerFacility:6,dailyWage:2,
        inventory:{grain:40},recipeId:'grow-grain',batchesPerCycle:1},
      {id:'mill',name:'Flour Mill',sector:'Food processing',workersPerFacility:5,dailyWage:3,
        inventory:{grain:100,flour:8},recipeId:'mill-flour',batchesPerCycle:1},
      {id:'sawmill',name:'Timber Works',sector:'Forestry',workersPerFacility:4,dailyWage:2,
        inventory:{timber:20},recipeId:'harvest-timber',batchesPerCycle:1},
      {id:'mine',name:'Frontier Ore Mine',sector:'Mining',workersPerFacility:7,dailyWage:3,
        inventory:{ore:0,tools:6},recipeId:'extract-ore',batchesPerCycle:1},
      {id:'quarry',name:'Stone Quarry',sector:'Mining',workersPerFacility:6,dailyWage:3,
        inventory:{stone:0,tools:4},recipeId:'quarry-stone',batchesPerCycle:1},
      {id:'foundry',name:'Tool Foundry',sector:'Manufacturing',workersPerFacility:5,dailyWage:4,
        inventory:{timber:30,tools:2},recipeId:'forge-tools',batchesPerCycle:1}
    ];
    for (const territory of territories) {
      if (Number(territory.population) > 0) initializeDemography(territory);
      const currencyId = territory.currencyId;
      for (const definition of companyDefinitions) {
        const companyId = createId();
        const inventory = {grain:0,flour:0,timber:0,ore:0,stone:0,tools:0,...definition.inventory};
        const facilities = [{
          id:createId(),recipeId:definition.recipeId,batchesPerCycle:definition.batchesPerCycle,progressDays:0,
          workersRequired:definition.workersPerFacility,dailyWage:definition.dailyWage,employees:0
        }];
        companies.push({
          id:companyId,stateId:territory.stateId,currencyId,
          cashBalances:{[currencyId]:5000},
          name:definition.name + ' — ' + territory.name,sector:definition.sector,
          inventory,facilities,wageArrears:0,workforce:{workersRequired:definition.workersPerFacility,
            employees:0,vacancies:definition.workersPerFacility,averageDailyWage:definition.dailyWage,
            dailyPayrollDue:0,dailyPayrollPaid:0,wageArrears:0}
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
      for (const goodId of ['grain','flour','timber','ore','stone','tools']) {
        markets.push({
          stateId:territory.stateId,goodId,
          dailyDemand:goodId==='tools' ? Math.max(1,Math.floor(territory.population/10000))
            : goodId==='timber' ? Math.max(1,Math.floor(territory.population/4000))
            : goodId==='ore' ? Math.max(1,Math.floor(territory.population/10000))
            : goodId==='stone' ? Math.max(1,Math.floor(territory.population/6000)) : 0,
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

  const api = Object.freeze({advanceDay, createStarterEconomy, getSettlementMetrics, evaluateWorldEvents, initializeDemography, advanceDemography});
  globalThis.NewWorldSimulation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();