export const Registry = {};
export function register(kind, def) { Registry[kind] = Object.assign({ kind }, def); }
export function kinds() { return Object.keys(Registry); }

function applyBalances(host, ids, balances) {
  for (const id of ids) {
    const p = host.players.get(id);
    if (p) { p.balance = Math.max(0, p.balance + (balances[id] || 0)); p.dirty = true; }
  }
}

function transfer(host, act, winners, losers) {
  const ids = act.players;
  const stake = Math.max(0, Math.min(act.stake, ...ids.map(id => (host.players.get(id) || { balance: 0 }).balance)));
  const balances = {};
  for (const id of ids) balances[id] = 0;
  if (losers.length) {
    const each = winners.length ? Math.floor(stake / winners.length) : 0;
    for (const id of losers) balances[id] = -stake;
    for (const id of winners) balances[id] = each;
    applyBalances(host, ids, balances);
  }
  return balances;
}

function finish(act, result, balances, extra) {
  return {
    done: true,
    update: Object.assign({ result, balances, stake: act.stake, settledAt: Date.now() }, extra || {})
  };
}

function twoPlayerValidate(host, act) {
  if (act.players.length !== 2) return 'need-two-players';
  for (const id of act.players) {
    const p = host.players.get(id);
    if (!p) return 'unknown-player';
    if (p.balance < 1) return 'no-balance';
  }
  return null;
}

function readPick(payload) {
  return payload ? (payload.pick != null ? payload.pick : payload.side) : null;
}

register('coinflip', {
  label: 'COINFLIP',
  minPlayers: 2,
  maxPlayers: 2,
  prompt: 'PICK HEADS OR TAILS BELOW',
  choices: [{ v: 'heads', label: 'HEADS', cls: 'red' }, { v: 'tails', label: 'TAILS', cls: 'dark' }],
  resultLabel: act => String(act.result || '').toUpperCase(),
  validate(host, act) { return twoPlayerValidate(host, act); },
  input(host, act, uid, payload) {
    const side = readPick(payload);
    if (side !== 'heads' && side !== 'tails') return { error: 'bad-pick' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = side;
    const ids = act.players;
    if (!ids.every(id => act.inputs[id])) return {};
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const winners = ids.filter(id => act.inputs[id] === result);
    const losers = ids.filter(id => act.inputs[id] !== result);
    return finish(act, result, transfer(host, act, winners, losers));
  }
});

register('slots', {
  label: 'SLOTS',
  minPlayers: 1,
  maxPlayers: 1,
  prompt: 'PULL THE LEVER BELOW',
  pickInfo: () => 'Triple 7 pays ×10 · any triple ×5 · any pair or cherry ×2',
  choices: [{ v: 'spin', label: 'SPIN', cls: 'red' }],
  resultLabel: act => String(act.result || '').toUpperCase(),
  validate(host, act) {
    if (act.players.length !== 1) return 'need-one-player';
    const p = host.players.get(act.players[0]);
    if (!p) return 'unknown-player';
    if (p.balance < 1) return 'no-balance';
    return null;
  },
  input(host, act, uid, payload) {
    if (readPick(payload) !== 'spin') return { error: 'bad-pick' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = 'spin';
    const SYMS = ['7', 'BAR', 'BELL', 'CHERRY', 'LEMON', 'GRAPE', 'PLUM'];
    const reels = [0, 1, 2].map(() => SYMS[Math.floor(Math.random() * SYMS.length)]);
    const count = s => reels.filter(x => x === s).length;
    let mult = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) mult = reels[0] === '7' ? 10 : 5;
    else if (count('7') === 2) mult = 4;
    else if (count('CHERRY') >= 1) mult = 2;
    else if (new Set(reels).size === 2) mult = 2;
    const p = host.players.get(uid);
    const stake = Math.max(1, Math.min(act.stake, p ? p.balance : 1));
    const balances = {};
    for (const id of act.players) balances[id] = 0;
    balances[uid] = mult > 0 ? stake * mult - stake : -stake;
    applyBalances(host, act.players, balances);
    return finish(act, reels.join(' · '), balances, { data: Object.assign({}, act.data, { mult }) });
  }
});

const HL_CARD = () => 1 + Math.floor(Math.random() * 13);

register('highlow', {
  label: 'HIGH-LOW',
  minPlayers: 2,
  maxPlayers: 2,
  prompt: 'WILL THE NEXT CARD BE HIGHER OR LOWER?',
  pickInfo: act => 'Base card: ' + (act.data && act.data.card != null ? act.data.card : '?') + ' · equal value is a push',
  choices: [{ v: 'high', label: 'HIGHER', cls: 'red' }, { v: 'low', label: 'LOWER', cls: 'dark' }],
  resultLabel: act => String(act.result || '').toUpperCase(),
  validate(host, act) {
    const e = twoPlayerValidate(host, act);
    if (e) return e;
    if (act.data.card == null) act.data.card = HL_CARD();
    return null;
  },
  input(host, act, uid, payload) {
    const v = readPick(payload);
    if (v !== 'high' && v !== 'low') return { error: 'bad-pick' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = v;
    const ids = act.players;
    if (!ids.every(id => act.inputs[id])) return {};
    const next = HL_CARD();
    act.data.next = next;
    const base = act.data.card;
    const result = base + ' → ' + next;
    let winners = [], losers = [];
    if (next !== base) {
      const right = next > base ? 'high' : 'low';
      const same = ids.every(id => act.inputs[id] === act.inputs[ids[0]]);
      if (!same) {
        winners = ids.filter(id => act.inputs[id] === right);
        losers = ids.filter(id => act.inputs[id] !== right);
      }
    }
    return finish(act, result, transfer(host, act, winners, losers));
  }
});

const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

register('rps', {
  label: 'ROCK PAPER SCISSORS',
  minPlayers: 2,
  maxPlayers: 2,
  prompt: 'PICK ROCK, PAPER OR SCISSORS',
  choices: [
    { v: 'rock', label: 'ROCK', cls: 'dark' },
    { v: 'paper', label: 'PAPER', cls: 'red' },
    { v: 'scissors', label: 'SCISSORS', cls: 'dark' }
  ],
  resultLabel: act => String(act.result || '').toUpperCase(),
  validate(host, act) { return twoPlayerValidate(host, act); },
  input(host, act, uid, payload) {
    const v = readPick(payload);
    if (!RPS_BEATS[v]) return { error: 'bad-pick' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = v;
    const ids = act.players;
    if (!ids.every(id => act.inputs[id])) return {};
    const a = act.inputs[ids[0]], b = act.inputs[ids[1]];
    const result = a + '/' + b;
    let winners = [], losers = [];
    if (a !== b) {
      const winner = RPS_BEATS[a] === b ? ids[0] : ids[1];
      winners = [winner];
      losers = ids.filter(id => id !== winner);
    }
    return finish(act, result, transfer(host, act, winners, losers));
  }
});

const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

register('roulette', {
  label: 'ROULETTE',
  minPlayers: 2,
  maxPlayers: 6,
  prompt: 'BET RED, BLACK — OR GREEN',
  pickInfo: () => 'The wheel has 18 red, 18 black and a green 0 · green takes every bet',
  choices: [
    { v: 'red', label: 'RED', cls: 'red' },
    { v: 'black', label: 'BLACK', cls: 'dark' },
    { v: 'green', label: 'GREEN', cls: 'green' }
  ],
  resultLabel: act => String(act.result || '').toUpperCase(),
  validate(host, act) {
    if (act.players.length < 2) return 'need-two-players';
    for (const id of act.players) {
      const p = host.players.get(id);
      if (!p) return 'unknown-player';
      if (p.balance < 1) return 'no-balance';
    }
    return null;
  },
  input(host, act, uid, payload) {
    const v = readPick(payload);
    if (v !== 'red' && v !== 'black' && v !== 'green') return { error: 'bad-pick' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = v;
    const ids = act.players;
    if (!ids.every(id => act.inputs[id])) return {};
    const n = Math.floor(Math.random() * 37);
    act.data.n = n;
    const color = n === 0 ? 'green' : (ROULETTE_RED.has(n) ? 'red' : 'black');
    const result = (n === 0 ? 'GREEN' : color.toUpperCase()) + ' ' + n;
    const winners = color === 'green' ? [] : ids.filter(id => act.inputs[id] === color);
    const losers = ids.filter(id => !winners.includes(id));
    return finish(act, result, transfer(host, act, winners, losers));
  }
});

const HAND_NAMES = ['HIGH CARD', 'PAIR', 'TWO PAIR', 'THREE OF A KIND', 'STRAIGHT', 'FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH'];

function eval5(cs) {
  const ranks = cs.map(c => c % 13).sort((a, b) => b - a);
  const suits = cs.map(c => Math.floor(c / 13));
  const flush = suits.every(s => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 4 && uniq[4] === 1) straightHigh = 3;
  }
  const fc = {};
  for (const r of ranks) fc[r] = (fc[r] || 0) + 1;
  const groups = Object.keys(fc).map(r => ({ r: +r, c: fc[r] })).sort((a, b) => b.c - a.c || b.r - a.r);
  let cat, tie;
  if (flush && straightHigh >= 0) { cat = 8; tie = [straightHigh]; }
  else if (groups[0].c === 4) { cat = 7; tie = [groups[0].r, groups[1].r]; }
  else if (groups[0].c === 3 && groups[1] && groups[1].c === 2) { cat = 6; tie = [groups[0].r, groups[1].r]; }
  else if (flush) { cat = 5; tie = ranks; }
  else if (straightHigh >= 0) { cat = 4; tie = [straightHigh]; }
  else if (groups[0].c === 3) { cat = 3; tie = [groups[0].r, groups[1].r, groups[2].r]; }
  else if (groups[0].c === 2 && groups[1] && groups[1].c === 2) { cat = 2; tie = [Math.max(groups[0].r, groups[1].r), Math.min(groups[0].r, groups[1].r), groups[2].r]; }
  else if (groups[0].c === 2) { cat = 1; tie = [groups[0].r].concat(groups.slice(1).map(g => g.r)); }
  else { cat = 0; tie = ranks; }
  return { cat, tie };
}

function cmpTie(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] == null ? -1 : a[i], y = b[i] == null ? -1 : b[i];
    if (x !== y) return x - y;
  }
  return 0;
}

function cmpHand(a, b) { return a.cat !== b.cat ? a.cat - b.cat : cmpTie(a.tie, b.tie); }

function rank7(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const h = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || cmpHand(h, best) > 0) best = h;
          }
  return best;
}

register('poker', {
  label: 'HEADS-UP POKER',
  minPlayers: 2,
  maxPlayers: 2,
  prompt: 'CALL TO SEE THE SHOWDOWN OR FOLD',
  pickInfo: () => 'Five private cards plus a shared board · best five-card hand wins',
  choices: [{ v: 'call', label: 'CALL', cls: 'red' }, { v: 'fold', label: 'FOLD', cls: 'dark' }],
  resultLabel: act => (act.data && act.data.win) || String(act.result || '').toUpperCase(),
  subLabel: act => act.data && act.data.beats ? 'beats ' + act.data.beats : null,
  validate(host, act) { return twoPlayerValidate(host, act); },
  redact(out) {
    if (out.phase !== 'result') out.data = { hidden: true };
    return out;
  },
  deal(host, act) {
    const deck = [];
    for (let i = 0; i < 52; i++) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    act.data.hands = {};
    for (const id of act.players) act.data.hands[id] = deck.splice(0, 5);
    act.data.board = deck.splice(0, 5);
    return act.players.map(id => ({ uid: id, cards: act.data.hands[id] }));
  },
  input(host, act, uid, payload) {
    const v = readPick(payload);
    if (v !== 'call' && v !== 'fold') return { error: 'bad-pick' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = v;
    const ids = act.players;
    const folder = ids.find(id => act.inputs[id] === 'fold');
    if (folder) {
      const winner = ids.find(id => id !== folder);
      act.data.win = 'FOLD';
      return finish(act, 'fold', transfer(host, act, [winner], [folder]));
    }
    if (!ids.every(id => act.inputs[id])) return {};
    const board = act.data.board || [];
    const evals = {};
    for (const id of ids) evals[id] = rank7((act.data.hands[id] || []).concat(board));
    const cmp = cmpHand(evals[ids[0]], evals[ids[1]]);
    if (cmp === 0) {
      act.data.win = HAND_NAMES[evals[ids[0]].cat];
      act.data.beats = null;
      return finish(act, HAND_NAMES[evals[ids[0]].cat] + ' TIE', transfer(host, act, [], []));
    }
    const winId = cmp > 0 ? ids[0] : ids[1];
    const winCat = cmp > 0 ? evals[ids[0]].cat : evals[ids[1]].cat;
    const loseCat = cmp > 0 ? evals[ids[1]].cat : evals[ids[0]].cat;
    act.data.win = HAND_NAMES[winCat];
    act.data.beats = HAND_NAMES[loseCat];
    return finish(act, HAND_NAMES[winCat], transfer(host, act, [winId], [ids.find(id => id !== winId)]));
  }
});
