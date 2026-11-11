(() => {
  'use strict';

  const CONFIG_FIELDS = Object.freeze([
    'currencies','exchangeRates','financialBanks','taxRules','priceIndexConfigs'
  ]);
  const DYNAMIC_FIELDS = Object.freeze([
    'publicDebtIssues','bankTransactions','taxAssessments','priceIndexHistory',
    'financeHistory'
  ]);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/;
  const safeInteger = (value,min=0,max=Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(value) && value >= min && value <= max;
  const finite = (value,min,max) => Number.isFinite(value) && value >= min && value <= max;
  const text = (value,min=2,max=160) => typeof value === 'string' &&
    value.trim().length >= min && value.length <= max &&
    !/[<>\u0000-\u001f\u007f]/.test(value);
  const validDate = value => typeof value === 'string' && DATE.test(value) &&
    !Number.isNaN(Date.parse(value+'T00:00:00Z')) &&
    new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
  const clone = value => structuredClone(value);
  const currencyFor = (game,id) => (game.currencies || []).find(item => item.id === id);
  const territoryFor = (game,id) => (game.territories || []).find(item => item.stateId === id);
  const idFor = createId => (createId || (()=>'finance-'+Date.now()+'-'+Math.random().toString(36).slice(2)))();

  function ensure(game) {
    if (!game || !Array.isArray(game.territories)) return game;
    for (const field of [...CONFIG_FIELDS,...DYNAMIC_FIELDS])
      if (!Array.isArray(game[field])) game[field] = [];
    for(const bank of game.financialBanks) {
      if(!Number.isSafeInteger(bank.initialCashBalance)) bank.initialCashBalance=bank.cashBalance;
      if(!Number.isSafeInteger(bank.initialCapital)) bank.initialCapital=bank.capital;
      if(!Number.isSafeInteger(bank.nonPerformingPrincipal)) bank.nonPerformingPrincipal=0;
    }
    if (!Object.prototype.hasOwnProperty.call(game,'financeCycleDate')) game.financeCycleDate = null;
    if (!Object.prototype.hasOwnProperty.call(game,'financeCycleResult')) game.financeCycleResult = null;
    return game;
  }

  function validateConfiguration(game,configuration) {
    if (!configuration || CONFIG_FIELDS.some(field=>!Array.isArray(configuration[field])))
      return {ok:false,error:'The financial scenario requires exchange rates, banks, tax rules and price-index configurations.'};
    for (const field of CONFIG_FIELDS) {
      const items=configuration[field];
      if (items.some(item=>!ID.test(String(item?.id||''))) ||
          new Set(items.map(item=>item.id)).size!==items.length)
        return {ok:false,error:'IDs in '+field+' must be unique, stable and valid.'};
    }
    const currencyIds=new Set((game.currencies||[]).map(item=>item.id));
    const stateIds=new Set((game.territories||[]).map(item=>item.stateId));
    const configuredCurrencies=new Map(configuration.currencies.map(item=>[item.id,item]));
    if(configuredCurrencies.size!==currencyIds.size ||
       (game.currencies||[]).some(existing=>{
         const next=configuredCurrencies.get(existing.id);
         return !next || next.stateId!==existing.stateId ||
           !text(next.name,2,80) || !/^[A-Z0-9]{2,12}$/.test(next.code||'') ||
           !safeInteger(next.minorUnitScale,0,6);
       }))
      return {ok:false,error:'Every State currency must keep its generated stable ID and State link, with a name, unique uppercase code and explicit decimal scale (0–6).'};
    if(new Set(configuration.currencies.map(item=>item.code)).size!==configuration.currencies.length)
      return {ok:false,error:'Currency codes must be unique across the world.'};
    const goods=new Set((game.goods||[]).map(item=>item.id));
    const markets=new Map((game.markets||[]).map(item=>[item.stateId+'|'+item.goodId,item]));
    const exchangePairs=new Set();
    for (const rate of configuration.exchangeRates) {
      const pair=rate.baseCurrencyId+'|'+rate.quoteCurrencyId+'|'+rate.effectiveOn;
      if (!currencyIds.has(rate.baseCurrencyId) || !currencyIds.has(rate.quoteCurrencyId) ||
          rate.baseCurrencyId===rate.quoteCurrencyId || !finite(rate.rate,0.00000001,1000000000) ||
          !validDate(rate.effectiveOn) || !text(rate.method,2,100) || !text(rate.source,2,240) ||
          exchangePairs.has(pair))
        return {ok:false,error:'An exchange rate needs two distinct registered currencies, a positive explicit quote, effective date, method and source.'};
      exchangePairs.add(pair);
      if (rate.expiresOn!==undefined && rate.expiresOn!==null &&
          (!validDate(rate.expiresOn) || rate.expiresOn<rate.effectiveOn))
        return {ok:false,error:'An exchange-rate expiry must be a valid date on or after its effective date.'};
    }
    for (const bank of configuration.financialBanks) {
      const territory=territoryFor(game,bank.stateId);
      if (!territory || !currencyIds.has(bank.currencyId) ||
          !text(bank.name) || !safeInteger(bank.cashBalance) ||
          !safeInteger(bank.capital) || !safeInteger(bank.minimumReserve||0,0,bank.cashBalance) ||
          !safeInteger(bank.loanLimit,0,Number.MAX_SAFE_INTEGER) ||
          !safeInteger(bank.riskAppetitePercent,0,100) ||
          !['active','suspended'].includes(bank.status) ||
          !Number.isFinite(bank.cashBalance+bank.capital))
        return {ok:false,error:'A bank needs a real home State, currency, name, capital, cash, reserve, lending limit, risk setting and status.'};
    }
    for (const rule of configuration.taxRules) {
      const territory=territoryFor(game,rule.stateId);
      if (!territory || rule.currencyId!==territory.currencyId ||
          !text(rule.name) || rule.scope!=='companies' || rule.basis!=='turnover' ||
          !safeInteger(rule.rateBasisPoints,0,10000) ||
          !validDate(rule.effectiveOn) ||
          (rule.expiresOn!==undefined && rule.expiresOn!==null &&
            (!validDate(rule.expiresOn) || rule.expiresOn<rule.effectiveOn)) ||
          rule.assessmentPeriod!=='daily')
        return {ok:false,error:'A tax rule must define a State-currency company-turnover rate in basis points and an explicit daily effective period.'};
    }
    for (const config of configuration.priceIndexConfigs) {
      const territory=territoryFor(game,config.stateId);
      if (!territory || config.currencyId!==territory.currencyId ||
          !text(config.name) || !validDate(config.baseDate) ||
          !Array.isArray(config.items) || !config.items.length)
        return {ok:false,error:'A price index needs a State, its own currency, a name, base date and a weighted basket.'};
      let weight=0;
      const basket=new Set();
      for (const item of config.items) {
        if (!goods.has(item.goodId) || !markets.has(config.stateId+'|'+item.goodId) ||
            !safeInteger(item.basePrice,1) || !safeInteger(item.weightBasisPoints,1,10000) ||
            basket.has(item.goodId))
          return {ok:false,error:'Every price-index item needs one existing local market, a positive base price and a unique positive weight.'};
        basket.add(item.goodId);
        weight+=item.weightBasisPoints;
      }
      if (weight!==10000)
        return {ok:false,error:'The weights in each price-index basket must total exactly 10,000 basis points.'};
    }
    return {ok:true,error:null};
  }

  function addDays(date,days) {
    const value=new Date(date+'T00:00:00Z');
    value.setUTCDate(value.getUTCDate()+days);
    return value.toISOString().slice(0,10);
  }

  function daysInYear(date) {
    const year=Number(date.slice(0,4));
    return new Date(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
  }

  function history(game,type,stateId,description,details,createId) {
    const entry={
      id:idFor(createId),type,stateId,description,worldDate:game.worldDate,
      details:clone(details||{})
    };
    game.financeHistory.push(entry);
    if (game.financeHistory.length>3000)
      game.financeHistory.splice(0,game.financeHistory.length-3000);
    game.events ||= [];
    game.eventSequence=(Number(game.eventSequence)||0)+1;
    game.events.push({
      id:idFor(createId),gameId:game.id,orderId:null,actorPlayerId:null,stateId,
      type:'finance.'+type,occurredAtUtc:new Date().toISOString(),
      worldDate:game.worldDate,worldVersion:(Number(game.worldVersion)||0)+1,
      description,sequence:game.eventSequence,details:clone(details||{})
    });
    if (game.events.length>1000) game.events.splice(0,game.events.length-1000);
    game.activity ||= [];
    game.activity.unshift(description);
    if (game.activity.length>100) game.activity.length=100;
    return entry;
  }

  function transaction(game,stateId,currencyId,type,amountValue,before,after,description,createId,extra={}) {
    game.financialTransactions ||= [];
    game.financialTransactions.push({
      id:idFor(createId),stateId,currencyId,type,amount:amountValue,
      balanceBefore:before,balanceAfter:after,description,worldDate:game.worldDate,
      recordedAtUtc:new Date().toISOString(),orderId:extra.orderId||null,
      membershipId:extra.membershipId||null,referenceId:extra.referenceId||null
    });
    if (game.financialTransactions.length>10000)
      game.financialTransactions.splice(0,game.financialTransactions.length-10000);
  }

  function convertCurrency(game,amount,baseCurrencyId,quoteCurrencyId,worldDate=game?.worldDate) {
    if (!safeInteger(amount,0) || !validDate(worldDate))
      return {ok:false,error:'Currency conversion requires a non-negative whole amount and a valid world date.'};
    if (baseCurrencyId===quoteCurrencyId)
      return {ok:true,amount,currencyId:quoteCurrencyId,rate:1,source:'same currency'};
    const rate=(game.exchangeRates||[]).filter(item=>
      item.baseCurrencyId===baseCurrencyId && item.quoteCurrencyId===quoteCurrencyId &&
      item.effectiveOn<=worldDate && (!item.expiresOn || item.expiresOn>=worldDate))
      .sort((a,b)=>b.effectiveOn.localeCompare(a.effectiveOn))[0];
    if (!rate) return {ok:false,error:'No explicit exchange rate exists for this currency pair on the selected date.'};
    const currency=currencyFor(game,quoteCurrencyId);
    if (!currency || !safeInteger(currency.minorUnitScale,0,6))
      return {ok:false,error:'The target currency has no configured minor-unit scale.'};
    const scale=10**currency.minorUnitScale;
    const converted=Math.round(amount*rate.rate*scale)/scale;
    if (!Number.isFinite(converted) || converted>Number.MAX_SAFE_INTEGER)
      return {ok:false,error:'The converted amount exceeds the supported numeric range.'};
    return {ok:true,amount:converted,currencyId:quoteCurrencyId,rate:rate.rate,
      method:rate.method,source:rate.source,effectiveOn:rate.effectiveOn};
  }

  function hasFinanceAuthority(game,player,membership) {
    if (!membership || membership.status!=='active' || membership.permissionSetId==='government-observer')
      return false;
    const system=(game.politicalSystems||[]).find(item=>item.stateId===membership.stateId);
    return (system?.offices||[]).some(office=>
      ['treasurer','chief-executive'].includes(office.id) && office.holderPlayerId===player?.id);
  }

  function applyOrder(game,player,membership,order,createId) {
    if (!String(order?.type||'').startsWith('finance.')) return null;
    ensure(game);
    const stateId=membership?.stateId;
    const territory=territoryFor(game,stateId);
    if (!territory || order.stateId!==stateId)
      return {ok:false,code:'FINANCE_STATE_INVALID',error:'The financial order must target the member State.'};
    if (!hasFinanceAuthority(game,player,membership))
      return {ok:false,code:'FINANCE_AUTHORITY_REQUIRED',error:'Only the appointed State Treasurer or Chief Executive may issue or repay public debt.'};

    if (order.type==='finance.issuePublicDebt') {
      const bank=(game.financialBanks||[]).find(item=>
        item.id===order.bankId && item.status==='active' &&
        item.currencyId===territory.currencyId);
      const amount=order.amount;
      const rate=order.annualInterestBasisPoints;
      const term=order.termDays;
      if (!bank) return {ok:false,code:'FINANCE_BANK_UNAVAILABLE',error:'Choose an active bank that holds the borrowing State currency; no implicit currency conversion is permitted.'};
      if (!safeInteger(amount,1,2147483647) || !safeInteger(rate,0,10000) ||
          !safeInteger(term,1,36500))
        return {ok:false,code:'FINANCE_DEBT_TERMS_INVALID',error:'Debt principal, annual interest (basis points) and term in days must be valid whole numbers.'};
      const bankExposure=(game.publicDebtIssues||[]).filter(item=>
        item.bankId===bank.id && ['active','defaulted'].includes(item.status))
        .reduce((sum,item)=>sum+item.principalOutstanding,0);
      if(amount>bank.loanLimit-bankExposure)
        return {ok:false,code:'FINANCE_BANK_LENDING_LIMIT',error:'The requested debt exceeds this bank’s configured lending limit after outstanding public credit.'};
      const available=bank.cashBalance-(bank.minimumReserve||0);
      if (available<amount)
        return {ok:false,code:'FINANCE_BANK_LIQUIDITY',error:'The bank cannot lend this amount while preserving its configured minimum reserve.'};
      if (territory.treasury>Number.MAX_SAFE_INTEGER-amount)
        return {ok:false,code:'FINANCE_TREASURY_LIMIT',error:'The State treasury would exceed the supported balance limit.'};
      const maturityOn=addDays(game.worldDate,term);
      const issue={
        id:idFor(createId),stateId,bankId:bank.id,currencyId:territory.currencyId,
        originalPrincipal:amount,principalOutstanding:amount,interestAccrued:0,
        interestRemainder:0,annualInterestBasisPoints:rate,issuedOn:game.worldDate,
        maturityOn,status:'active',repaidOn:null,defaultedOn:null
      };
      const bankBefore=bank.cashBalance;
      const treasuryBefore=territory.treasury;
      bank.cashBalance-=amount;
      territory.treasury+=amount;
      game.publicDebtIssues.push(issue);
      game.bankTransactions.push({
        id:idFor(createId),bankId:bank.id,stateId,currencyId:bank.currencyId,
        type:'public_credit_issued',amount:-amount,balanceBefore:bankBefore,
        balanceAfter:bank.cashBalance,worldDate:game.worldDate,referenceId:issue.id
      });
      transaction(game,stateId,territory.currencyId,'publicDebtProceeds',amount,
        treasuryBefore,territory.treasury,'Public debt issued to '+bank.name+'.',
        createId,{orderId:order.orderId,membershipId:membership.id,referenceId:issue.id});
      history(game,'public_debt_issued',stateId,
        'The State borrowed '+amount+' '+territory.currencyId+' from '+bank.name+'.',
        {issueId:issue.id,bankId:bank.id,principal:amount,annualInterestBasisPoints:rate,maturityOn},createId);
      return {ok:true,issueId:issue.id};
    }

    if (order.type==='finance.repayPublicDebt') {
      const issue=(game.publicDebtIssues||[]).find(item=>
        item.id===order.issueId && item.stateId===stateId &&
        ['active','defaulted'].includes(item.status));
      if (!issue) return {ok:false,code:'FINANCE_DEBT_NOT_FOUND',error:'The selected public debt is not outstanding in this State.'};
      const bank=(game.financialBanks||[]).find(item=>item.id===issue.bankId);
      if (!bank || bank.currencyId!==issue.currencyId)
        return {ok:false,code:'FINANCE_BANK_RECORD_MISSING',error:'The creditor bank or matching currency account is unavailable.'};
      const amount=order.amount;
      const due=issue.principalOutstanding+issue.interestAccrued;
      if (!safeInteger(amount,1,2147483647) || amount>due || amount>territory.treasury)
        return {ok:false,code:'FINANCE_REPAYMENT_INVALID',error:'Repayment must be a positive whole amount no greater than the debt due or the State treasury.'};
      if (bank.cashBalance>Number.MAX_SAFE_INTEGER-amount)
        return {ok:false,code:'FINANCE_BANK_LIMIT',error:'The bank cash balance would exceed the supported limit.'};
      const treasuryBefore=territory.treasury;
      const bankBefore=bank.cashBalance;
      territory.treasury-=amount;
      bank.cashBalance+=amount;
      const interestPaid=Math.min(amount,issue.interestAccrued);
      issue.interestAccrued-=interestPaid;
      const principalPaid=amount-interestPaid;
      issue.principalOutstanding-=principalPaid;
      if(issue.status==='defaulted')
        bank.nonPerformingPrincipal=Math.max(0,(Number(bank.nonPerformingPrincipal)||0)-principalPaid);
      if (issue.principalOutstanding===0 && issue.interestAccrued===0) {
        issue.status='repaid';issue.repaidOn=game.worldDate;
      } else if (issue.status==='defaulted') {
        issue.status='defaulted';
      }
      game.bankTransactions.push({
        id:idFor(createId),bankId:bank.id,stateId,currencyId:bank.currencyId,
        type:'public_debt_repayment',amount,balanceBefore:bankBefore,
        balanceAfter:bank.cashBalance,worldDate:game.worldDate,referenceId:issue.id
      });
      transaction(game,stateId,issue.currencyId,'publicDebtRepayment',-amount,
        treasuryBefore,territory.treasury,'Public debt repayment to '+bank.name+'.',
        createId,{orderId:order.orderId,membershipId:membership.id,referenceId:issue.id});
      history(game,'public_debt_repaid',stateId,
        'The State repaid '+amount+' '+issue.currencyId+' to '+bank.name+'.',
        {issueId:issue.id,amount,interestPaid,principalPaid,principalOutstanding:issue.principalOutstanding,
          interestAccrued:issue.interestAccrued,status:issue.status},createId);
      return {ok:true,issueId:issue.id,interestPaid,principalPaid};
    }

    return {ok:false,code:'FINANCE_ORDER_UNSUPPORTED',error:'This financial order is not supported.'};
  }

  function assessTaxes(game,createId) {
    const assessments=[];
    const sales=(game.companyFinancialTransactions||[]).filter(item=>
      item.worldDate===game.worldDate && ['MarketSale','TradeSale'].includes(item.type) &&
      Number.isSafeInteger(item.amount) && item.amount>0);
    for (const rule of game.taxRules||[]) {
      if (rule.effectiveOn>game.worldDate || (rule.expiresOn && rule.expiresOn<game.worldDate)) continue;
      const territory=territoryFor(game,rule.stateId);
      if (!territory || territory.currencyId!==rule.currencyId) continue;
      const companies=(game.companies||[]).filter(item=>item.stateId===rule.stateId);
      for (const company of companies) {
        company.taxArrears ||= {};
        const turnover=sales.filter(item=>item.companyId===company.id &&
          item.currencyId===rule.currencyId).reduce((sum,item)=>sum+item.amount,0);
        if(!Number.isSafeInteger(turnover))
          throw new Error('Company turnover exceeds the supported integer accounting range.');
        const currentDue=Number(BigInt(turnover)*BigInt(rule.rateBasisPoints)/10000n);
        const arrears=Number(company.taxArrears[rule.id])||0;
        const totalDue=currentDue+arrears;
        if (!Number.isSafeInteger(totalDue) || totalDue<0)
          throw new Error('Tax assessment exceeds the supported numeric range.');
        if (totalDue===0) continue;
        company.cashBalances ||= {};
        const before=Number(company.cashBalances[rule.currencyId])||0;
        if(!Number.isSafeInteger(before)||before<0)
          throw new Error('A company has an invalid cash balance for the applicable tax currency.');
        if(territory.treasury>Number.MAX_SAFE_INTEGER-totalDue)
          throw new Error('Tax receipts exceed the supported State treasury limit.');
        const paid=Math.min(before,totalDue);
        const after=before-paid;
        company.cashBalances[rule.currencyId]=after;
        company.taxArrears[rule.id]=totalDue-paid;
        territory.treasury+=paid;
        if (!Number.isSafeInteger(territory.treasury))
          throw new Error('Tax receipts exceed the supported State treasury limit.');
        const assessment={
          id:idFor(createId),stateId:rule.stateId,companyId:company.id,taxRuleId:rule.id,
          currencyId:rule.currencyId,worldDate:game.worldDate,turnover,currentDue,
          arrearsBefore:arrears,amountDue:totalDue,amountPaid:paid,
          arrearsAfter:totalDue-paid,status:paid===totalDue?'paid':paid>0?'partially_paid':'unpaid'
        };
        game.taxAssessments.push(assessment);
        game.companyFinancialTransactions.push({
          id:idFor(createId),companyId:company.id,stateId:company.stateId,
          currencyId:rule.currencyId,type:'TaxPayment',amount:-paid,
          balanceBefore:before,balanceAfter:after,worldDate:game.worldDate,
          description:'Daily company-turnover tax: '+rule.name+'.'
        });
        transaction(game,rule.stateId,rule.currencyId,'companyTurnoverTax',paid,
          territory.treasury-paid,territory.treasury,
          'Collected '+paid+' in company-turnover tax from '+company.name+'.',
          createId,{referenceId:assessment.id});
        assessments.push(assessment);
      }
    }
    return assessments;
  }

  function calculatePriceIndices(game,createId) {
    const results=[];
    for (const config of game.priceIndexConfigs||[]) {
      if (config.baseDate>game.worldDate) continue;
      if (game.priceIndexHistory.some(item=>item.configId===config.id && item.worldDate===game.worldDate))
        continue;
      let index=0;
      let missing=false;
      for (const item of config.items) {
        const market=(game.markets||[]).find(candidate=>
          candidate.stateId===config.stateId && candidate.goodId===item.goodId);
        if (!market || !finite(market.currentPrice,1,Number.MAX_SAFE_INTEGER)) {
          missing=true;break;
        }
        index+=item.weightBasisPoints*(market.currentPrice/item.basePrice)/100;
      }
      if (missing) continue;
      const previous=game.priceIndexHistory.filter(item=>item.configId===config.id)
        .sort((a,b)=>b.worldDate.localeCompare(a.worldDate))[0];
      const change=previous ? (index/previous.indexValue-1)*100 : null;
      const entry={
        id:idFor(createId),configId:config.id,stateId:config.stateId,currencyId:config.currencyId,
        worldDate:game.worldDate,name:config.name,indexValue:Number(index.toFixed(4)),
        changeSincePreviousPercent:change===null?null:Number(change.toFixed(6)),
        baseDate:config.baseDate,itemCount:config.items.length
      };
      game.priceIndexHistory.push(entry);
      results.push(entry);
    }
    return results;
  }

  function advanceDay(game,createId) {
    ensure(game);
    if (game.financeCycleDate===game.worldDate && game.financeCycleResult)
      return {ok:true,replayed:true,result:clone(game.financeCycleResult)};
    const accrued=[];
    const yearDays=daysInYear(game.worldDate);
    const denominator=BigInt(10000*yearDays);
    for (const issue of game.publicDebtIssues) {
      if (!['active','defaulted'].includes(issue.status) || issue.principalOutstanding<=0) continue;
      const numerator=BigInt(issue.principalOutstanding)*BigInt(issue.annualInterestBasisPoints)+
        BigInt(issue.interestRemainder||0);
      const whole=numerator/denominator;
      issue.interestRemainder=Number(numerator%denominator);
      if (whole>0n) {
        if (whole>BigInt(Number.MAX_SAFE_INTEGER-issue.interestAccrued))
          throw new Error('Public debt interest exceeds the supported balance limit.');
        issue.interestAccrued+=Number(whole);
      }
      if (issue.status==='active' && game.worldDate>=issue.maturityOn) {
        issue.status='defaulted';
        issue.defaultedOn=game.worldDate;
        const bank=(game.financialBanks||[]).find(item=>item.id===issue.bankId);
        if(bank) {
          bank.nonPerformingPrincipal=(Number(bank.nonPerformingPrincipal)||0)+issue.principalOutstanding;
          game.bankTransactions.push({
            id:idFor(createId),bankId:bank.id,stateId:issue.stateId,currencyId:issue.currencyId,
            type:'public_debt_default',amount:0,balanceBefore:bank.cashBalance,
            balanceAfter:bank.cashBalance,worldDate:game.worldDate,referenceId:issue.id,
            nonPerformingPrincipal:issue.principalOutstanding
          });
        }
        history(game,'public_debt_defaulted',issue.stateId,
          'A public debt issue reached maturity with an unpaid principal balance.',
          {issueId:issue.id,principalOutstanding:issue.principalOutstanding,
            interestAccrued:issue.interestAccrued,maturityOn:issue.maturityOn},createId);
      }
      accrued.push({issueId:issue.id,interestAccrued:issue.interestAccrued,
        principalOutstanding:issue.principalOutstanding,status:issue.status});
    }
    const taxResults=assessTaxes(game,createId);
    const indexResults=calculatePriceIndices(game,createId);
    const result={accrued,taxes:taxResults,priceIndices:indexResults};
    game.financeCycleDate=game.worldDate;
    game.financeCycleResult=clone(result);
    for (const field of ['taxAssessments','priceIndexHistory','financeHistory','bankTransactions'])
      if (game[field].length>10000) game[field].splice(0,game[field].length-10000);
    return {ok:true,replayed:false,result};
  }

  const api=Object.freeze({
    ensure,validateConfiguration,applyOrder,advanceDay,convertCurrency,
    configurationFields:CONFIG_FIELDS,dynamicFields:DYNAMIC_FIELDS
  });
  globalThis.NewWorldFinance=api;
  if (typeof module!=='undefined' && module.exports) module.exports=api;
})();