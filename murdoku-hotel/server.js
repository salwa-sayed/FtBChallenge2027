'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const game = require('./lib/game');
const fs = require('fs');
const i18n = require('./lib/i18n');

function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, 'public')));
    // Serve locale JSON from the single locales/ folder.
  app.get('/locales/:lang', (req, res) => {
    const lang = String(req.params.lang || '').replace(/[^a-z-]/gi, '');
    const file = path.join(__dirname, 'locales', `${lang}.json`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'unknown language' });
    res.type('application/json').sendFile(file);
  });

  // Serve the shared i18n helper to the browser.
  app.get('/i18n.js', (req, res) => {
    res.type('application/javascript').sendFile(path.join(__dirname, 'lib', 'i18n.js'));
  });
  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: game.roomCount() }));

  const server = http.createServer(app);
  const io = new Server(server, { pingInterval: 10000, pingTimeout: 15000 });

  const broadcast = (room) => io.to(room.code).emit('state', game.stateFor(room));

  io.on('connection', (socket) => {
    // Simple token bucket: bursts of 30, refilling 10 per second.
    let tokens = 30;
    let last = Date.now();
    const allow = () => {
      const now = Date.now();
      tokens = Math.min(30, tokens + ((now - last) / 100));
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    const on = (event, handler) => {
      socket.on(event, (data, cb) => {
        if (typeof data === 'function') { cb = data; data = {}; }
        const reply = typeof cb === 'function' ? cb : () => {};
        if (!allow()) {
          const lang = (socket.data && socket.data.lang) || 'en';
          return reply({ ok: false, error: i18n.t(lang, 'error.slowDown') });
        }  try {
          handler(data && typeof data === 'object' ? data : {}, reply);
        } catch (e) {
          console.error(`handler ${event} failed:`, e);
          const lang = (socket.data && socket.data.lang) || 'en';
          reply({ ok: false, error: i18n.t(lang, 'error.serverError') });        
        }
      });
    };

    const attach = (room, player) => {
      socket.join(room.code);
      socket.data = { code: room.code, playerId: player.id, lang: player.lang || 'en' };
      game.markOnline(room, player.id, socket.id);
    };

    const current = () => {
      const { code, playerId } = socket.data || {};
      const room = code && game.getRoom(code);
      if (!room || !room.players.has(playerId)) return null;
      return { room, playerId };
    };

    // Runs a game action, replies to the caller, then tells the whole room.
    const act = (fn) => (data, reply) => {
      const cur = current();
      if (!cur) return reply({ ok: false, error: 'You are not in a room.' });
      const res = fn(cur.room, cur.playerId, data);
      if (res.error) return reply({ ok: false, error: res.error });
      reply({ ok: true, outcome: res.outcome });
      broadcast(cur.room);
    };

    on('create', (data, reply) => {
      const res = game.createRoom(data.name, data.lang);
      if (res.error) return reply({ ok: false, error: res.error });
      attach(res.room, res.player);
      reply({ ok: true, code: res.room.code, playerId: res.player.id });
      broadcast(res.room);
    });

    on('join', (data, reply) => {
      const res = game.joinRoom(data.code, data.name, data.lang);
      if (res.error) return reply({ ok: false, error: res.error });
      attach(res.room, res.player);
      reply({ ok: true, code: res.room.code, playerId: res.player.id });
      broadcast(res.room);
    });

    on('rejoin', (data, reply) => {
      const res = game.rejoin(data.code, data.playerId, data.lang);
      if (res.error) return reply({ ok: false, error: res.error });
      attach(res.room, res.player);
      reply({ ok: true, code: res.room.code, playerId: res.player.id });
      broadcast(res.room);
    });

    on('sync', (data, reply) => {
      const cur = current();
      if (!cur) return reply({ ok: false, error: 'You are not in a room.' });
      socket.emit('state', game.stateFor(cur.room));
      reply({ ok: true });
    });

    on('leave', (data, reply) => {
      const cur = current();
      if (cur) {
        socket.leave(cur.room.code);
        game.leaveRoom(cur.room, cur.playerId);
        socket.data = {};
        if (game.getRoom(cur.room.code)) broadcast(cur.room);
      }
      reply({ ok: true });
    });

    on('start', act((room, pid, d) => game.startGame(room, pid, d.difficulty)));
    on('lobby', act((room, pid) => game.backToLobby(room, pid)));
    on('place', act((room, pid, d) => game.place(room, pid, d.staff, d.cell)));
    on('note', act((room, pid, d) => game.note(room, pid, d.staff, d.cell)));
    on('clue', act((room, pid, d) => game.toggleClue(room, pid, d.index)));
    on('accuse', act((room, pid, d) => game.accuse(room, pid, d.staff)));

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data || {};
      const room = code && game.getRoom(code);
      if (!room) return;
      if (!game.markOffline(room, playerId, socket.id)) return;
      broadcast(room);
      // Phones go to sleep all the time, so give the host a grace period.
      setTimeout(() => {
        const again = game.getRoom(code);
        if (again && game.reassignHostIfNeeded(again)) broadcast(again);
      }, 20000).unref();
    });
  });

  const sweeper = setInterval(() => game.sweep(), 60000);
  sweeper.unref();
  return { app, server, io };
}

// Load every locale file at startup.
for (const f of fs.readdirSync(path.join(__dirname, 'locales'))) {
  if (f.endsWith('.json')) {
    i18n.load(f.replace(/\.json$/, ''), require(`./locales/${f}`));
  }
}

if (require.main === module) {
  const { server } = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Late Checkout is open at http://localhost:${port} (hotel: ${game.HOTEL_NAME})`);
  });
}

module.exports = { createServer };
