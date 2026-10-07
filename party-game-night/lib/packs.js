// Question packs: every *.json file in packs/ is a pack. Drop a new file in
// and it shows up on the host's pack picker. Files starting with "_" are
// ignored (templates, drafts).

const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', 'packs');
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const SAMPLE_SIZE = 5;
let cache = null;

/** Returns a list of problems with one pack (empty list = valid). */
function validatePack(pack, file) {
  const errs = [];
  const where = file || pack.id || '(pack)';
  const err = (m) => errs.push(where + ': ' + m);

  if (!pack || typeof pack !== 'object') return [where + ': not a JSON object'];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pack.id || '')) err('"id" must be lowercase words joined by dashes');
  if (file && pack.id && path.basename(file, '.json') !== pack.id) err('file name must match "id" (' + pack.id + '.json)');
  if (!pack.title) err('"title" is required');
  if (!pack.collection) err('"collection" is required (e.g. "Christmas")');
  if (!Array.isArray(pack.questions) || !pack.questions.length) {
    err('"questions" must be a non-empty array');
    return errs;
  }
  if (pack.questions.length < 25) err('needs at least 25 questions (has ' + pack.questions.length + ')');

  const requireRefs = Array.isArray(pack.requireRefs) ? pack.requireRefs : [];
  const ids = new Set();
  pack.questions.forEach((q, i) => {
    const at = 'question ' + (i + 1) + (q && q.id ? ' (' + q.id + ')' : '');
    if (!q || typeof q !== 'object') return err(at + ': not an object');
    if (!q.id) err(at + ': "id" is required');
    else if (ids.has(q.id)) err(at + ': duplicate id');
    ids.add(q.id);
    if (!DIFFICULTIES.includes(q.difficulty)) err(at + ': "difficulty" must be easy, medium, or hard');
    if (!q.q || typeof q.q !== 'string') err(at + ': "q" (the question text) is required');
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 4) err(at + ': "choices" needs 2 to 4 options');
    else {
      if (q.choices.some((c) => typeof c !== 'string' || !c.trim())) err(at + ': every choice must be non-empty text');
      const lower = q.choices.map((c) => String(c).trim().toLowerCase());
      if (new Set(lower).size !== lower.length) err(at + ': two choices are the same');
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) err(at + ': "answer" must be the index (0-based) of the right choice');
    }
    if (!q.reveal) err(at + ': "reveal" (the explanation shown after) is required');
    // Keep text short enough to read from the couch.
    if (typeof q.q === 'string' && q.q.length > 160) err(at + ': question is ' + q.q.length + ' characters; keep it under 160');
    if (Array.isArray(q.choices) && q.choices.some((c) => String(c).length > 44)) err(at + ': keep each choice under 44 characters');
    if (typeof q.reveal === 'string' && q.reveal.length > 260) err(at + ': reveal is ' + q.reveal.length + ' characters; keep it under 260');
    if (q.refs != null) {
      if (!Array.isArray(q.refs) || q.refs.some((r) => !r || !r.label || !r.ref)) err(at + ': "refs" must be a list of {"label", "ref"}');
    }
    for (const label of requireRefs) {
      if (!Array.isArray(q.refs) || !q.refs.some((r) => r && r.label === label)) err(at + ': missing a "' + label + '" reference');
    }
  });
  const hard = pack.questions.filter((q) => q.difficulty === 'hard').length;
  if (!hard) err('needs at least one "hard" question for the finale');
  return errs;
}

function loadAll() {
  if (cache) return cache;
  const packs = [];
  const errors = [];
  for (const file of fs.readdirSync(PACKS_DIR).sort()) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    let pack;
    try {
      pack = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, file), 'utf8'));
    } catch (e) {
      errors.push(file + ': invalid JSON (' + e.message + ')');
      continue;
    }
    const errs = validatePack(pack, file);
    if (errs.length) errors.push(...errs);
    else packs.push(pack);
  }
  packs.sort((a, b) => (a.order || 99) - (b.order || 99) || a.title.localeCompare(b.title));
  cache = { packs, errors };
  if (errors.length) console.warn('[packs] skipped invalid packs:\n  ' + errors.join('\n  '));
  return cache;
}

function getPack(id) {
  return loadAll().packs.find((p) => p.id === id) || null;
}

function sampleQuestions(pack) {
  const marked = pack.questions.filter((q) => q.sample);
  const pool = marked.length ? marked : pack.questions.filter((q) => q.difficulty !== 'hard');
  return pool.slice(0, SAMPLE_SIZE).map((q) => Object.assign({}, q, { sample: true }));
}

/** What the pack picker needs. Never includes questions. */
function summary(pack, unlocked) {
  const counts = { easy: 0, medium: 0, hard: 0 };
  pack.questions.forEach((q) => counts[q.difficulty]++);
  return {
    id: pack.id,
    title: pack.title,
    tagline: pack.tagline || '',
    description: pack.description || '',
    collection: pack.collection,
    theme: pack.theme || 'christmas',
    icon: pack.icon || '★',
    audience: pack.audience || '',
    translation: pack.translation || '',
    price: pack.price || null,
    free: !!pack.free,
    unlocked: !!unlocked,
    questionCount: pack.questions.length,
    difficulty: counts,
  };
}

function meta(pack) {
  return {
    id: pack.id,
    title: pack.title,
    collection: pack.collection,
    theme: pack.theme || 'christmas',
    icon: pack.icon || '★',
    translation: pack.translation || '',
  };
}

module.exports = { loadAll, getPack, validatePack, sampleQuestions, summary, meta, PACKS_DIR };
