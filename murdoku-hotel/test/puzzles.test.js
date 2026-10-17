'use strict';

// Re-checks every shipped puzzle from scratch. Run with: node test/puzzles.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { LAYOUTS, validateLayout, getLayout } = require('../lib/layouts');
const { buildCtx, solve, evalClue, publicPuzzle } = require('../lib/puzzle');

for (const l of LAYOUTS) assert.deepStrictEqual(validateLayout(l), [], `layout ${l.id}`);

const { puzzles } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'puzzles.json'), 'utf8'));
assert.ok(puzzles.length >= 9, 'expected a decent bank of puzzles');

const ids = new Set();
for (const p of puzzles) {
  assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
  ids.add(p.id);

  const layout = getLayout(p.layoutId);
  const ctx = buildCtx(layout, p.victim.cell);

  // one staff member per row and per column
  assert.strictEqual(new Set(p.solution.map((c) => Math.floor(c / 6))).size, 6, `${p.id}: rows`);
  assert.strictEqual(new Set(p.solution.map((c) => c % 6)).size, 6, `${p.id}: cols`);

  // victim cell is free, has no item, and its room holds exactly one staff member (the culprit)
  assert.ok(!p.solution.includes(p.victim.cell), `${p.id}: victim cell occupied`);
  assert.ok(!layout.items.some((i) => i.cell === p.victim.cell), `${p.id}: victim on an item`);
  const inRoom = p.solution.map((c, s) => (layout.roomOf[c] === p.victim.room ? s : -1)).filter((s) => s >= 0);
  assert.deepStrictEqual(inRoom, [p.culprit], `${p.id}: culprit must be alone with the victim`);

  // every clue is true for the hidden solution, and together they allow ONE solution
  for (const c of p.clues) assert.ok(evalClue(c, p.solution, ctx), `${p.id}: clue "${c.text}" is false`);
  const res = solve(ctx, p.clues, 5);
  assert.strictEqual(res.count, 1, `${p.id}: has ${res.count} solutions`);
  assert.deepStrictEqual(res.solutions[0], p.solution, `${p.id}: solver disagrees`);

  // no clue may name the culprit's location in the victim room directly
  for (const c of p.clues) {
    assert.ok(!(c.t === 'in_room' && c.room === p.victim.room), `${p.id}: leaks culprit`);
  }

  // clients must never receive the answer
  const pub = JSON.stringify(publicPuzzle(p, 'Test Hotel'));
  assert.ok(!/solution|culprit/.test(pub), `${p.id}: public puzzle leaks the answer`);
}

console.log(`puzzles.test OK: ${puzzles.length} puzzles, each with exactly one solution`);
