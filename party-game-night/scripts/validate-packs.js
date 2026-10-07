#!/usr/bin/env node
// Check every pack in packs/ before you deploy: npm run validate
const { loadAll } = require('../lib/packs');
const { packs, errors } = loadAll();
for (const p of packs) {
  const c = { easy: 0, medium: 0, hard: 0 };
  p.questions.forEach((q) => c[q.difficulty]++);
  const samples = p.questions.filter((q) => q.sample).length;
  console.log('✓ ' + p.id.padEnd(20) + p.questions.length + ' questions (' + c.easy + ' easy, ' + c.medium + ' medium, ' + c.hard + ' hard), ' + samples + ' sample');
}
if (errors.length) {
  console.error('\n' + errors.length + ' problem(s):\n  ' + errors.join('\n  '));
  process.exit(1);
}
