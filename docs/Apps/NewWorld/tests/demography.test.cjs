'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Demography=require('../demography.js');

function makeGame(date='1500-01-01') {
  const game={
    id:'demography-test',worldDate:date,worldVersion:5,eventSequence:0,
    territories:[{stateId:'state-a',population:365000}],
    demographicProfiles:[{
      stateId:'state-a',annualBirthsPerThousand:36,
      ageBands:[{id:'all-ages',minAge:0,maxAge:120,annualDeathsPerThousand:365}],
      migrationPermissionSetIds:['government-cabinet']
    }],
    populationGroups:[
      {id:'origin',stateId:'state-a',name:'Origin',locationId:'province-a',population:200000,
        ageCohorts:[{ageYears:20,population:120000},{ageYears:40,population:80000}]},
      {id:'destination',stateId:'state-a',name:'Destination',locationId:'province-b',population:165000,
        ageCohorts:[{ageYears:20,population:100000},{ageYears:40,population:65000}]}
    ],
    migrationRecords:[],demographicEvents:[],events:[],activity:[]
  };
  return game;
}

test('demographic configuration requires contiguous age coverage and balanced groups',()=>{
  const game=makeGame();
  assert.deepEqual(Demography.validateConfiguration(
    game,game.demographicProfiles,game.populationGroups),{valid:true,errors:[]});
  game.demographicProfiles[0].ageBands[0].maxAge=119;
  const validation=Demography.validateConfiguration(
    game,game.demographicProfiles,game.populationGroups);
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.includes('DEMOGRAPHY_AGE_BANDS_MUST_COVER_0_TO_120:state-a'));
});

test('duplicate population group IDs are rejected',()=>{
  const game=makeGame();
  game.populationGroups[1].id='origin';
  const validation=Demography.validateConfiguration(
    game,game.demographicProfiles,game.populationGroups);
  assert.ok(validation.errors.includes('DEMOGRAPHY_GROUP_IDS_INVALID'));
});

test('daily cohorts age on January first and use configured birth and mortality rates',()=>{
  const game=makeGame();
  const result=Demography.advanceDay(game);
  assert.deepEqual(result,{ok:true,statesProcessed:1,births:35,deaths:365});
  assert.equal(game.territories[0].population,364670);
  assert.equal(game.populationGroups[0].population,
    game.populationGroups[0].ageCohorts.reduce((sum,item)=>sum+item.population,0));
  assert.ok(game.populationGroups[0].ageCohorts.some(item=>item.ageYears===21));
  assert.ok(game.populationGroups[0].ageCohorts.some(item=>item.ageYears===0));
  assert.equal(game.territories[0].demographicBirthsLastDay,35);
  assert.equal(game.territories[0].demographicDeathsLastDay,365);
  assert.ok(game.demographicEvents.some(item=>item.type==='births'));
  assert.ok(game.demographicEvents.some(item=>item.type==='deaths'));
});

test('aging occurs only on the first day of a new year',()=>{
  const game=makeGame('1500-01-02');
  Demography.advanceDay(game);
  assert.ok(game.populationGroups[0].ageCohorts.some(item=>item.ageYears===20));
  assert.ok(!game.populationGroups[0].ageCohorts.some(item=>item.ageYears===21));
});

test('internal migration conserves the State total and transfers age cohorts proportionally',()=>{
  const game=makeGame();
  const before=game.territories[0].population;
  const result=Demography.movePopulation(game,{
    originGroupId:'origin',destinationGroupId:'destination',quantity:12345,orderId:'order-1'
  },{id:'player-1'},{stateId:'state-a',permissionSetId:'government-cabinet'},()=> 'migration-1');
  assert.deepEqual(result,{ok:true,quantity:12345});
  assert.equal(game.territories[0].population,before);
  assert.equal(game.populationGroups[0].population,187655);
  assert.equal(game.populationGroups[1].population,177345);
  assert.equal(game.populationGroups.reduce((sum,item)=>sum+item.population,0),before);
  assert.equal(game.migrationRecords[0].id,'migration-1');
  assert.equal(game.migrationRecords[0].ageDistribution.reduce((sum,item)=>sum+item.population,0),12345);
});

test('migration rejects an invalid source cohort total without mutating either group',()=>{
  const game=makeGame();
  game.populationGroups[0].ageCohorts[0].population--;
  const before=structuredClone(game.populationGroups);
  const result=Demography.movePopulation(game,{
    originGroupId:'origin',destinationGroupId:'destination',quantity:10
  },{id:'player-1'},{stateId:'state-a',permissionSetId:'government-cabinet'},()=> 'unused');
  assert.equal(result.ok,false);
  assert.equal(result.code,'MIGRATION_QUANTITY_INVALID');
  assert.deepEqual(game.populationGroups,before);
  assert.equal(game.migrationRecords.length,0);
});

test('migration cannot cross government borders or use an observer membership',()=>{
  const game=makeGame();
  game.populationGroups.push({
    id:'foreign',stateId:'state-b',name:'Foreign',locationId:'province-c',
    population:100,ageCohorts:[{ageYears:20,population:100}]
  });
  let result=Demography.movePopulation(game,{
    originGroupId:'origin',destinationGroupId:'foreign',quantity:10
  },{id:'player-1'},{stateId:'state-a',permissionSetId:'government-cabinet'},()=> 'unused');
  assert.equal(result.code,'MIGRATION_DESTINATION_INVALID');
  result=Demography.movePopulation(game,{
    originGroupId:'origin',destinationGroupId:'destination',quantity:10
  },{id:'player-1'},{stateId:'state-a',permissionSetId:'government-observer'},()=> 'unused');
  assert.equal(result.code,'INSUFFICIENT_PERMISSION');
});
