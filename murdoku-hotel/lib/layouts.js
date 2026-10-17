'use strict';

// Hotel floor plans. Each is a 6x6 grid; every letter is a room.
// Items sit on one cell and are used as anchors in clues ("Ana was at the piano").
// Edit or add floors here, then run `npm run generate`.

const N = 6;

const RAW = [
  {
    id: 'ground',
    floor: 'Ground Floor',
    rooms: [
      ['L', 'Lobby'], ['R', 'Restaurant'], ['K', 'Kitchen'],
      ['S', 'Spa'], ['G', 'Gym'], ['O', 'Back Office'],
    ],
    grid: ['LLLRRR', 'LLORKK', 'LOORKK', 'GGOSSK', 'GGSSSK', 'GGSSKK'],
    // [id, name used in clues, emoji, row, col]
    items: [
      ['desk', 'reception desk', '🛎️', 0, 1],
      ['sofa', 'sofa', '🛋️', 2, 0],
      ['piano', 'piano', '🎹', 0, 4],
      ['stove', 'stove', '🔥', 1, 5],
      ['fridge', 'walk-in fridge', '🧊', 3, 5],
      ['massage', 'massage table', '💆', 4, 3],
      ['treadmill', 'treadmill', '🏃', 4, 0],
      ['safe', 'safe', '🔐', 1, 2],
      ['sauna', 'sauna', '♨️', 5, 2],
    ],
  },
  {
    id: 'pool',
    floor: 'Pool Level',
    rooms: [
      ['P', 'Pool Deck'], ['B', 'Bar'], ['R', 'Laundry'],
      ['C', 'Boardroom'], ['G', 'Guest Suite'], ['W', 'Storeroom'],
    ],
    grid: ['PPPPBB', 'PPPRBB', 'CCRRRB', 'CCCRGG', 'WWCGGG', 'WWWGGG'],
    items: [
      ['lounger', 'sun lounger', '🏖️', 0, 1],
      ['fountain', 'fountain', '⛲', 1, 0],
      ['barcounter', 'bar counter', '🍸', 0, 5],
      ['jukebox', 'jukebox', '🎵', 1, 4],
      ['washer', 'washing machine', '🧺', 2, 3],
      ['projector', 'projector', '📽️', 3, 1],
      ['bed', 'king bed', '🛏️', 4, 4],
      ['minibar', 'minibar', '🥤', 5, 5],
      ['trolley', 'linen trolley', '🛒', 5, 1],
      ['vacuum', 'vacuum cleaner', '🧹', 4, 0],
    ],
  },
  {
    id: 'roof',
    floor: 'Mezzanine & Roof',
    rooms: [
      ['A', 'Ballroom'], ['G', 'Roof Garden'], ['B', 'Library'],
      ['S', 'Games Room'], ['Y', 'Wine Cellar'], ['L', 'Workroom'],
    ],
    grid: ['AAAGGG', 'AABBGG', 'ABBBSS', 'YYBSSS', 'YYYLLS', 'YLLLLS'],
    items: [
      ['stage', 'stage', '🎤', 1, 0],
      ['discoball', 'disco ball', '🪩', 0, 2],
      ['flowerbed', 'flower bed', '🌷', 1, 5],
      ['bookshelf', 'bookshelf', '📚', 1, 3],
      ['fireplace', 'fireplace', '🔥', 3, 2],
      ['pooltable', 'pool table', '🎱', 2, 4],
      ['dartboard', 'dartboard', '🎯', 4, 5],
      ['winerack', 'wine rack', '🍷', 3, 0],
      ['printer', 'printer', '🖨️', 5, 2],
      ['laptop', 'laptop', '💻', 4, 3],
    ],
  },
];

function normalise(raw) {
  const rooms = raw.rooms.map(([id, name]) => ({ id, name }));
  const roomOf = [];
  raw.grid.forEach((row) => { for (const ch of row) roomOf.push(ch); });
  const items = raw.items.map(([id, name, emoji, r, c]) => ({ id, name, emoji, cell: r * N + c }));
  return { id: raw.id, floor: raw.floor, rooms, grid: raw.grid, roomOf, items };
}

const LAYOUTS = RAW.map(normalise);

function validateLayout(l) {
  const problems = [];
  if (l.grid.length !== N || l.grid.some((row) => row.length !== N)) problems.push('grid must be 6x6');
  const ids = new Set(l.rooms.map((r) => r.id));
  for (const ch of l.roomOf) if (!ids.has(ch)) problems.push(`unknown room letter ${ch}`);
  for (const room of l.rooms) {
    const cells = [];
    l.roomOf.forEach((ch, i) => { if (ch === room.id) cells.push(i); });
    if (!cells.length) { problems.push(`room ${room.name} has no cells`); continue; }
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const cur = stack.pop();
      const r = Math.floor(cur / N);
      const c = cur % N;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
        const ni = nr * N + nc;
        if (l.roomOf[ni] === room.id && !seen.has(ni)) { seen.add(ni); stack.push(ni); }
      }
    }
    if (seen.size !== cells.length) problems.push(`room ${room.name} is not one connected area`);
  }
  const used = new Set();
  for (const it of l.items) {
    if (used.has(it.cell)) problems.push(`two items share a cell (${it.id})`);
    used.add(it.cell);
  }
  return problems;
}

const getLayout = (id) => LAYOUTS.find((l) => l.id === id);

module.exports = { N, LAYOUTS, validateLayout, getLayout };
