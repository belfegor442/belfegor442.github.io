'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
global.window = { NewWorldSimulation: require('../simulation.js') };

const multiplayer = require('../multiplayer.js');

function guest(id, name) {
  return {
    id,
    name,
    isHost:false,
    countryIndex:null,
    treasury:1200,
    dailyBalanceRemainder:0,
    buildings:{},
    connected:true,
    token:'token-' + id
  };
}

test('a new world assigns its host to the first State and transfers the starting treasury', () => {
  const { game, session } = multiplayer.createInitialWorld('Host');
  const host = game.players[0];
  const firstState = game.territories[0];
  const membership = game.memberships.find(item => item.playerId === host.id);

  assert.equal(session.playerId, host.id);
  assert.equal(host.countryIndex, 0);
  assert.equal(host.treasury, 0);
  assert.equal(firstState.ownerPlayerId, host.id);
  assert.equal(firstState.treasury, 1200);
  assert.equal(membership.stateId, firstState.stateId);
  assert.equal(membership.status, 'active');
  assert.equal(multiplayer.canStartWorld(game), true);
});

test('joining friends are assigned to different free States automatically and can start together', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const firstGuest = guest('guest-a', 'Friend A');
  const secondGuest = guest('guest-b', 'Friend B');
  game.players.push(firstGuest, secondGuest);

  const firstAssignment = multiplayer.assignLobbyPlayer(game, firstGuest);
  const secondAssignment = multiplayer.assignLobbyPlayer(game, secondGuest);

  assert.equal(firstAssignment.ok, true);
  assert.equal(secondAssignment.ok, true);
  assert.equal(firstGuest.countryIndex, 1);
  assert.equal(secondGuest.countryIndex, 2);
  assert.equal(game.territories[1].treasury, 1200);
  assert.equal(game.territories[2].treasury, 1200);
  assert.equal(multiplayer.canStartWorld(game), true);

  const started = multiplayer.applyAdmin(game, 'start', {});
  assert.equal(started.ok, true, started.error);
  assert.equal(game.started, true);
  assert.equal(game.status, 'running');
});

test('a lobby player can be assigned to an existing government when every State is occupied', () => {
  const { game } = multiplayer.createInitialWorld('Host');
  const player = guest('guest-shared', 'Shared government member');
  game.players.push(player);
  const assigned = multiplayer.assignLobbyPlayer(game, player);

  assert.equal(assigned.ok, true);
  assert.equal(player.countryIndex, 1);
  const moved = multiplayer.applyAdmin(game, 'assign', { playerId:player.id, countryIndex:0 });
  assert.equal(moved.ok, true);
  assert.equal(player.countryIndex, 0);
  assert.equal(game.memberships.some(item => item.playerId === player.id &&
    item.stateId === game.territories[0].stateId && item.status === 'active'), true);
});
