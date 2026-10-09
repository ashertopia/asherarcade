// Tests the pure parts of Code.gs. Run: node apps-script-trivia-builder/test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
const J = x => JSON.parse(JSON.stringify(x));
const rowsFromGame = g => J(ctx.rowsFromGame_(g)), gameFromSheet = (a, b) => J(ctx.gameFromSheet_(a, b));
let passed = 0; const t = (n, f) => { f(); passed++; console.log('ok -', n); };

const order = { honoree: 'Maya Brooks', occasion: 'graduation', theme: { primary: '#111111', secondary: '#ffd200' }, questions: [
  { q: 'First car?', answers: ['Blue minivan'], correct: 0, wrongNeeded: 3, fact: 'The Blue Whale.' },
  { q: 'Coffee order?', answers: ['Hot chocolate', 'Iced latte'], correct: 0, wrongNeeded: 2 },
  { q: 'Driving tests?', answers: ['Twice', 'Once', 'Never', 'Five times'], correct: 0 } ] };

t('customer wrong answers fill C, D, E in order; blanks get AI formulas', () => {
  const rows = rowsFromGame(order);
  assert.strictEqual(rows.length, 20);
  assert.deepStrictEqual(rows[0].slice(0, 2), ['First car?', 'Blue minivan']);
  assert.ok(/^=AI\(".*small detail.*", A2:B2\)$/.test(rows[0][2]));
  assert.ok(/opposite.*A2:B2/.test(rows[0][3]));
  assert.ok(/funny.*A2:B2/.test(rows[0][4]));
  assert.strictEqual(rows[0][5], 'The Blue Whale.');
  assert.strictEqual(rows[1][2], 'Iced latte');                 // the one they gave goes in C
  assert.ok(/opposite.*A3:B3/.test(rows[1][3]) && /funny.*A3:B3/.test(rows[1][4]));
  assert.deepStrictEqual(rows[2].slice(1, 5), ['Twice', 'Once', 'Never', 'Five times']);
  assert.deepStrictEqual(rows[5], ['', '', '', '', '', '']);   // empty rows stay empty
});

t('quotes in prompts are escaped for the formula', () => {
  assert.ok(!/[^"]"[^",)]/.test(ctx.aiFormula_(0, 2).slice(5, -12)));
});

const settings = { id: 'maya-grad-2026', honoree: 'Maya Brooks', occasion: 'graduation', primary: '#111111', secondary: '#ffd200', leaderboardUrl: 'https://script.google.com/x/exec' };

t('builds a game the trivia engine accepts, cleaning AI quirks', () => {
  const vals = [
    ['First car?', 'Blue minivan', '"Blue sedan."', 'Two-seat sports car', 'Riding lawn mower', 'The Blue Whale.'],
    ['Coffee order?', 'Hot chocolate', 'Iced latte', ' Black coffee ', 'Pickle juice!', ''],
    ...Array(18).fill(['', '', '', '', '', ''])];
  const out = gameFromSheet(settings, vals);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.game.questions[0].answers, ['Blue minivan', 'Blue sedan', 'Two-seat sports car', 'Riding lawn mower']);
  assert.strictEqual(out.game.questions[1].answers[3], 'Pickle juice');
  assert.strictEqual(out.game.questions[0].fact, 'The Blue Whale.');
  assert.deepStrictEqual(out.game.theme, { primary: '#111111', secondary: '#ffd200' });
  // same validation the game page uses
  const html = fs.readFileSync(path.join(__dirname, '../trivia.html'), 'utf8');
  const validate = new Function(html.match(/function validate\(c\)\{[\s\S]*?\n\}/)[0] + '; return validate;')();
  validate(out.game);
});

t('catches ungenerated, failed, empty and duplicate answers', () => {
  const vals = [
    ['Q1?', 'Right', '#NAME?', 'Loading...', '', ''],
    ['Q2?', 'Right', 'right', 'Other', 'Thing', ''],
    ['Q3?', '', 'a', 'b', 'c', ''],
    ...Array(17).fill(['', '', '', '', '', ''])];
  const out = gameFromSheet(settings, vals);
  const all = out.errors.join('\n');
  assert.ok(/Row 2: Wrong: close did not generate/.test(all));
  assert.ok(/Row 2: Wrong: opposite did not generate/.test(all));
  assert.ok(/Row 2: Wrong: funny is empty/.test(all));
  assert.ok(/Row 3: "right" appears twice/.test(all));
  assert.ok(/Row 4: needs the right answer/.test(all));
});

t('warns on long answers and missing leaderboard, rejects bad game id', () => {
  const vals = [['Q?', 'A very long right answer', 'b', 'c', 'd', ''], ...Array(19).fill(['', '', '', '', '', ''])];
  const out = gameFromSheet(Object.assign({}, settings, { id: 'Bad Id', leaderboardUrl: '' }), vals);
  assert.ok(out.warnings.some(w => /longer than 3 words/.test(w)));
  assert.ok(out.warnings.some(w => /No Leaderboard URL/.test(w)));
  assert.ok(out.errors.some(e => /Game id/.test(e)));
});

console.log(`\n${passed} passed`);
