#!/usr/bin/env node
// Mint unlock codes.
//
//   UNLOCK_SECRET=... node scripts/make-code.js all            # every pack
//   UNLOCK_SECRET=... node scripts/make-code.js christmas      # a whole collection
//   UNLOCK_SECRET=... node scripts/make-code.js nativity 10    # 10 codes for one pack
//
// Use the same UNLOCK_SECRET that is set in Vercel. Without it, the dev
// server's secret is used, and those codes only work locally.
const { mint, scopeCovers } = require('../lib/codes');
const { loadAll } = require('../lib/packs');

const scope = process.argv[2];
const count = Math.max(1, Math.min(500, Number(process.argv[3]) || 1));
if (!scope) {
  console.error('Usage: node scripts/make-code.js <pack-id | collection | all> [count]');
  process.exit(1);
}
const secret = process.env.UNLOCK_SECRET || 'dev-only-secret';
if (!process.env.UNLOCK_SECRET) console.error('(No UNLOCK_SECRET set: these codes only work with `npm run dev`.)');

const covered = loadAll().packs.filter((p) => scopeCovers(scope.toUpperCase(), p)).map((p) => p.title);
if (!covered.length) {
  console.error('"' + scope + '" matches no pack id or collection.');
  process.exit(1);
}
console.error('Unlocks: ' + covered.join(', '));
for (let i = 0; i < count; i++) console.log(mint(scope, secret));
