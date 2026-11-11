'use strict';

(() => {
  const LEGACY_PLOT_OFFSET = 144;
  const WORLD_SIZE = 1024;
  const MAX_PLOT = LEGACY_PLOT_OFFSET + WORLD_SIZE * WORLD_SIZE;
  const SECTORS = ['residential','commercial','industrial'];
  const COSTS = Object.freeze({
    road:32, zone:8, powerLine:7, waterPipe:7,
    powerPlant:2600, waterPump:1800
  });
  const SPRITES = Object.freeze({
    residential:['houses/1x1_house1','houses/1x1_house3','houses/1x1_house6','houses/1x1_house10','village/1x1_round_cottage'],
    commercial:['restaurants/1x1_commercial_2_store','restaurants/1x1_commercial_13_bookstore','village/1x1_market_stall'],
    industrial:['village/1x1_lumber_shed','village/1x1_farmhouse_barn'],
    waterPump:'watertower/1x1_standpipe'
  });

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function integer(value) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  function clamp(value,min,max) {
    return Math.max(min,Math.min(max,Number(value)||0));
  }
  function cellForPlot(plotIndex) {
    const plot=integer(plotIndex);
    if(plot===null || plot<LEGACY_PLOT_OFFSET || plot>=MAX_PLOT) return null;
    const world=plot-LEGACY_PLOT_OFFSET;
    return {row:Math.floor(world/WORLD_SIZE),col:world%WORLD_SIZE};
  }
  function plotForCell(row,col) {
    if(!Number.isInteger(row)||!Number.isInteger(col)||row<0||col<0||row>=WORLD_SIZE||col>=WORLD_SIZE) return null;
    return LEGACY_PLOT_OFFSET+row*WORLD_SIZE+col;
  }
  function neighbours(plotIndex) {
    const cell=cellForPlot(plotIndex);
    if(!cell) return [];
    return [
      plotForCell(cell.row-1,cell.col),
      plotForCell(cell.row+1,cell.col),
      plotForCell(cell.row,cell.col-1),
      plotForCell(cell.row,cell.col+1)
    ].filter(value=>value!==null);
  }
  function makeCells(row,col,offsets) {
    const result={};
    for(const [dr,dc] of offsets) {
      const index=plotForCell(row+dr,col+dc);
      if(index!==null) result[index]=true;
    }
    return result;
  }
  function createStarterCity(centerPlot) {
    const center=cellForPlot(centerPlot);
    if(!center) throw new Error('A valid city centre is required.');
    const roads={},powerLines={},waterPipes={},zones={},facilities={};
    const addRoad=(row,col)=>{
      const index=plotForCell(row,col);
      if(index!==null) {
        roads[index]=true;
        powerLines[index]=true;
        waterPipes[index]=true;
      }
    };
    for(let dc=-6;dc<=6;dc++) addRoad(center.row,center.col+dc);
    for(const dc of [-3,3]) {
      for(let dr=-4;dr<=4;dr++) addRoad(center.row+dr,center.col+dc);
    }
    const zoneSeed=[
      [-2,-4,'residential'],[-3,-2,'residential'],
      [2,-4,'residential'],[3,-2,'residential'],
      [-2,4,'commercial'],[2,4,'commercial'],
      [-3,2,'industrial'],[3,2,'industrial']
    ];
    for(const [dr,dc,type] of zoneSeed) {
      const index=plotForCell(center.row+dr,center.col+dc);
      if(index!==null) zones[index]=type;
    }
    const powerIndex=plotForCell(center.row-1,center.col-6);
    const waterIndex=plotForCell(center.row+1,center.col+6);
    if(powerIndex!==null) facilities[powerIndex]={type:'powerPlant',name:'Local Power Station'};
    if(waterIndex!==null) facilities[waterIndex]={type:'waterPump',name:'Waterworks'};
    const hallIndex=plotForCell(center.row-1,center.col);
    if(hallIndex!==null) facilities[hallIndex]={type:'townHall',name:'Town Hall'};
    return {
      version:1,
      centerPlot,
      zones,roads,powerLines,waterPipes,facilities,developed:{},
      taxRates:{residential:9,commercial:10,industrial:8},
      speed:1,
      demand:{residential:68,commercial:38,industrial:28},
      metrics:{
        powerSupply:2600, powerDemand:0, waterSupply:2200, waterDemand:0,
        poweredZones:0, wateredZones:0, roadConnectedZones:0,
        residentialBuildings:0, commercialBuildings:0, industrialBuildings:0,
        jobs:0, taxRevenueLastDay:0, maintenanceLastDay:0, netLastDay:0
      },
      history:[],
      createdBuildings:0,
      lastAdvancedDay:1
    };
  }
  function ensureCity(game) {
    if(!game||!Array.isArray(game.territories)) return null;
    const territory=game.territories.find(item=>item.index===0) || game.territories[0];
    if(!territory) return null;
    if(!territory.city) {
      const center=LEGACY_PLOT_OFFSET+520*WORLD_SIZE+490;
      territory.city=createStarterCity(center);
    }
    const city=territory.city;
    city.version=1;
    city.centerPlot=integer(city.centerPlot) ?? (LEGACY_PLOT_OFFSET+520*WORLD_SIZE+490);
    city.zones=record(city.zones);
    city.roads=record(city.roads);
    city.powerLines=record(city.powerLines);
    city.waterPipes=record(city.waterPipes);
    city.facilities=record(city.facilities);
    city.developed=record(city.developed);
    city.taxRates={residential:9,commercial:10,industrial:8,...record(city.taxRates)};
    city.demand={residential:68,commercial:38,industrial:28,...record(city.demand)};
    city.metrics={...createStarterCity(LEGACY_PLOT_OFFSET+520*WORLD_SIZE+490).metrics,...record(city.metrics)};
    city.history=Array.isArray(city.history)?city.history:[];
    city.createdBuildings=Math.max(0,integer(city.createdBuildings)||0);
    const liveMetrics=recomputeDemand(territory,city);
    city.metrics={...city.metrics,...liveMetrics};
    return {territory,city};
  }
  function pushActivity(game,message) {
    game.activity=Array.isArray(game.activity)?game.activity:[];
    game.activity.unshift(message);
    if(game.activity.length>100) game.activity.length=100;
  }
  function pushEvent(game,stateId,type,message) {
    game.events=Array.isArray(game.events)?game.events:[];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:'city-'+game.id+'-'+game.eventSequence,gameId:game.id,
      orderId:null,actorPlayerId:game.hostPlayerId||null,stateId,
      type,resultCode:null,occurredAtUtc:new Date().toISOString(),
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0),
      description:message,sequence:game.eventSequence
    });
    if(game.events.length>1000) game.events.splice(0,game.events.length-1000);
  }
  function isBuilt(territory,index) {
    return Boolean(territory.buildings && territory.buildings[index]);
  }
  function occupied(city,territory,index) {
    return Boolean(city.roads[index]||city.facilities[index]||city.zones[index]||isBuilt(territory,index));
  }
  function spend(territory,amount) {
    const cost=Math.max(0,Math.ceil(Number(amount)||0));
    if(Number(territory.treasury||0)<cost) return false;
    territory.treasury-=cost;
    return true;
  }
  function commitCityChange(territory,city) {
    const metrics=recomputeDemand(territory,city);
    city.metrics={...city.metrics,...metrics};
    return {ok:true,city};
  }

  function applyAction(game,playerId,action,options={}) {
    if(!game||!game.started||game.status==='closed') return {ok:false,error:'The city is not running.'};
    const setup=ensureCity(game);
    if(!setup) return {ok:false,error:'The city could not be loaded.'};
    const {territory,city}=setup;
    const type=String(action?.type||'');
    if(type==='tax') {
      const sector=String(action.sector||'');
      if(!SECTORS.includes(sector)) return {ok:false,error:'Unknown tax sector.'};
      const rate=Number(action.value);
      if(!Number.isFinite(rate)||rate<4||rate>20) return {ok:false,error:'Tax rates must be between 4% and 20%.'};
      city.taxRates[sector]=Math.round(rate*10)/10;
      pushActivity(game,sector[0].toUpperCase()+sector.slice(1)+' tax rate set to '+city.taxRates[sector].toFixed(1)+'%.');
      return {ok:true,city};
    }
    if(type==='speed') {
      const speed=Number(action.value);
      if(![1,2,4].includes(speed)) return {ok:false,error:'Choose a simulation speed of 1×, 2× or 4×.'};
      city.speed=speed;
      return {ok:true,city};
    }
    if(type==='pause') {
      game.paused=!game.paused;
      game.status=game.paused?'paused':'running';
      game.pauseVotePlayerIds=[];
      pushActivity(game,game.paused?'The city simulation was paused.':'The city simulation resumed.');
      return {ok:true,city};
    }
    const plot=integer(action?.plotIndex);
    if(plot===null||!cellForPlot(plot)) return {ok:false,error:'Select a valid land tile.'};
    if(typeof options.isLand==='function'&&!options.isLand(plot)) return {ok:false,error:'This tile cannot be developed. Choose dry land.'};
    const tool=type==='paint'?String(action.tool||''):type;
    if(tool==='bulldoze') {
      const changed=Boolean(city.zones[plot]||city.roads[plot]||city.powerLines[plot]||city.waterPipes[plot]||city.facilities[plot]||territory.buildings?.[plot]);
      if(!changed) return {ok:false,error:'There is nothing to remove from this tile.'};
      delete city.zones[plot];delete city.roads[plot];delete city.powerLines[plot];delete city.waterPipes[plot];delete city.facilities[plot];delete city.developed[plot];
      if(territory.buildings) delete territory.buildings[plot];
      pushActivity(game,'Removed the development at plot '+plot+'.');
      return commitCityChange(territory,city);
    }
    if(tool==='road') {
      if(city.roads[plot]) return {ok:false,error:'A road already occupies this tile.'};
      if(city.facilities[plot]||isBuilt(territory,plot)) return {ok:false,error:'Remove the structure before placing a road.'};
      if(!spend(territory,COSTS.road)) return {ok:false,error:'Insufficient city funds for this road.'};
      delete city.zones[plot];
      city.roads[plot]=true;
      return commitCityChange(territory,city);
    }
    if(SECTORS.includes(tool)) {
      if(city.roads[plot]||city.facilities[plot]||isBuilt(territory,plot)) return {ok:false,error:'This tile is already occupied.'};
      if(city.zones[plot]===tool) return {ok:false,error:'This tile already has that zone.'};
      if(!spend(territory,COSTS.zone)) return {ok:false,error:'Insufficient city funds for zoning.'};
      city.zones[plot]=tool;
      delete city.developed[plot];
      return commitCityChange(territory,city);
    }
    if(tool==='powerLine'||tool==='waterPipe') {
      const collection=tool==='powerLine'?city.powerLines:city.waterPipes;
      if(collection[plot]) return {ok:false,error:'That utility connection already exists.'};
      if(!spend(territory,COSTS[tool])) return {ok:false,error:'Insufficient city funds for utilities.'};
      collection[plot]=true;
      return commitCityChange(territory,city);
    }
    if(tool==='powerPlant'||tool==='waterPump') {
      if(occupied(city,territory,plot)) return {ok:false,error:'This tile is already occupied.'};
      if(!neighbours(plot).some(index=>city.roads[index])) return {ok:false,error:'Utility facilities must connect to a road.'};
      const cost=COSTS[tool];
      if(!spend(territory,cost)) return {ok:false,error:'Insufficient city funds for this facility.'};
      city.facilities[plot]={type:tool,name:tool==='powerPlant'?'Power Station':'Waterworks'};
      return commitCityChange(territory,city);
    }
    return {ok:false,error:'Unknown city-builder tool.'};
  }
  function connectedCells(city,sourceType,lines) {
    const sources=Object.keys(city.facilities).map(Number).filter(index=>city.facilities[index]?.type===sourceType);
    const visited=new Set();
    const queue=[];
    for(const source of sources) {
      visited.add(source);queue.push(source);
      for(const next of neighbours(source)) if(lines[next]&&!visited.has(next)){visited.add(next);queue.push(next);}
    }
    for(let cursor=0;cursor<queue.length;cursor++) {
      for(const next of neighbours(queue[cursor])) {
        if(lines[next]&&!visited.has(next)){visited.add(next);queue.push(next);}
      }
    }
    return visited;
  }
  function adjacentTo(plot,collection) {
    return neighbours(plot).some(index=>
      collection instanceof Set ? collection.has(index) : Boolean(collection[index]));
  }
  function deterministicChoice(items,seed) {
    if(!items.length) return '';
    const value=(Math.imul(seed+1,1664525)+1013904223)>>>0;
    return items[value%items.length];
  }
  function metricsFor(territory,city) {
    const pop=Math.max(0,Number(territory.population)||0);
    const buildings=Object.values(territory.buildings||{});
    const residential=buildings.filter(item=>item.citySector==='residential').length;
    const commercial=buildings.filter(item=>item.citySector==='commercial').length;
    const industrial=buildings.filter(item=>item.citySector==='industrial').length;
    const powered=connectedCells(city,'powerPlant',city.powerLines);
    const watered=connectedCells(city,'waterPump',city.waterPipes);
    const zoneIndexes=Object.keys(city.zones).map(Number);
    const roadConnected=zoneIndexes.filter(index=>adjacentTo(index,city.roads)).length;
    const poweredZones=zoneIndexes.filter(index=>adjacentTo(index,powered)).length;
    const wateredZones=zoneIndexes.filter(index=>adjacentTo(index,watered)).length;
    const powerSupply=Object.values(city.facilities).filter(item=>item.type==='powerPlant').length*2600;
    const waterSupply=Object.values(city.facilities).filter(item=>item.type==='waterPump').length*2200;
    const powerDemand=Math.round(pop*.48+buildings.length*45);
    const waterDemand=Math.round(pop*.55+buildings.length*34);
    const jobs=buildings.reduce((sum,item)=>sum+(Number(item.jobSlots)||0),0);
    return {
      population:pop,roads:Object.keys(city.roads).length,
      zones:zoneIndexes.length,residentialBuildings:residential,
      commercialBuildings:commercial,industrialBuildings:industrial,
      powerSupply,powerDemand,waterSupply,waterDemand,
      poweredZones:Math.min(poweredZones,Math.max(0,zoneIndexes.length)),
      wateredZones:Math.min(wateredZones,Math.max(0,zoneIndexes.length)),
      roadConnectedZones:roadConnected,jobs,
      taxRevenueLastDay:Number(city.metrics.taxRevenueLastDay)||0,
      maintenanceLastDay:Number(city.metrics.maintenanceLastDay)||0,
      netLastDay:Number(city.metrics.netLastDay)||0
    };
  }
  function recomputeDemand(territory,city) {
    const metrics=metricsFor(territory,city);
    const buildings=Object.values(territory.buildings||{});
    const residential=buildings.filter(item=>item.citySector==='residential').length;
    const commercial=buildings.filter(item=>item.citySector==='commercial').length;
    const industrial=buildings.filter(item=>item.citySector==='industrial').length;
    const capacity=Math.max(1,Number(territory.housingCapacity||territory.baseHousingCapacity||1));
    const fullness=Number(territory.population||0)/capacity;
    const working=Number(territory.workingAgePopulation||territory.population||0);
    const jobs=metrics.jobs;
    city.demand.residential=Math.round(clamp(78-(fullness*65)-residential*5+(Number(territory.prosperity||50)-50)*.25,0,100));
    city.demand.commercial=Math.round(clamp(20+(Number(territory.population||0)/42)-commercial*11,0,100));
    city.demand.industrial=Math.round(clamp(26+Math.max(0,working-jobs)/50-industrial*10,0,100));
    return metrics;
  }
  function growZones(game,territory,city,metrics) {
    let grown=0;
    const zones=Object.keys(city.zones).map(Number).sort((a,b)=>a-b);
    const eligible=zones.filter(index=>!territory.buildings?.[index]&&
      adjacentTo(index,city.roads)&&
      adjacentTo(index,connectedCells(city,'powerPlant',city.powerLines))&&
      adjacentTo(index,connectedCells(city,'waterPump',city.waterPipes)));
    const powerAvailable=metrics.powerSupply>=metrics.powerDemand;
    const waterAvailable=metrics.waterSupply>=metrics.waterDemand;
    if(!powerAvailable||!waterAvailable) return 0;
    const rank={residential:0,commercial:1,industrial:2};
    eligible.sort((a,b)=>rank[city.zones[a]]-rank[city.zones[b]]||a-b);
    for(const index of eligible) {
      if(grown>=2) break;
      const sector=city.zones[index];
      if(Number(city.demand[sector])<24) continue;
      const building=sector==='residential'
        ? {id:'housing',name:'Residential Building',income:7,jobSlots:18,upkeep:2,housingCapacity:680,daysRemaining:0,citySector:sector,
            spriteKey:deterministicChoice(SPRITES.residential,index+game.day)}
        : sector==='commercial'
          ? {id:'market',name:'Commercial Building',income:25,jobSlots:180,upkeep:4,daysRemaining:0,citySector:sector,
              spriteKey:deterministicChoice(SPRITES.commercial,index+game.day)}
          : {id:'workshop',name:'Industrial Building',income:28,jobSlots:280,upkeep:5,daysRemaining:0,citySector:sector,
              spriteKey:deterministicChoice(SPRITES.industrial,index+game.day)};
      territory.buildings ||= {};
      territory.buildings[index]=building;
      city.developed[index]=true;
      city.createdBuildings++;
      grown++;
      pushActivity(game,sector[0].toUpperCase()+sector.slice(1)+' district developed at plot '+index+'.');
    }
    return grown;
  }
  function advanceDay(game) {
    const setup=ensureCity(game);
    if(!setup) return {ok:false,error:'The city simulation is unavailable.'};
    const {territory,city}=setup;
    const before=metricsFor(territory,city);
    const grown=growZones(game,territory,city,before);
    const after=metricsFor(territory,city);
    const population=Math.max(0,Number(territory.population)||0);
    const taxRevenue=Math.round(
      population*(city.taxRates.residential||0)*.006+
      after.commercialBuildings*20*(city.taxRates.commercial||0)*.025+
      after.industrialBuildings*24*(city.taxRates.industrial||0)*.025
    );
    const maintenance=Math.round(after.roads*.18+
      Object.values(city.facilities).reduce((sum,item)=>sum+(item.type==='powerPlant'?14:item.type==='waterPump'?9:0),0));
    const net=taxRevenue-maintenance;
    territory.treasury=Math.max(0,Math.min(2147483647,(Number(territory.treasury)||0)+net));
    city.metrics={
      ...after,taxRevenueLastDay:taxRevenue,maintenanceLastDay:maintenance,
      netLastDay:net,grownLastDay:grown
    };
    city.lastAdvancedDay=Number(game.day)||city.lastAdvancedDay;
    const metrics=recomputeDemand(territory,city);
    city.metrics={...city.metrics,...metrics,grownLastDay:grown,
      taxRevenueLastDay:taxRevenue,maintenanceLastDay:maintenance,netLastDay:net};
    city.history.push({day:game.day,population,treasury:territory.treasury,...city.demand});
    if(city.history.length>120) city.history.splice(0,city.history.length-120);
    if(grown>0) pushEvent(game,territory.stateId,'city.zones_developed',grown+' new zoned plot(s) developed.');
    return {ok:true,grown,metrics:city.metrics,demand:{...city.demand}};
  }
  function getMetrics(game,stateId) {
    const territory=game?.territories?.find(item=>item.stateId===stateId) || game?.territories?.[0];
    if(!territory) return null;
    const city=record(territory.city);
    return {demand:{...city.demand},taxRates:{...city.taxRates},metrics:{...city.metrics},
      zones:Object.keys(city.zones||{}).length,roads:Object.keys(city.roads||{}).length,
      buildings:city.createdBuildings||0,speed:city.speed||1};
  }
  const api=Object.freeze({
    constants:{LEGACY_PLOT_OFFSET,WORLD_SIZE,MAX_PLOT,COSTS},
    cellForPlot,plotForCell,neighbours,createStarterCity,ensureCity,
    applyAction,advanceDay,getMetrics
  });
  if(typeof globalThis!=='undefined') globalThis.NewWorldCityBuilder=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})();
