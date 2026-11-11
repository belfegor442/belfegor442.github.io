(() => {
  'use strict';

  const SVG_SHA256 = 'ED01509FE3C4BA9933755287E8256617505780851FBF6379B087FA5463C669EB';
  const SVG_PATH = './map.svg';
  const VERSION = 1;
  const states = Object.freeze([
    {index:0,stateKey:'coimbrila',stateName:'Kingdom of Coimbrila',svgElementId:'state1',legacyLabel:"FOUNDERS' REACH",geometryScope:'state'},
    {index:1,stateKey:'gania',stateName:'United Provinces of Gania',svgElementId:'state2',legacyLabel:'NORTH COAST',geometryScope:'state'},
    {index:2,stateKey:'chungia',stateName:'Chungia',svgElementId:'state3',legacyLabel:'EASTERN COAST',geometryScope:'state'},
    {index:3,stateKey:'calcilacia',stateName:'Calcilacia',svgElementId:'state4',legacyLabel:'UPPER MARCH',geometryScope:'state'},
    {index:4,stateKey:'pician-empire',stateName:'Pician Empire',svgElementId:'state5',legacyLabel:'WESTERN VALE',geometryScope:'state'},
    {index:5,stateKey:'meityeun-theocracy',stateName:'Meityeun Theocracy',svgElementId:'state6',legacyLabel:'HIGHLAND BASIN',geometryScope:'state'},
    {index:6,stateKey:'swabing',stateName:'Swabing',svgElementId:'state7',legacyLabel:'ORREN FOOTHILLS',geometryScope:'state'},
    {index:7,stateKey:'alba',stateName:'Alba',svgElementId:'state8',legacyLabel:'EASTERN UPLANDS',geometryScope:'state'},
    {index:8,stateKey:'knosian-despotate',stateName:'Knosian Despotate',svgElementId:'state9',legacyLabel:'WESTERN LOWLANDS',geometryScope:'state'},
    {index:9,stateKey:'kalestos',stateName:'Kalestos',svgElementId:'state10',legacyLabel:'CENTRAL FOREST',geometryScope:'state'},
    {index:10,stateKey:'gorkirch',stateName:'Gorkirch',svgElementId:'state11',legacyLabel:'SOUTHERN PLAIN',geometryScope:'state'},
    {index:11,stateKey:'shonewesia',stateName:'Duchy of Shonewesia',svgElementId:'state12',legacyLabel:'EASTERN MARCHES',geometryScope:'state'},
    {index:12,stateKey:'shahtehaq',stateName:'Shahtehaq',svgElementId:'state13',legacyLabel:'SOUTH COAST',geometryScope:'state'},
    {index:13,stateKey:'kvinian-empire',stateName:'Kvinian Empire',svgElementId:'state14',legacyLabel:'GREAT RIVERLAND',geometryScope:'state'},
    {index:14,stateKey:'shi',stateName:'Shi',svgElementId:'state15',legacyLabel:'SOUTHERN REACH',geometryScope:'state'},
    {index:15,stateKey:'kueopia',stateName:'Kueopia',svgElementId:'state16',legacyLabel:'FAR COAST',geometryScope:'state'}
  ]);

  const byIndex = index => states.find(item => item.index === Number(index)) || null;
  const byStateKey = key => states.find(item => item.stateKey === String(key)) || null;
  const bySvgElementId = id => states.find(item => item.svgElementId === String(id)) || null;

  function validateCatalog(svgIds) {
    const errors = [];
    if (states.length !== 16) errors.push('EXPECTED_16_STATES');
    if (new Set(states.map(item => item.stateKey)).size !== states.length) errors.push('DUPLICATE_STATE_KEY');
    if (new Set(states.map(item => item.svgElementId)).size !== states.length) errors.push('DUPLICATE_GEOMETRY_ID');
    for (let index = 0; index < states.length; index++) {
      const item = states[index];
      if (item.index !== index) errors.push('NON_SEQUENTIAL_STATE_INDEX:' + item.stateKey);
      if (!item.stateKey || !item.stateName || !item.svgElementId) errors.push('INCOMPLETE_STATE_MAPPING:' + index);
      if (item.geometryScope !== 'state') errors.push('UNDECLARED_GEOMETRY_SCOPE:' + item.stateKey);
      if (Array.isArray(svgIds) && !svgIds.includes(item.svgElementId)) errors.push('MISSING_SVG_GEOMETRY:' + item.svgElementId);
    }
    return {valid:errors.length === 0,errors};
  }

  const api = Object.freeze({
    version:VERSION,svgPath:SVG_PATH,svgSha256:SVG_SHA256,
    geometryScope:'state-boundaries-only',
    provinceGeometryPolicy:'No province boundary is inferred from a State path. Province geometry remains unmapped until a dedicated boundary source is approved.',
    states,byIndex,byStateKey,bySvgElementId,validateCatalog
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NewWorldTerritoryGeometry = api;
})();
