'use strict';

// End-to-end multiplayer check: three "phones" talk to a real server over Socket.IO.
// Run with: node test/smoke.test.js

const assert = require('assert');
const { io } = require('socket.io-client');
const { createServer } = require('../server');
const { puzzles } = require('../data/puzzles.json');

const server = createServer().server;

function phone(port) {
  const socket = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const me = { socket, state: null, waiters: [] };
  socket.on('state', (st) => {
    me.state = st;
    me.waiters = me.waiters.filter((w) => { if (w.test(st)) { w.resolve(st); return false; } return true; });
  });
  me.emit = (event, data) => new Promise((resolve) => socket.emit(event, data, resolve));
  me.until = (test, ms = 3000) => new Promise((resolve, reject) => {
    if (me.state && test(me.state)) return resolve(me.state);
    const w = { test, resolve };
    me.waiters.push(w);
    setTimeout(() => reject(new Error('timed out waiting for state')), ms).unref();
  });
  return me;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const [host, bea, cal] = [phone(port), phone(port), phone(port)];

  // --- lobby ---
  const created = await host.emit('create', { name: 'Hana' });
  assert.ok(created.ok && /^[A-Z]{4}$/.test(created.code), 'room code looks right');
  const joinB = await bea.emit('join', { code: created.code.toLowerCase(), name: 'Bea' });
  const joinC = await cal.emit('join', { code: created.code, name: 'Cal' });
  assert.ok(joinB.ok && joinC.ok, 'friends can join (lowercase code works)');
  assert.strictEqual((await host.emit('join', { code: 'ZZZZ', name: 'X' })).ok, false, 'bad code is rejected');
  const lobby = await host.until((s) => s.players.length === 3);
  assert.strictEqual(lobby.phase, 'lobby');

  assert.strictEqual((await bea.emit('start', { difficulty: 'easy' })).ok, false, 'only the host can start');

  // --- start a case ---
  assert.ok((await host.emit('start', { difficulty: 'easy' })).ok);
  const playing = await cal.until((s) => s.phase === 'playing');
  assert.ok(!/solution|culprit/i.test(JSON.stringify(playing)), 'state must not leak the answer while playing');
  const secret = puzzles.find((p) => p.id === playing.puzzle.id);
  assert.ok(secret, 'puzzle exists in the bank');
  assert.strictEqual(playing.puzzle.clues.length, secret.clues.length);

  // --- co-op: everyone places pieces, everyone sees them ---
  assert.strictEqual((await bea.emit('place', { staff: 0, cell: secret.victim.cell })).ok, false, 'cannot stand on the victim');
  assert.strictEqual((await bea.emit('place', { staff: 9, cell: 3 })).ok, false, 'bad staff index rejected');
  await Promise.all(secret.solution.slice(0, 3).map((cell, s) => bea.emit('place', { staff: s, cell })));
  await Promise.all(secret.solution.slice(3).map((cell, i) => cal.emit('place', { staff: i + 3, cell })));
  await host.emit('note', { staff: 0, cell: (secret.solution[0] + 1) % 36 === secret.victim.cell ? 0 : (secret.solution[0] + 1) % 36 });
  await host.emit('clue', { index: 0 });
  const synced = await host.until((s) => s.board.placed.every((c) => c >= 0));
  assert.deepStrictEqual(synced.board.placed, secret.solution, 'host sees what the others placed');
  assert.strictEqual(synced.board.struck[0], true, 'struck clue is shared');
  assert.ok(synced.board.placedBy.every(Boolean), 'each placement remembers who made it');

  // --- accusations: right board + wrong suspect is a strike ---
  const wrong = [0, 1, 2, 3, 4, 5].find((s) => s !== secret.culprit);
  const strike = await bea.emit('accuse', { staff: wrong });
  assert.strictEqual(strike.outcome, 'strike');
  const afterStrike = await host.until((s) => s.strikes === 1);
  assert.strictEqual(afterStrike.phase, 'playing');
  assert.ok(!afterStrike.result, 'no reveal after a strike');

  // reconnect: a phone drops and comes back with its saved id
  cal.socket.disconnect();
  await host.until((s) => s.players.some((p) => p.name === 'Cal' && !p.online));
  const cal2 = phone(port);
  const back = await cal2.emit('rejoin', { code: created.code, playerId: joinC.playerId });
  assert.ok(back.ok, 'rejoin works');
  const seen = await cal2.until((s) => s.board && s.board.placed.every((c) => c >= 0));
  assert.strictEqual(seen.strikes, 1, 'rejoined phone sees the current game');
  assert.strictEqual((await phone(port).emit('rejoin', { code: created.code, playerId: 'nope' })).ok, false);

  const win = await cal2.emit('accuse', { staff: secret.culprit });
  assert.strictEqual(win.outcome, 'won');
  const won = await host.until((s) => s.phase === 'won');
  assert.strictEqual(won.result.culprit, secret.culprit, 'result reveals the culprit');
  assert.deepStrictEqual(won.result.solution, secret.solution);

  // --- play again, then lose by three bad accusations ---
  assert.strictEqual((await bea.emit('start', {})).ok, false, 'non-host cannot restart');
  assert.ok((await host.emit('start', { difficulty: 'hard' })).ok);
  const round2 = await host.until((s) => s.phase === 'playing' && s.puzzle.difficulty === 'hard');
  assert.ok(round2.board.placed.every((c) => c === -1) && round2.strikes === 0, 'fresh board');
  assert.ok(!round2.result, 'old result cleared');
  const secret2 = puzzles.find((p) => p.id === round2.puzzle.id);
  assert.strictEqual((await host.emit('accuse', { staff: 0 })).ok, false, 'cannot accuse with an empty board');
  await Promise.all(secret2.solution.map((cell, s) => host.emit('place', { staff: s, cell })));
  const notIt = [0, 1, 2, 3, 4, 5].filter((s) => s !== secret2.culprit);
  assert.strictEqual((await host.emit('accuse', { staff: notIt[0] })).outcome, 'strike');
  assert.strictEqual((await host.emit('accuse', { staff: notIt[1] })).outcome, 'strike');
  assert.strictEqual((await host.emit('accuse', { staff: notIt[2] })).outcome, 'lost');
  const lost = await bea.until((s) => s.phase === 'lost');
  assert.strictEqual(lost.result.culprit, secret2.culprit, 'loss reveals the culprit');

  // --- leaving hands the host role on ---
  assert.ok((await host.emit('leave', {})).ok);
  const afterLeave = await bea.until((s) => s.players.length === 2 && s.hostId !== created.playerId);
  assert.ok(afterLeave.players.some((p) => p.id === afterLeave.hostId), 'a new host was chosen');

  console.log('smoke.test OK: create/join, co-op board sync, strikes, win, lose, reconnect, host handover');
  process.exit(0);
})().catch((e) => { console.error('smoke.test FAILED:', e); process.exit(1); });
