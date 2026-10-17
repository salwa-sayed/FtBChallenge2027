(() => {
  'use strict';

  // ---------- constants & helpers ----------
  const SIZE = 6;
  const COLS = 'ABCDEF';
  const STAFF_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
  const ROOM_COLORS = ['#fbe3c3', '#d5ebd0', '#d3e4f6', '#f4d2df', '#e3d9f6', '#f5efb0'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const fmtTime = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* private mode */ } },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* private mode */ } },
  };
  const session = {
    get() { try { return JSON.parse(storage.get('lc.session') || 'null'); } catch (e) { return null; } },
    set(v) { storage.set('lc.session', JSON.stringify(v)); },
    clear() { storage.del('lc.session'); },
  };

  // ---------- state ----------
  let S = null;          // latest state from the server
  let meId = null;       // my player id
  let skew = 0;          // server clock minus my clock
  let lastLogId = 0;
  let lastLogRoom = null;
  let toastTimer = null;

  const params = new URLSearchParams(location.search);
  const ui = {
    name: storage.get('lc.name') || '',
    code: (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4),
    homeError: '',
    rejoining: !!session.get(),
    selected: -1,
    mode: 'place',
    helpOpen: false,
    cluesOpen: true,
    accuse: false,
    pick: -1,
    dismissed: false,
    difficulty: 'medium',
  };

  const socket = io();

  // ---------- networking ----------
  socket.on('connect', () => {
    $('#conn').hidden = true;
    const ses = session.get();
    if (ses) {
      ui.rejoining = !S;
      socket.emit('rejoin', ses, (res) => {
        ui.rejoining = false;
        if (res && res.ok) { meId = res.playerId; return; }
        session.clear();
        S = null;
        meId = null;
        ui.homeError = (res && res.error) || '';
        render();
      });
    } else {
      render();
    }
  });
  socket.on('disconnect', () => { $('#conn').hidden = false; });
  socket.on('state', (next) => {
    const prev = S;
    S = next;
    skew = next.serverTime - Date.now();
    onState(prev);
    render();
  });

  function onState(prev) {
    const newCase = !prev || prev.phase !== S.phase || (prev.puzzle && S.puzzle && prev.puzzle.id !== S.puzzle.id);
    if (newCase && S.phase === 'playing') {
      ui.selected = -1;
      ui.mode = 'place';
      ui.accuse = false;
      ui.pick = -1;
      ui.dismissed = false;
      if (!storage.get('lc.seen')) { ui.helpOpen = true; storage.set('lc.seen', '1'); } else { ui.helpOpen = false; }
    }
    if (S.phase === 'won' || S.phase === 'lost') {
      if (!prev || prev.phase !== S.phase) { ui.dismissed = false; ui.accuse = false; }
    }
    if (S.phase === 'lobby') { ui.accuse = false; }

    // toasts for new log lines (but not a replay of history when first joining)
    if (lastLogRoom !== S.code) {
      lastLogRoom = S.code;
      lastLogId = S.log.length ? S.log[S.log.length - 1].id : 0;
    } else {
      for (const entry of S.log) {
        if (entry.id > lastLogId) {
          lastLogId = entry.id;
          toast(entry.text);
        }
      }
    }
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  const resync = (res) => { if (res && !res.ok) { if (res.error) toast(res.error); socket.emit('sync'); } };

  // ---------- optimistic board edits (server stays the boss) ----------
  function localPlace(staff, cell) {
    const b = S.board;
    if (b.placed[staff] === cell) { b.placed[staff] = -1; b.placedBy[staff] = null; return; }
    b.placed.forEach((c, s) => { if (c === cell) { b.placed[s] = -1; b.placedBy[s] = null; } });
    b.placed[staff] = cell;
    b.placedBy[staff] = meId;
    if (b.notes[cell]) {
      b.notes[cell] = b.notes[cell].filter((x) => x !== staff);
      if (!b.notes[cell].length) delete b.notes[cell];
    }
  }
  function localNote(staff, cell) {
    const b = S.board;
    if (b.placed[staff] === cell) return;
    const list = (b.notes[cell] || []).slice();
    const at = list.indexOf(staff);
    if (at >= 0) list.splice(at, 1); else list.push(staff);
    if (list.length) b.notes[cell] = list.sort((x, y) => x - y); else delete b.notes[cell];
  }

  // ---------- views ----------
  function render() {
    const app = $('#app');
    if (!S) {
      app.innerHTML = ui.rejoining ? '<p class="foot" style="margin-top:40vh">Finding your table…</p>' : homeView();
      return;
    }
    app.innerHTML = S.phase === 'lobby' ? lobbyView() : gameView();
  }

  function homeView() {
    return `
      <section class="hero">
        <div class="bell">🛎️</div>
        <h1>Late Checkout</h1>
        <p class="sub">A hotel murder mystery you solve together, each on your own phone.</p>
      </section>
      <section class="card">
        <label class="lbl" for="name">Your name</label>
        <input id="name" class="input" maxlength="14" autocomplete="nickname" placeholder="e.g. Sam" value="${esc(ui.name)}">
        <button class="btn primary block" data-act="create" style="margin-top:12px">Start a new case</button>
      </section>
      <section class="card">
        <label class="lbl" for="code">Or join friends</label>
        <div class="row">
          <input id="code" class="input code-in" maxlength="4" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="CODE" value="${esc(ui.code)}">
          <button class="btn brass" data-act="join">Join</button>
        </div>
      </section>
      ${ui.homeError ? `<p class="err">${esc(ui.homeError)}</p>` : ''}
      <p class="foot">One shared floor plan. Every move shows up live on everyone's phone.</p>`;
  }

  function rulesHTML() {
    return `<ol class="rules">
      <li>Six staff were each on a <b>different row and a different column</b> of the floor plan. Nobody stood on the 💀 spot.</li>
      <li>Use the clues to place everyone. <b>North</b> is up, <b>west</b> is left. <b>Beside</b> means directly up, down, left or right.</li>
      <li>The culprit is the <b>only staff member in the same room as the victim</b>.</li>
      <li>When the board is full, accuse. Three wrong accusations and the culprit walks free.</li>
    </ol>`;
  }

  function playerPills() {
    return S.players.map((p) => `
      <span class="pill${p.online ? '' : ' off'}">${p.avatar} ${esc(p.name)}${p.id === S.hostId ? ' <span class="tag">host</span>' : ''}${p.id === meId ? ' <span class="tag">you</span>' : ''}</span>`).join('');
  }

  function lobbyView() {
    const host = S.hostId === meId;
    const hostP = S.players.find((p) => p.id === S.hostId);
    const diffs = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
    return `
      <header class="top"><div><small>${esc(S.hotel)}</small><h1>Late Checkout</h1></div></header>
      <section class="card center">
        <span class="lbl">Room code</span>
        <div class="codebox" data-act="copyCode">${esc(S.code)}</div>
        <button class="btn brass block" data-act="share">Invite friends</button>
      </section>
      <section class="card">
        <span class="lbl">At the table · ${S.players.length}/8</span>
        <div class="plist">${playerPills()}</div>
      </section>
      <section class="card">
        ${host ? `
          <span class="lbl">Difficulty</span>
          <div class="seg">${diffs.map(([id, label]) => `<button data-act="difficulty" data-d="${id}" class="${ui.difficulty === id ? 'on' : ''}">${label}</button>`).join('')}</div>
          <button class="btn primary block" data-act="start" style="margin-top:14px">Open the case</button>`
    : `<p style="margin:0">Waiting for <b>${esc(hostP ? hostP.name : 'the host')}</b> to open the case…</p>`}
      </section>
      <section class="card"><span class="lbl">How it works</span>${rulesHTML()}</section>
      <button class="btn ghost block" data-act="leave">Leave room</button>`;
  }

  function hl(text) {
    let out = esc(text);
    S.puzzle.staff.forEach((st, i) => {
      out = out.replace(new RegExp(`\\b${st.name}\\b`, 'g'), `<b class="nm" style="color:${STAFF_COLORS[i]}">${st.name}</b>`);
    });
    return out;
  }

  const finished = () => S.phase === 'won' || S.phase === 'lost';

  function boardHTML() {
    const P = S.puzzle;
    const fin = finished();
    const positions = fin ? S.result.solution : S.board.placed;
    const roomIdx = {};
    P.rooms.forEach((r, i) => { roomIdx[r.id] = i; });
    const roomAt = (i) => P.grid[Math.floor(i / SIZE)][i % SIZE];
    const itemAt = {};
    P.items.forEach((it) => { itemAt[it.cell] = it; });
    const placedAt = {};
    positions.forEach((cell, s) => { if (cell >= 0) placedAt[cell] = s; });

    const rowCount = new Array(SIZE).fill(0);
    const colCount = new Array(SIZE).fill(0);
    if (!fin) positions.forEach((c) => { if (c >= 0) { rowCount[Math.floor(c / SIZE)]++; colCount[c % SIZE]++; } });

    const labelCell = {};
    for (let i = 0; i < SIZE * SIZE; i++) { const id = roomAt(i); if (!(id in labelCell)) labelCell[id] = i; }

    let h = '<div class="board" id="board"><div class="lab"></div>';
    for (let c = 0; c < SIZE; c++) h += `<div class="lab">${COLS[c]}</div>`;
    for (let r = 0; r < SIZE; r++) {
      h += `<div class="lab row">${r + 1}</div>`;
      for (let c = 0; c < SIZE; c++) {
        const i = r * SIZE + c;
        const rid = roomAt(i);
        const walls = [];
        if (c === SIZE - 1 || roomAt(i + 1) !== rid) walls.push('wr');
        if (r === SIZE - 1 || roomAt(i + SIZE) !== rid) walls.push('wb');
        if (c === 0) walls.push('wl');
        if (r === 0) walls.push('wt');
        const isVictim = i === P.victim.cell;
        const s = placedAt[i];
        let inner = '';
        if (labelCell[rid] === i) inner += `<span class="rlabel">${esc(P.rooms[roomIdx[rid]].name)}</span>`;
        if (itemAt[i]) inner += `<span class="item" title="${esc(itemAt[i].name)}">${itemAt[i].emoji}</span>`;
        if (isVictim) inner += '<span class="skull" title="Victim">💀</span>';
        if (s !== undefined) {
          const bad = !fin && (rowCount[r] > 1 || colCount[c] > 1);
          const by = !fin && S.board.placedBy[s] ? S.players.find((p) => p.id === S.board.placedBy[s]) : null;
          const cls = ['token'];
          if (bad) cls.push('bad');
          if (!fin && ui.selected === s) cls.push('sel');
          if (fin && s === S.result.culprit) cls.push('culprit');
          inner += `<span class="${cls.join(' ')}" style="--c:${STAFF_COLORS[s]}">${esc(P.staff[s].name[0])}${by ? `<em class="by">${by.avatar}</em>` : ''}</span>`;
        }
        if (!fin && S.board.notes[i]) {
          inner += `<span class="notes">${S.board.notes[i].map((n) => `<i style="--c:${STAFF_COLORS[n]}">×</i>`).join('')}</span>`;
        }
        const cls = ['cell', ...walls];
        if (isVictim) cls.push('victim');
        if (s !== undefined) cls.push('hastok');
        h += `<div class="${cls.join(' ')}" data-act="cell" data-i="${i}" style="background-color:${ROOM_COLORS[roomIdx[rid]]}">${inner}</div>`;
      }
    }
    return `${h}</div>
      <div class="legend">${P.rooms.map((r, i) => `<span><i style="background:${ROOM_COLORS[i]}"></i>${esc(r.name)}</span>`).join('')}<span>💀 victim</span></div>`;
  }

  function trayHTML() {
    const P = S.puzzle;
    const dis = finished();
    return `<div class="tray">${P.staff.map((st, s) => {
      const placed = S.board.placed[s] >= 0;
      return `<button class="chip${ui.selected === s ? ' on' : ''}${placed ? ' done' : ''}" data-act="staff" data-s="${s}" style="--c:${STAFF_COLORS[s]}" ${dis ? 'disabled' : ''}>
        <span class="tk">${esc(st.name[0])}${placed ? '<em class="ck">✓</em>' : ''}</span>
        <span class="nm"><b>${esc(st.name)}</b><small>${esc(st.role)}</small></span>
      </button>`;
    }).join('')}</div>
    <div class="seg mode">
      <button data-act="mode" data-m="place" class="${ui.mode === 'place' ? 'on' : ''}">Place suspect</button>
      <button data-act="mode" data-m="note" class="${ui.mode === 'note' ? 'on' : ''}">✕ Rule out</button>
    </div>
    <p class="hint">${ui.selected < 0 ? 'Tap a staff member, then tap a square.' : (ui.mode === 'place' ? 'Tap a square to put them there. Tap them again to take them off.' : 'Tap squares where they cannot be.')}</p>`;
  }

  function cluesHTML() {
    const P = S.puzzle;
    return `<section class="card">
      <button class="help-toggle" data-act="toggleClues"><span>Clues (${P.clues.length})</span><span>${ui.cluesOpen ? '▾' : '▸'}</span></button>
      ${ui.cluesOpen ? `<p class="hint" style="margin:6px 0 4px">Tap a clue to cross it off for everyone.</p>${P.clues.map((c, i) => `
        <button class="clue${S.board.struck[i] ? ' struck' : ''}" data-act="clue" data-i="${i}"><span class="n">${i + 1}</span><span class="tx">${hl(c.text)}</span></button>`).join('')}` : ''}
    </section>`;
  }

  function hasConflict() {
    const rows = new Set();
    const cols = new Set();
    for (const c of S.board.placed) {
      if (c < 0) continue;
      const r = Math.floor(c / SIZE);
      const col = c % SIZE;
      if (rows.has(r) || cols.has(col)) return true;
      rows.add(r);
      cols.add(col);
    }
    return false;
  }

  function accuseSheet() {
    const P = S.puzzle;
    return `<div class="scrim" data-act="closeAccuse"></div>
      <div class="sheet" role="dialog" aria-label="Make an accusation">
        <h3>Who did it?</h3>
        <p class="muted">${esc(P.victim.name)} was found in the ${esc(P.rooms.find((r) => r.id === P.victim.room).name)}. Pick the staff member who was alone with them.</p>
        <div class="picks">${P.staff.map((st, s) => `
          <button class="chip${ui.pick === s ? ' on' : ''}" data-act="pick" data-s="${s}" style="--c:${STAFF_COLORS[s]}">
            <span class="tk">${esc(st.name[0])}</span><span class="nm"><b>${esc(st.name)}</b><small>${esc(st.role)}</small></span>
          </button>`).join('')}</div>
        <div class="stack">
          <button class="btn danger block" data-act="confirmAccuse" ${ui.pick < 0 ? 'disabled' : ''}>Accuse${ui.pick >= 0 ? ' ' + esc(P.staff[ui.pick].name) : ''}</button>
          <button class="btn ghost block" data-act="closeAccuse">Keep investigating</button>
        </div>
      </div>`;
  }

  function resultSheet() {
    const P = S.puzzle;
    const won = S.phase === 'won';
    const culprit = P.staff[S.result.culprit];
    const roomName = P.rooms.find((r) => r.id === P.victim.room).name;
    const host = S.hostId === meId;
    const time = fmtTime((S.endedAt || 0) - S.startedAt);
    return `<div class="scrim" data-act="dismissResult"></div>
      <div class="sheet" role="dialog" aria-label="Case result">
        <div class="big">${won ? '🎉' : '🏃'}</div>
        <h3>${won ? 'Case closed!' : 'The culprit got away'}</h3>
        <p><b>${esc(culprit.name)}</b> (${esc(culprit.role)}) was alone with ${esc(P.victim.name)} in the ${esc(roomName)}.</p>
        <p class="muted">${won ? `Solved in ${time} with ${S.players.length} detective${S.players.length === 1 ? '' : 's'}, ${S.strikes} wrong accusation${S.strikes === 1 ? '' : 's'}.` : `Three wrong accusations after ${time}. The solved plan is on the board.`}</p>
        <div class="stack">
          ${host ? `<button class="btn primary block" data-act="again">Open another case</button>
          <button class="btn ghost block" data-act="toLobby">Back to lobby</button>` : '<p class="muted" style="text-align:center;margin:0">Waiting for the host to open another case…</p>'}
          <button class="btn ghost block" data-act="dismissResult">Look at the board</button>
        </div>
      </div>`;
  }

  function gameView() {
    const P = S.puzzle;
    const fin = finished();
    const host = S.hostId === meId;
    const allPlaced = S.board.placed.every((c) => c >= 0);
    const canAccuse = allPlaced && !hasConflict();
    const hearts = Array.from({ length: S.maxStrikes }, (_, i) => (i < S.strikes ? '🖤' : '❤️')).join('');
    const elapsed = (fin ? S.endedAt : Date.now() + skew) - S.startedAt;
    const roomName = P.rooms.find((r) => r.id === P.victim.room).name;

    return `
      <header class="top">
        <div><small>${esc(P.hotel)} · ${esc(P.floor)}</small><h1>${esc(P.title)}</h1></div>
        <div class="timer" id="timer">${fmtTime(elapsed)}</div>
      </header>
      <div class="crew">${S.players.map((p) => `<span class="pl${p.online ? '' : ' off'}${p.id === meId ? ' me' : ''}">${p.avatar} ${esc(p.name)}</span>`).join('')}</div>
      ${fin ? `<div class="result-banner ${S.phase}"><span>${S.phase === 'won' ? 'Solved!' : 'Unsolved.'} The culprit was ${esc(P.staff[S.result.culprit].name)}.</span><button class="btn ghost" data-act="reopenResult" style="min-height:36px;padding:6px 12px;font-size:13px">Details</button></div>` : ''}
      <section class="card">
        <button class="help-toggle" data-act="toggleHelp"><span>How to play</span><span>${ui.helpOpen ? '▾' : '▸'}</span></button>
        ${ui.helpOpen ? `<div style="margin-top:10px">${rulesHTML()}</div>` : `<p class="hint" style="margin:6px 0 0">The culprit is the only staff member in the ${esc(roomName)} with ${esc(P.victim.name)}.</p>`}
      </section>
      ${boardHTML()}
      ${fin ? '' : trayHTML()}
      ${cluesHTML()}
      <div class="bar"><div class="in">
        ${fin
    ? (host ? '<button class="btn primary" data-act="again">Open another case</button>' : '<span class="muted" style="font-size:14px">Waiting for the host to open another case…</span>')
    : `<div class="strikes">Wrong accusations<b>${hearts}</b></div>
           <button class="btn danger" data-act="openAccuse" ${canAccuse ? '' : 'disabled'}>${allPlaced ? (canAccuse ? 'Accuse someone' : 'Fix the red tokens') : 'Place all six first'}</button>`}
      </div></div>
      ${!fin && ui.accuse ? accuseSheet() : ''}
      ${fin && !ui.dismissed ? resultSheet() : ''}`;
  }

  // ---------- actions ----------
  const handlers = {
    create() {
      if (!ui.name.trim()) { ui.homeError = 'Type your name first.'; render(); return; }
      storage.set('lc.name', ui.name.trim());
      socket.emit('create', { name: ui.name.trim() }, joined);
    },
    join() {
      if (!ui.name.trim()) { ui.homeError = 'Type your name first.'; render(); return; }
      if (ui.code.length !== 4) { ui.homeError = 'Room codes are 4 letters.'; render(); return; }
      storage.set('lc.name', ui.name.trim());
      socket.emit('join', { name: ui.name.trim(), code: ui.code }, joined);
    },
    leave() {
      socket.emit('leave', {}, () => {
        session.clear();
        S = null;
        meId = null;
        lastLogRoom = null;
        ui.code = '';
        history.replaceState(null, '', location.pathname);
        render();
      });
    },
    async share() {
      const url = `${location.origin}${location.pathname}?room=${S.code}`;
      const text = `Help me solve a hotel murder! Room code ${S.code}`;
      if (navigator.share) {
        try { await navigator.share({ title: 'Late Checkout', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      copy(url, 'Invite link copied');
    },
    copyCode() { copy(S.code, 'Room code copied'); },
    difficulty(el) { ui.difficulty = el.dataset.d; render(); },
    start() { socket.emit('start', { difficulty: ui.difficulty }, resync); },
    again() { socket.emit('start', { difficulty: S.difficulty }, resync); },
    toLobby() { socket.emit('lobby', {}, resync); },
    staff(el) {
      const s = Number(el.dataset.s);
      ui.selected = ui.selected === s ? -1 : s;
      render();
    },
    mode(el) { ui.mode = el.dataset.m; render(); },
    cell(el) {
      if (!S || S.phase !== 'playing') return;
      const i = Number(el.dataset.i);
      if (i === S.puzzle.victim.cell) { toast('Nobody on staff can stand on the victim’s spot.'); return; }
      if (ui.selected < 0) {
        const there = S.board.placed.indexOf(i);
        if (there >= 0) { ui.selected = there; render(); } else toast('Pick a staff member below first.');
        return;
      }
      if (navigator.vibrate) navigator.vibrate(8);
      if (ui.mode === 'place') {
        localPlace(ui.selected, i);
        socket.emit('place', { staff: ui.selected, cell: i }, resync);
      } else {
        localNote(ui.selected, i);
        socket.emit('note', { staff: ui.selected, cell: i }, resync);
      }
      render();
    },
    clue(el) {
      const i = Number(el.dataset.i);
      S.board.struck[i] = !S.board.struck[i];
      socket.emit('clue', { index: i }, resync);
      render();
    },
    toggleHelp() { ui.helpOpen = !ui.helpOpen; render(); },
    toggleClues() { ui.cluesOpen = !ui.cluesOpen; render(); },
    openAccuse() { ui.accuse = true; ui.pick = -1; render(); },
    closeAccuse() { ui.accuse = false; render(); },
    pick(el) { ui.pick = Number(el.dataset.s); render(); },
    confirmAccuse() {
      if (ui.pick < 0) return;
      const staff = ui.pick;
      ui.accuse = false;
      ui.pick = -1;
      socket.emit('accuse', { staff }, (res) => {
        if (!res.ok) { toast(res.error); socket.emit('sync'); return; }
        if (res.outcome === 'strike' && navigator.vibrate) navigator.vibrate([60, 40, 60]);
      });
      render();
    },
    dismissResult() { ui.dismissed = true; render(); },
    reopenResult() { ui.dismissed = false; render(); },
  };

  function joined(res) {
    if (!res || !res.ok) { ui.homeError = (res && res.error) || 'Could not join.'; render(); return; }
    meId = res.playerId;
    ui.homeError = '';
    session.set({ code: res.code, playerId: res.playerId });
    render();
  }

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); } catch (e) { window.prompt('Copy this:', text); }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = handlers[el.dataset.act];
    if (fn) fn(el, e);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'name') ui.name = e.target.value;
    if (e.target.id === 'code') {
      ui.code = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      e.target.value = ui.code;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') handlers.join();
    else if (e.target.id === 'name') (ui.code.length === 4 ? handlers.join : handlers.create)();
  });

  // live clock without re-rendering the whole screen
  setInterval(() => {
    const el = $('#timer');
    if (el && S && S.startedAt && S.phase === 'playing') el.textContent = fmtTime(Date.now() + skew - S.startedAt);
  }, 500);

  // phones sleep: ask for fresh state when the tab wakes up
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S && socket.connected) socket.emit('sync');
  });

  render();
})();
