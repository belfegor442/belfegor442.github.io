export const Registry = {};
export function register(kind, def) { Registry[kind] = Object.assign({ kind }, def); }
export function kinds() { return Object.keys(Registry); }

register('coinflip', {
  label: 'COINFLIP',
  minPlayers: 2,
  maxPlayers: 2,
  validate(host, act) {
    if (act.players.length !== 2) return 'need-two-players';
    for (const id of act.players) {
      const p = host.players.get(id);
      if (!p) return 'unknown-player';
      if (p.balance < 1) return 'no-balance';
    }
    return null;
  },
  input(host, act, uid, payload) {
    const side = payload && (payload.side === 'heads' || payload.side === 'tails') ? payload.side : null;
    if (!side) return { error: 'bad-side' };
    if (act.inputs[uid]) return { error: 'already-picked' };
    act.inputs[uid] = side;
    const ids = act.players;
    if (!ids.every(id => act.inputs[id])) return {};

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const stake = Math.max(0, Math.min(act.stake, ...ids.map(id => host.players.get(id).balance)));
    const winners = ids.filter(id => act.inputs[id] === result);
    const losers = ids.filter(id => act.inputs[id] !== result);
    const balances = {};
    if (winners.length && losers.length) {
      const each = Math.floor(stake / winners.length);
      for (const id of winners) balances[id] = each;
      for (const id of losers) balances[id] = -each;
      for (const id of ids) {
        const p = host.players.get(id);
        if (p) p.balance = Math.max(0, p.balance + (balances[id] || 0));
      }
      for (const id of ids) {
        const p = host.players.get(id);
        if (p) p.dirty = true;
      }
    } else {
      for (const id of ids) balances[id] = 0;
    }
    act.result = result;
    act.balances = balances;
    return { done: true, update: { result, balances, stake, settledAt: Date.now() } };
  }
});
