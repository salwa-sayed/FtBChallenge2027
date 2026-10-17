'use strict';

// Usage: node scripts/generate.js [puzzlesPerLayoutPerDifficulty=5] [seed]
// Writes data/puzzles.json. Every puzzle is re-verified to have exactly one solution.

const fs = require('fs');
const path = require('path');
const { LAYOUTS, validateLayout } = require('../lib/layouts');
const { generate, makeRng, buildCtx, solve } = require('../lib/puzzle');

const perBucket = Number(process.argv[2]) || 5;
const seed = Number(process.argv[3]) || (Date.now() % 1000000007);
const rng = makeRng(seed);
const DIFFICULTIES = ['easy', 'medium', 'hard'];

for (const l of LAYOUTS) {
  const problems = validateLayout(l);
  if (problems.length) {
    console.error(`Layout "${l.id}" is invalid:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
}

const started = Date.now();
const puzzles = [];
for (const layout of LAYOUTS) {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 1; i <= perBucket; i++) {
      const p = generate(layout, difficulty, rng);
      p.id = `${layout.id}-${difficulty}-${i}`;

      const ctx = buildCtx(layout, p.victim.cell);
      const check = solve(ctx, p.clues, 2);
      if (check.count !== 1 || check.solutions[0].some((cell, s) => cell !== p.solution[s])) {
        throw new Error(`puzzle ${p.id} failed verification`);
      }
      puzzles.push(p);
    }
    const n = puzzles.filter((p) => p.layoutId === layout.id && p.difficulty === difficulty);
    const avg = (n.reduce((t, p) => t + p.clues.length, 0) / n.length).toFixed(1);
    console.log(`${layout.id.padEnd(7)} ${difficulty.padEnd(7)} ${n.length} puzzles, avg ${avg} clues`);
  }
}

const out = path.join(__dirname, '..', 'data', 'puzzles.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ seed, generatedAt: new Date().toISOString(), puzzles }));
console.log(`Wrote ${puzzles.length} verified puzzles to data/puzzles.json in ${Date.now() - started}ms (seed ${seed})`);
