'use strict';

// Puzzle engine: clue types, a backtracking solver that counts solutions,
// and a generator that only keeps puzzles with exactly ONE solution.
//
// Rules of the game
//  - 6 staff, 6x6 plan: every staff member stands in a different row AND column.
//  - Nobody stands on the victim's cell.
//  - The culprit is the only staff member in the same room as the victim.

const { N, getLayout } = require('./layouts');

const CELLS = N * N;
const COLS = 'ABCDEF';

const STAFF_POOL = [
  { name: 'Ana', role: 'Concierge' },
  { name: 'Ben', role: 'Bellhop' },
  { name: 'Chloe', role: 'Head Chef' },
  { name: 'Dev', role: 'Night Manager' },
  { name: 'Elena', role: 'Housekeeper' },
  { name: 'Farid', role: 'Bartender' },
  { name: 'Grace', role: 'Receptionist' },
  { name: 'Hiro', role: 'Spa Therapist' },
  { name: 'Ines', role: 'Events Manager' },
  { name: 'Jonas', role: 'Maintenance' },
];

const VICTIMS = [
  'Mr. Hale', 'Ms. Okafor', 'Dr. Lindqvist', 'Lord Ashby', 'Mrs. Takahashi',
  'Mr. Delacroix', 'Ms. Brennan', 'Captain Rowe', 'Prof. Mbeki', 'Ms. Valdez',
];

// ---------- small helpers ----------

function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rc = (cell) => [Math.floor(cell / N), cell % N];

// ---------- clue semantics ----------

// "domain" clues restrict where ONE staff member can stand.
const DOMAIN = new Set(['in_room', 'not_in_room', 'on_item', 'next_item', 'in_col', 'in_row']);
// "binary" clues relate two staff members.
const BINARY = new Set(['together', 'apart', 'north', 'west', 'diag']);
// everything else ('alone', 'count') is global and is checked on a full board.

function buildCtx(layout, victimCell) {
  const itemCell = {};
  layout.items.forEach((it) => { itemCell[it.id] = it.cell; });
  return { layout, roomOf: layout.roomOf, itemCell, victimCell };
}

function domainAllows(c, cell, ctx) {
  const [r, col] = rc(cell);
  switch (c.t) {
    case 'in_room': return ctx.roomOf[cell] === c.room;
    case 'not_in_room': return ctx.roomOf[cell] !== c.room;
    case 'on_item': return cell === ctx.itemCell[c.item];
    case 'next_item': {
      const [ir, ic] = rc(ctx.itemCell[c.item]);
      return Math.abs(ir - r) + Math.abs(ic - col) === 1;
    }
    case 'in_col': return col === c.col;
    case 'in_row': return r === c.row;
    default: return true;
  }
}

function binaryHolds(c, ca, cb, ctx) {
  const [ra, ca2] = rc(ca);
  const [rb, cb2] = rc(cb);
  switch (c.t) {
    case 'together': return ctx.roomOf[ca] === ctx.roomOf[cb];
    case 'apart': return ctx.roomOf[ca] !== ctx.roomOf[cb];
    case 'north': return ra < rb;
    case 'west': return ca2 < cb2;
    case 'diag': return Math.abs(ra - rb) === 1 && Math.abs(ca2 - cb2) === 1;
    default: return true;
  }
}

function globalHolds(c, cellOf, ctx) {
  if (c.t === 'alone') {
    const room = ctx.roomOf[cellOf[c.a]];
    return cellOf.every((cell, s) => s === c.a || ctx.roomOf[cell] !== room);
  }
  if (c.t === 'count') {
    return cellOf.filter((cell) => ctx.roomOf[cell] === c.room).length === c.n;
  }
  return true;
}

// Cheap pruning while the board is only partly filled (cellOf may contain -1).
function globalPartialOK(c, cellOf, ctx) {
  if (c.t === 'alone') {
    if (cellOf[c.a] < 0) return true;
    const room = ctx.roomOf[cellOf[c.a]];
    for (let s = 0; s < N; s++) {
      if (s !== c.a && cellOf[s] >= 0 && ctx.roomOf[cellOf[s]] === room) return false;
    }
    return true;
  }
  if (c.t === 'count') {
    let k = 0;
    for (const cell of cellOf) if (cell >= 0 && ctx.roomOf[cell] === c.room) k++;
    return k <= c.n;
  }
  return true;
}

// Full evaluation of a clue against a complete placement (cellOf[staff] = cell).
function evalClue(c, cellOf, ctx) {
  if (DOMAIN.has(c.t)) return domainAllows(c, cellOf[c.a], ctx);
  if (BINARY.has(c.t)) return binaryHolds(c, cellOf[c.a], cellOf[c.b], ctx);
  return globalHolds(c, cellOf, ctx);
}

// ---------- solver ----------

// Counts placements (up to `limit`) that satisfy all clues.
function solve(ctx, clues, limit = 2) {
  const allowed = Array.from({ length: N }, () => new Array(CELLS).fill(true));
  for (const al of allowed) al[ctx.victimCell] = false;

  const binary = [];
  const globals = [];
  for (const c of clues) {
    if (DOMAIN.has(c.t)) {
      const al = allowed[c.a];
      for (let cell = 0; cell < CELLS; cell++) {
        if (al[cell] && !domainAllows(c, cell, ctx)) al[cell] = false;
      }
    } else if (BINARY.has(c.t)) binary.push(c);
    else globals.push(c);
  }

  const sizes = allowed.map((al) => al.reduce((n, v) => n + (v ? 1 : 0), 0));
  if (sizes.some((s) => s === 0)) return { count: 0, solutions: [] };

  const order = [...Array(N).keys()].sort((x, y) => sizes[x] - sizes[y]);
  const pos = new Array(N);
  order.forEach((s, i) => { pos[s] = i; });
  const byDepth = Array.from({ length: N }, () => []);
  for (const c of binary) byDepth[Math.max(pos[c.a], pos[c.b])].push(c);

  const cellOf = new Array(N).fill(-1);
  const solutions = [];
  let count = 0;
  let usedRows = 0;
  let usedCols = 0;

  const dfs = (d) => {
    if (d === N) {
      for (const c of globals) if (!globalHolds(c, cellOf, ctx)) return;
      count++;
      solutions.push(cellOf.slice());
      return;
    }
    const s = order[d];
    const al = allowed[s];
    for (let r = 0; r < N; r++) {
      if (usedRows & (1 << r)) continue;
      for (let col = 0; col < N; col++) {
        if (usedCols & (1 << col)) continue;
        const cell = r * N + col;
        if (!al[cell]) continue;
        cellOf[s] = cell;
        let ok = true;
        for (const c of byDepth[d]) {
          if (!binaryHolds(c, cellOf[c.a], cellOf[c.b], ctx)) { ok = false; break; }
        }
        if (ok) {
          for (const c of globals) {
            if (!globalPartialOK(c, cellOf, ctx)) { ok = false; break; }
          }
        }
        if (ok) {
          usedRows |= 1 << r;
          usedCols |= 1 << col;
          dfs(d + 1);
          usedRows &= ~(1 << r);
          usedCols &= ~(1 << col);
        }
        cellOf[s] = -1;
        if (count >= limit) return;
      }
    }
  };
  dfs(0);
  return { count, solutions };
}

// ---------- clue text ----------

function clueText(c, staff, layout) {
  const nm = (i) => staff[i].name;
  const room = (id) => layout.rooms.find((r) => r.id === id).name;
  const item = (id) => layout.items.find((i) => i.id === id).name;
  switch (c.t) {
    case 'in_room': return `${nm(c.a)} was in the ${room(c.room)}.`;
    case 'not_in_room': return `${nm(c.a)} was not in the ${room(c.room)}.`;
    case 'on_item': return `${nm(c.a)} was at the ${item(c.item)}.`;
    case 'next_item': return `${nm(c.a)} was right beside the ${item(c.item)}.`;
    case 'in_col': return `${nm(c.a)} was in column ${COLS[c.col]}.`;
    case 'in_row': return `${nm(c.a)} was in row ${c.row + 1}.`;
    case 'alone': return `${nm(c.a)} was alone in their room, with no other staff inside.`;
    case 'together': return `${nm(c.a)} and ${nm(c.b)} were in the same room.`;
    case 'apart': return `${nm(c.a)} and ${nm(c.b)} were in different rooms.`;
    case 'north': return `${nm(c.a)} was somewhere north of ${nm(c.b)}.`;
    case 'west': return `${nm(c.a)} was somewhere west of ${nm(c.b)}.`;
    case 'diag': return `${nm(c.a)} and ${nm(c.b)} were touching corners, diagonally.`;
    case 'count':
      if (c.n === 0) return `Nobody on staff was in the ${room(c.room)}.`;
      if (c.n === 1) return `Exactly one staff member was in the ${room(c.room)}.`;
      return `Exactly ${c.n} staff were in the ${room(c.room)}.`;
    default: return '';
  }
}

// ---------- generator ----------

const WEIGHT = {
  in_room: 3, on_item: 3, next_item: 3, not_in_room: 1.2, in_col: 0.8, in_row: 0.8,
  alone: 1.2, together: 2.5, apart: 1, north: 2, west: 2, diag: 2.5, count: 2,
};

const CATEGORY = {
  in_room: 0, on_item: 0, next_item: 0, not_in_room: 0, in_col: 0, in_row: 0,
  alone: 1, together: 2, apart: 2, north: 2, west: 2, diag: 2, count: 3,
};

// Every clue that is TRUE for the hidden solution, minus ones that would hand
// over the culprit directly (anything pinning a person inside the victim's room).
function buildPool(ctx, solution, victimRoom) {
  const { layout } = ctx;
  const pool = [];
  const add = (c) => { if (evalClue(c, solution, ctx)) pool.push(c); };
  for (let a = 0; a < N; a++) {
    for (const room of layout.rooms) {
      if (room.id !== victimRoom) add({ t: 'in_room', a, room: room.id });
      add({ t: 'not_in_room', a, room: room.id });
    }
    for (const it of layout.items) {
      if (layout.roomOf[it.cell] !== victimRoom) add({ t: 'on_item', a, item: it.id });
      add({ t: 'next_item', a, item: it.id });
    }
    for (let col = 0; col < N; col++) add({ t: 'in_col', a, col });
    for (let row = 0; row < N; row++) add({ t: 'in_row', a, row });
    add({ t: 'alone', a });
    for (let b = 0; b < N; b++) {
      if (b === a) continue;
      add({ t: 'north', a, b });
      add({ t: 'west', a, b });
      if (b > a) {
        add({ t: 'together', a, b });
        add({ t: 'apart', a, b });
        add({ t: 'diag', a, b });
      }
    }
  }
  for (const room of layout.rooms) {
    if (room.id === victimRoom) continue;
    for (let n = 0; n <= N; n++) add({ t: 'count', room: room.id, n });
  }
  return pool;
}

function takeWeighted(list, rng) {
  let total = 0;
  for (const c of list) total += WEIGHT[c.t];
  let x = rng() * total;
  for (let i = 0; i < list.length; i++) {
    x -= WEIGHT[list[i].t];
    if (x <= 0) return list.splice(i, 1)[0];
  }
  return list.pop();
}

const EXTRAS = { easy: 4, medium: 2, hard: 0 };

function generate(layout, difficulty, rng = Math.random) {
  if (!(difficulty in EXTRAS)) throw new Error(`unknown difficulty ${difficulty}`);
  const itemCells = new Set(layout.items.map((i) => i.cell));

  for (let attempt = 0; attempt < 1000; attempt++) {
    const staff = shuffle(STAFF_POOL, rng).slice(0, N);

    // A random valid board: one staff member per row and per column.
    const rowStaff = shuffle([...Array(N).keys()], rng);
    const colOf = shuffle([...Array(N).keys()], rng);
    const solution = new Array(N);
    for (let r = 0; r < N; r++) solution[rowStaff[r]] = r * N + colOf[r];

    // The victim must lie in a room that holds exactly one staff member.
    const perRoom = {};
    solution.forEach((cell) => { perRoom[layout.roomOf[cell]] = (perRoom[layout.roomOf[cell]] || 0) + 1; });
    const taken = new Set(solution);
    const options = [];
    for (let cell = 0; cell < CELLS; cell++) {
      if (taken.has(cell) || itemCells.has(cell)) continue;
      if (perRoom[layout.roomOf[cell]] === 1) options.push(cell);
    }
    if (!options.length) continue;
    const victimCell = options[Math.floor(rng() * options.length)];
    const victimRoom = layout.roomOf[victimCell];
    const culprit = solution.findIndex((cell) => layout.roomOf[cell] === victimRoom);
    const ctx = buildCtx(layout, victimCell);

    // Add random true clues until the board has exactly one solution...
    const pool = buildPool(ctx, solution, victimRoom);
    const rest = pool.slice();
    const chosen = [];
    let unique = false;
    while (rest.length) {
      chosen.push(takeWeighted(rest, rng));
      if (chosen.length >= 5 && solve(ctx, chosen, 2).count === 1) { unique = true; break; }
    }
    if (!unique) continue;

    // ...then drop every clue that isn't needed.
    for (const c of shuffle(chosen, rng)) {
      const without = chosen.filter((x) => x !== c);
      if (solve(ctx, without, 2).count === 1) chosen.splice(chosen.indexOf(c), 1);
    }
    if (chosen.length > 16) continue;

    // Easier puzzles get a few extra helpful clues (still all true).
    const extraPool = pool.filter((c) => !chosen.includes(c) && c.t !== 'in_row' && c.t !== 'in_col');
    for (let i = 0; i < EXTRAS[difficulty] && extraPool.length; i++) chosen.push(takeWeighted(extraPool, rng));

    chosen.sort((x, y) => (CATEGORY[x.t] - CATEGORY[y.t]) || ((x.a ?? 99) - (y.a ?? 99)));
    const clues = chosen.map((c, i) => ({ ...c, id: i }));
    const victimName = VICTIMS[Math.floor(rng() * VICTIMS.length)];
    return {
      layoutId: layout.id,
      floor: layout.floor,
      difficulty,
      title: { victimName, victimRoom },
      staff,
      victim: { name: victimName, cell: victimCell, room: victimRoom },
      clues,
      solution,
      culprit,
    };
  }
  throw new Error(`could not generate a puzzle for ${layout.id}`);
}

// What clients are allowed to see: never the solution or the culprit.
function publicPuzzle(p, hotel) {
  const layout = getLayout(p.layoutId);
  return {
    id: p.id,
    hotel,
    floor: p.floor,
    layoutId: p.layoutId,
    title: p.title,
    difficulty: p.difficulty,
    rooms: layout.rooms,
    grid: layout.grid,
    items: layout.items,
    staff: p.staff,
    victim: { name: p.victim.name, cell: p.victim.cell, room: p.victim.room },
    clues: p.clues.map((c) => ({ ...c })),
  };
}

module.exports = {
  N, CELLS, COLS, STAFF_POOL, makeRng, buildCtx, evalClue, solve, generate, publicPuzzle,
};
