'use strict';

// Room + game state. No sockets in here, so it is easy to test.
// The solution NEVER leaves this module until a case is finished.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { publicPuzzle } = require('./puzzle');
const i18n = require('./i18n');

const HOTEL_NAME = process.env.HOTEL_NAME || 'The Grand Hotel';
const MAX_PLAYERS = 8;
const MAX_STRIKES = 3;
const N = 6;
const CELLS = N * N;
const AVATARS = ['🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐝', '🐧'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MAX_ROOMS = 500;

let bank = null;
function puzzleBank() {
  if (!bank) {
    const file = path.join(__dirname, '..', 'data', 'puzzles.json');
    bank = JSON.parse(fs.readFileSync(file, 'utf8')).puzzles;
  }
  return bank;
}

const rooms = new Map();

// Every error goes through the caller's language, falling back to English.
const err = (lang, key, vars) => ({ error: i18n.t(lang || 'en', key, vars) });
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function cleanName(raw) {
  return String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}

function newCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

const emptyBoard = () => ({
  placed: new Array(N).fill(-1),
  placedBy: new Array(N).fill(null),
  notes: {},
  struck: [],
});

function log(room, kind, text) {
  room.logSeq += 1;
  room.log.push({ id: room.logSeq, kind, text });
  if (room.log.length > 30) room.log.shift();
}

// Log lines are rendered once, in the language of whoever triggered them.
// That's the right trade-off: a French player's join message stays French
// for everyone, which is what real chat looks like.
function logKey(room, kind, lang, key, vars) {
  log(room, kind, i18n.t(lang || 'en', key, vars));
}

function addPlayer(room, rawName, lang) {
  const usedAvatars = new Set([...room.players.values()].map((p) => p.avatar));
  const avatar = AVATARS.find((a) => !usedAvatars.has(a)) || AVATARS[0];
  const base = cleanName(rawName) || i18n.t(lang || 'en', 'ui.guest');
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
  const player = {
    id: crypto.randomBytes(9).toString('hex'),
    name,
    avatar,
    lang: lang || 'en',
    socketId: null,
    lastSeen: Date.now(),
  };
  room.players.set(player.id, player);
  return player;
}

// ---------- room lifecycle ----------

function createRoom(name, lang) {
  if (rooms.size >= MAX_ROOMS) return err(lang, 'error.hotelFull');
  const code = newCode();
  if (!code) return err(lang, 'error.couldNotCreate');
  const room = {
    code,
    hostId: null,
    phase: 'lobby',
    difficulty: 'medium',
    players: new Map(),
    puzzle: null,
    pub: null,
    board: emptyBoard(),
    strikes: 0,
    startedAt: null,
    endedAt: null,
    result: null,
    used: new Set(),
    log: [],
    logSeq: 0,
    lastActive: Date.now(),
  };
  const player = addPlayer(room, name, lang);
  room.hostId = player.id;
  rooms.set(code, room);
  return { room, player };
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

function joinRoom(code, name, lang) {
  const room = getRoom(code);
  if (!room) return err(lang, 'error.noSuchRoom');
  if (room.players.size >= MAX_PLAYERS) return err(lang, 'error.roomFull');
  const player = addPlayer(room, name, lang);
  room.lastActive = Date.now();
  logKey(room, 'join', lang, 'log.joined', { avatar: player.avatar, name: player.name });
  return { room, player };
}

function rejoin(code, playerId, lang) {
  const room = getRoom(code);
  if (!room) return err(lang, 'error.roomClosed');
  const player = room.players.get(String(playerId || ''));
  if (!player) return err(lang, 'error.notInRoomAnymore');
  if (lang) player.lang = lang;   // they may have switched language since
  return { room, player };
}

function markOnline(room, playerId, socketId) {
  const p = room.players.get(playerId);
  if (!p) return;
  p.socketId = socketId;
  p.lastSeen = Date.now();
  room.lastActive = Date.now();
}

function markOffline(room, playerId, socketId) {
  const p = room.players.get(playerId);
  if (!p || p.socketId !== socketId) return false; // they already reconnected elsewhere
  p.socketId = null;
  p.lastSeen = Date.now();
  return true;
}

function reassignHostIfNeeded(room) {
  const host = room.players.get(room.hostId);
  if (host && host.socketId) return false;
  const next = [...room.players.values()].find((p) => p.socketId);
  if (!next) return false;
  room.hostId = next.id;
  logKey(room, 'host', next.lang, 'log.newHost', { avatar: next.avatar, name: next.name });
  return true;
}

function leaveRoom(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  room.players.delete(playerId);
  if (!room.players.size) { rooms.delete(room.code); return; }
  logKey(room, 'leave', p.lang, 'log.left', { avatar: p.avatar, name: p.name });
  if (room.hostId === playerId) {
    const next = [...room.players.values()].find((x) => x.socketId) || [...room.players.values()][0];
    room.hostId = next.id;
    logKey(room, 'host', next.lang, 'log.newHost', { avatar: next.avatar, name: next.name });
  }
}

// ---------- game flow ----------

function startGame(room, playerId, difficulty) {
  const actor = room.players.get(playerId);
  const lang = actor ? actor.lang : 'en';
  if (room.hostId !== playerId) return err(lang, 'error.hostOnly');
  if (room.phase === 'playing') return err(lang, 'error.alreadyPlaying');
  if (DIFFICULTIES.includes(difficulty)) room.difficulty = difficulty;
  const candidates = puzzleBank().filter((p) => p.difficulty === room.difficulty);
  if (!candidates.length) return err(lang, 'error.noPuzzles');
  let fresh = candidates.filter((p) => !room.used.has(p.id));
  if (!fresh.length) { room.used.clear(); fresh = candidates; }
  const p = fresh[crypto.randomInt(fresh.length)];
  room.used.add(p.id);

  room.puzzle = p;
  room.pub = publicPuzzle(p, HOTEL_NAME);
  room.board = emptyBoard();
  room.strikes = 0;
  room.result = null;
  room.phase = 'playing';
  room.startedAt = Date.now();
  room.endedAt = null;
  room.lastActive = Date.now();
  // The title is structured now, so render it in the actor's language.
  const title = (p.title && typeof p.title === 'object')
    ? i18n.t(lang, 'title.foundDead', {
        name: p.title.victimName,
        room: i18n.t(lang, `room.${p.layoutId}.${p.title.victimRoom}`),
      })
    : p.title;
  logKey(room, 'start', lang, 'log.newCase', { title });
  return { ok: true };
}

function backToLobby(room, playerId) {
  const actor = room.players.get(playerId);
  const lang = actor ? actor.lang : 'en';
  if (room.hostId !== playerId) return err(lang, 'error.hostOnly');
  if (room.phase === 'playing') return err(lang, 'error.finishFirst');
  room.phase = 'lobby';
  room.puzzle = null;
  room.pub = null;
  room.result = null;
  room.board = emptyBoard();
  return { ok: true };
}

function removeNote(board, cell, staff) {
  const list = board.notes[cell];
  if (!list) return;
  const next = list.filter((s) => s !== staff);
  if (next.length) board.notes[cell] = next;
  else delete board.notes[cell];
}

function place(room, playerId, staff, cell) {
  const actor = room.players.get(playerId);
  const lang = actor ? actor.lang : 'en';
  if (room.phase !== 'playing') return err(lang, 'error.noCase');
  if (!isInt(staff, 0, N - 1) || !isInt(cell, 0, CELLS - 1)) return err(lang, 'error.badMove');
  if (cell === room.puzzle.victim.cell) return err(lang, 'error.victimCell');
  const b = room.board;
  if (b.placed[staff] === cell) {
    b.placed[staff] = -1;
    b.placedBy[staff] = null;
  } else {
    for (let s = 0; s < N; s++) {
      if (b.placed[s] === cell) { b.placed[s] = -1; b.placedBy[s] = null; }
    }
    b.placed[staff] = cell;
    b.placedBy[staff] = playerId;
    removeNote(b, cell, staff);
  }
  room.lastActive = Date.now();
  return { ok: true };
}

function note(room, playerId, staff, cell) {
  const actor = room.players.get(playerId);
  const lang = actor ? actor.lang : 'en';
  if (room.phase !== 'playing') return err(lang, 'error.noCase');
  if (!isInt(staff, 0, N - 1) || !isInt(cell, 0, CELLS - 1)) return err(lang, 'error.badMove');
  if (cell === room.puzzle.victim.cell) return err(lang, 'error.victimCell');
  const b = room.board;
  if (b.placed[staff] === cell) return { ok: true };
  const list = b.notes[cell] ? b.notes[cell].slice() : [];
  const at = list.indexOf(staff);
  if (at >= 0) list.splice(at, 1); else list.push(staff);
  if (list.length) b.notes[cell] = list.sort((x, y) => x - y);
  else delete b.notes[cell];
  room.lastActive = Date.now();
  return { ok: true };
}

function toggleClue(room, playerId, index) {
  const actor = room.players.get(playerId);
  const lang = actor ? actor.lang : 'en';
  if (room.phase !== 'playing') return err(lang, 'error.noCase');
  if (!isInt(index, 0, room.puzzle.clues.length - 1)) return err(lang, 'error.noSuchClue');
  room.board.struck[index] = !room.board.struck[index];
  room.lastActive = Date.now();
  return { ok: true };
}

function finish(room, phase) {
  room.phase = phase;
  room.endedAt = Date.now();
  room.result = {
    culprit: room.puzzle.culprit,
    culpritName: room.puzzle.staff[room.puzzle.culprit].name,
    solution: room.puzzle.solution.slice(),
  };
}

// A win needs BOTH the right board and the right suspect, so guessing among
// six names is not enough. Wrong answers cost a strike and never say which part was wrong.
function accuse(room, playerId, staff) {
  const actor = room.players.get(playerId);
  const lang = actor ? actor.lang : 'en';
  if (room.phase !== 'playing') return err(lang, 'error.noCase');
  if (!isInt(staff, 0, N - 1)) return err(lang, 'error.pickStaff');
  const b = room.board;
  if (b.placed.some((c) => c < 0)) return err(lang, 'error.placeAllFirst');
  const who = actor ? `${actor.avatar} ${actor.name}` : i18n.t(lang, 'ui.someone');
  const accused = room.puzzle.staff[staff].name;
  const boardRight = b.placed.every((c, i) => c === room.puzzle.solution[i]);
  const suspectRight = staff === room.puzzle.culprit;
  room.lastActive = Date.now();

  if (boardRight && suspectRight) {
    finish(room, 'won');
    logKey(room, 'win', lang, 'log.win', { who, accused });
    return { ok: true, outcome: 'won' };
  }
  room.strikes += 1;
  const why = boardRight ? 'log.wrongSuspect' : 'log.wrongBoard';
  if (room.strikes >= MAX_STRIKES) {
    finish(room, 'lost');
    logKey(room, 'lose', lang, 'log.lose', { who, accused, strikes: room.strikes });
    return { ok: true, outcome: 'lost' };
  }
  logKey(room, 'accuse', lang, 'log.strike', {
    who, accused, strikes: room.strikes, max: MAX_STRIKES,
    why: i18n.t(lang, why),
  });
  return { ok: true, outcome: 'strike' };
}

// ---------- what clients see ----------

function stateFor(room) {
  const s = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    difficulty: room.difficulty,
    hotel: HOTEL_NAME,
    maxStrikes: MAX_STRIKES,
    strikes: room.strikes,
    serverTime: Date.now(),
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, online: !!p.socketId, lang: p.lang,
    })),
    log: room.log.slice(-12),
  };
  if (room.pub) {
    s.puzzle = room.pub;
    s.board = room.board;
    s.startedAt = room.startedAt;
    s.endedAt = room.endedAt;
  }
  if (room.result) s.result = room.result; // only exists once the case is over
  return s;
}

function sweep(now = Date.now()) {
  for (const [code, room] of rooms) {
    const anyOnline = [...room.players.values()].some((p) => p.socketId);
    const idle = now - room.lastActive;
    if ((!anyOnline && idle > 45 * 60 * 1000) || idle > 12 * 60 * 60 * 1000) rooms.delete(code);
  }
}

const roomCount = () => rooms.size;

module.exports = {
  HOTEL_NAME, MAX_STRIKES, createRoom, joinRoom, rejoin, getRoom, markOnline, markOffline,
  reassignHostIfNeeded, leaveRoom, startGame, backToLobby, place, note, toggleClue, accuse,
  stateFor, sweep, roomCount,
};