#!/usr/bin/env node
// Load test: one real TV page, one real phone page, and 199 lightweight bot
// phones (plain Node, talking to the dev relay) play a full Short game.
//
//   npm run load
//
// Checks that a 200-player room fills, plays to the end, that every phone ends
// with its own correct score and place, and that each broadcast stays under
// Ably's 5 KiB billing unit. It also prints an estimate of the Ably messages
// the same game would use.

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')));
}

const BOTS = 199;
const PORT = 3600 + Math.floor(Math.random() * 300);
const BASE = 'http://localhost:' + PORT;
const SPEED = 3;
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ✓ ' + msg);
}

const placeOf = (scores, pid) => {
  let higher = 0;
  for (const k in scores) if (scores[k][0] > scores[pid][0]) higher++;
  return higher + 1;
};

// A phone without a browser: same messages as public/js/player.js.
function bot(room, i, counters) {
  const pid = 'p' + Math.random().toString(36).slice(2, 9);
  const b = { pid, name: 'Guest ' + String(i + 1).padStart(2, '0'), view: null, joined: false, done: false, answered: new Set(), wagered: false };
  const ctrl = new AbortController();
  const publish = (name, data) => {
    counters.phonePublishes++;
    return fetch(BASE + '/relay/' + room + '/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data, clientId: pid, role: 'player' }),
    }).catch(() => {});
  };
  b.start = async () => {
    const res = await fetch(BASE + '/relay/' + room + '/stream?cid=' + pid, { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    publish('join', { pid, name: b.name });
    const rejoin = setInterval(() => !b.joined && publish('join', { pid, name: b.name }), 5000);
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const m = JSON.parse(line.slice(6));
            if (m.name === 'state') onState(m.data);
          }
        }
      } catch (e) {}
      clearInterval(rejoin);
    })();
  };
  function onState(v) {
    counters.delivered++;
    b.view = v;
    if (v.scores[pid]) b.joined = true;
    if (v.phase === 'question' && v.question && !b.answered.has(v.question.key)) {
      b.answered.add(v.question.key);
      // Answer like people do: some fast, most in the middle, a few late.
      const delay = 400 + Math.random() * 3500;
      setTimeout(() => publish('answer', { pid, qkey: v.question.key, choice: Math.floor(Math.random() * 4), ms: Math.round(delay * SPEED) }), delay);
    }
    if (v.phase === 'wager' && !b.wagered) {
      b.wagered = true;
      setTimeout(() => publish('wager', { pid, amount: Math.round(Math.random() * Math.max(1000, v.scores[pid][0])) }), 300 + Math.random() * 2000);
    }
    if (v.phase === 'gameover') b.done = true;
  }
  b.stop = () => ctrl.abort();
  return b;
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'dev-server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), PUBLIC_ORIGIN: BASE }),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let devCode = null;
  server.stdout.on('data', (d) => {
    const m = String(d).match(/Dev unlock code \(all packs\): (\S+)/);
    if (m) devCode = m[1];
  });
  for (let i = 0; i < 50 && !devCode; i++) await sleep(100);

  const browser = await chromium.launch();
  const bots = [];
  const counters = { phonePublishes: 0, delivered: 0 };
  const errors = [];
  try {
    const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    host.on('pageerror', (e) => errors.push('host: ' + e.message));
    await host.goto(BASE + '/host?speed=' + SPEED);
    await host.waitForSelector('.pack');
    await host.evaluate((c) => localStorage.setItem('pgn:codes', JSON.stringify([c])), devCode);
    await host.reload();
    await host.waitForSelector('[data-pack="christmas-movies"] .pill.gold');
    await host.click('[data-pack="christmas-movies"]');
    await host.click('[data-len="short"]');
    await host.click('#goFull');
    await host.waitForSelector('.code-big');
    const room = (await host.textContent('.code-big')).trim();
    console.log('  room ' + room + ': joining ' + BOTS + ' bots + 1 real phone…');

    // One real phone, so we can see the phone UI in a big room.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    phone.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await phone.goto(BASE + '/play?room=' + room);
    await phone.fill('#nameIn', 'Aunt Linda');
    await phone.click('#joinBtn');

    for (let i = 0; i < BOTS; i++) {
      const b = bot(room, i, counters);
      bots.push(b);
      b.start();
      await sleep(15);
    }
    await host.waitForFunction(() => window.__pgnHost.state.order.length === 200, null, { timeout: 30000 });
    await phone.waitForFunction(() => window.__pgnPlayer.joined, null, { timeout: 15000 });
    await sleep(2000);
    assert(bots.every((b) => b.joined), 'all 200 players joined (199 bots + 1 real phone)');

    // A 101st player is turned away.
    const extra = await (await browser.newContext()).newPage();
    await extra.goto(BASE + '/play?room=' + room);
    await extra.fill('#nameIn', 'One Too Many');
    await extra.click('#joinBtn');
    await extra.waitForFunction(() => /full/.test(document.querySelector('#joinErr').textContent), null, { timeout: 15000 });
    assert(true, 'the 201st player is told the room is full');

    await host.screenshot({ path: path.join(SHOTS, 'load-01-host-lobby-200.png') });
    await host.evaluate(() => window.__pgnHost.stats.broadcasts = 0);
    const deliveredBefore = counters.delivered;
    const publishesBefore = counters.phonePublishes;
    await host.click('#startBtn');

    const shots = {};
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const ph = await host.evaluate(() => {
        const s = window.__pgnHost.state;
        return { phase: s.phase, type: (s.rounds[s.r] || {}).type, q: s.q };
      });
      if (ph.phase === 'gameover') break;
      // The real phone plays too.
      const pv = await phone.evaluate(() => ({ n: document.querySelectorAll('[data-pick]:not([disabled])').length, w: !!document.querySelector('#lockW') }));
      if (pv.n === 4) await phone.click('[data-pick="' + Math.floor(Math.random() * 4) + '"]').catch(() => {});
      if (pv.w) await phone.click('#lockW').catch(() => {});
      const key = ph.phase + ':' + ph.type;
      if (!shots[key] && ['question', 'reveal', 'standings'].includes(ph.phase)) {
        shots[key] = true;
        await sleep(ph.phase === 'question' ? 1500 : 500);
        await host.screenshot({ path: path.join(SHOTS, 'load-host-' + ph.phase + '-' + ph.type + '.png') });
        await phone.screenshot({ path: path.join(SHOTS, 'load-phone-' + ph.phase + '-' + ph.type + '.png') });
      }
      await sleep(250);
    }
    await host.waitForSelector('.winner-name');
    await sleep(2500);
    await host.screenshot({ path: path.join(SHOTS, 'load-host-gameover.png') });
    await phone.screenshot({ path: path.join(SHOTS, 'load-phone-gameover.png') });

    const final = await host.evaluate(() => {
      const s = window.__pgnHost.state;
      const r = window.PGNEngine.ranks(s).rank;
      return { phase: s.phase, scores: Object.fromEntries(s.order.map((id) => [id, [s.players[id].score, r[id]]])), stats: window.__pgnHost.stats, rows: document.querySelectorAll('.standings .row').length };
    });
    assert(final.phase === 'gameover', 'the 200-player game reached the end screen');
    const wrong = bots.filter((b) => !b.done || !b.view.scores[b.pid] || b.view.scores[b.pid][0] !== final.scores[b.pid][0] || placeOf(b.view.scores, b.pid) !== final.scores[b.pid][1]);
    assert(wrong.length === 0, 'every bot phone ends with its own correct score and place');
    const phoneSees = await phone.evaluate(() => [document.querySelector('#meScore').textContent, document.querySelector('#mePlace').textContent]);
    assert(/of 200$/.test(phoneSees[1]), 'the real phone shows its score and place: ' + phoneSees.join(' · '));
    assert(final.rows <= 10, 'the TV end screen lists the top 10, not all 200 (' + final.rows + ' rows)');
    assert(final.stats.maxBytes < 10 * 1024, 'largest broadcast ' + final.stats.maxBytes + ' bytes (under 10 KiB = at most 2 Ably billing units)');

    const broadcasts = final.stats.broadcasts;
    const delivered = counters.delivered - deliveredBefore;
    const publishes = counters.phonePublishes - publishesBefore;
    const units = Math.ceil(final.stats.maxBytes / 5120);
    const ablyEstimate = broadcasts * units * (1 + 200) + publishes * 2;
    console.log('\n  Ably usage estimate for this 10-question, 200-player game:');
    console.log('    TV broadcasts: ' + broadcasts + ' × ' + units + ' billing unit(s) × 201 (1 in + 200 out) = ' + broadcasts * units * 201);
    console.log('    phone messages: ' + publishes + ' × 2 (1 in + 1 out to the TV) = ' + publishes * 2);
    console.log('    total ≈ ' + ablyEstimate.toLocaleString() + ' messages (free tier: 6,000,000/month ≈ ' + Math.floor(6e6 / ablyEstimate) + ' games like this)');
    console.log('    (bot phones received ' + delivered + ' state messages between them)');
    assert(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    console.log('\nLOAD TEST PASSED');
  } finally {
    bots.forEach((b) => b.stop());
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error('\nLOAD TEST FAILED: ' + e.message);
  process.exit(1);
});
