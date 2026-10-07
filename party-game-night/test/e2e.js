#!/usr/bin/env node
// End-to-end: a host on a "TV" and 3 simulated players on phones play a full
// game through the real pages and the dev server's realtime relay.
//
//   npm run e2e            (needs Playwright + Chromium installed)
//
// What it checks: unlocking with a code, room code + QR, live joins, all three
// round types, wagers, a phone that drops offline mid-game and recovers,
// scores matching on every screen, the end screen, and "play again".
// Screenshots land in test/screenshots/.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')));
}

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = 'http://localhost:' + PORT;
const SHOTS = path.join(__dirname, 'screenshots');
const SPEED = 4;
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ' + a.join(' '));
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  log('✓ ' + msg);
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
  if (!devCode) throw new Error('dev server did not start');

  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? {} : {});
  const errors = [];
  try {
    // ---------------------------------------------------------- host
    const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();
    host.on('pageerror', (e) => errors.push('host: ' + e.message));
    await host.goto(BASE + '/host?speed=' + SPEED);
    await host.waitForSelector('.pack');
    await host.screenshot({ path: path.join(SHOTS, '01-host-pack-picker.png') });
    const lockedBefore = await host.$$eval('.pill.lock', (els) => els.length);
    assert(lockedBefore === 4, 'all 4 packs start locked, with a free sample round');

    // Enter a purchase code.
    await host.click('#codeBtn');
    await host.fill('#codeIn', devCode.toLowerCase());
    await host.click('#codeGo');
    await host.waitForFunction(() => document.querySelectorAll('.pill.lock').length === 0);
    assert(true, 'purchase code unlocks every pack');

    // Pick the Nativity pack, Short game (10 questions).
    await host.click('[data-pack="nativity"]');
    await host.click('[data-len="short"]');
    await host.screenshot({ path: path.join(SHOTS, '02-host-pack-modal.png') });
    await host.click('#goFull');
    await host.waitForSelector('.code-big');
    const room = (await host.textContent('.code-big')).trim();
    assert(/^[A-Z]{4}$/.test(room), 'room code shown: ' + room);
    assert(!!(await host.$('.qr svg')), 'QR code rendered');

    // ---------------------------------------------------------- phones
    const names = ['Mary', 'Joseph', 'Gabriel'];
    const players = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(names[i] + ': ' + e.message));
      // Player 1 scans the QR (room prefilled); the others type it in.
      await page.goto(i === 0 ? BASE + '/play?room=' + room : BASE + '/play');
      if (i !== 0) await page.fill('#roomIn', room);
      await page.fill('#nameIn', names[i]);
      await page.click('#joinBtn');
      await page.waitForFunction(() => window.__pgnPlayer && window.__pgnPlayer.joined);
      players.push({ name: names[i], ctx, page });
    }
    await host.waitForFunction(() => window.__pgnHost.state.order.length === 3);
    const chips = await host.$$eval('.pchip', (els) => els.map((e) => e.textContent.replace('✕', '').trim().slice(1)));
    assert(chips.slice().reverse().join(',') === names.join(','), 'host lobby shows all 3 players live (newest first): ' + chips.join(', '));

    // A duplicate name is turned away politely.
    const dupCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const dup = await dupCtx.newPage();
    await dup.goto(BASE + '/play?room=' + room);
    await dup.fill('#nameIn', 'mary');
    await dup.click('#joinBtn');
    await dup.waitForFunction(() => /already has that name/.test(document.querySelector('#joinErr').textContent));
    assert(true, 'duplicate nickname rejected with a friendly message');
    await dupCtx.close();

    await players[0].page.screenshot({ path: path.join(SHOTS, '03-phone-lobby.png') });
    await host.screenshot({ path: path.join(SHOTS, '04-host-lobby.png') });

    // ---------------------------------------------------------- play
    await host.click('#startBtn');
    // Bot styles: Mary knows everything, Joseph guesses, Gabriel always taps the first button.
    const answered = {};
    const wagered = {};
    const seenPhases = new Set();
    const questionsPlayed = new Set();
    const shots = {};
    let droppedOnce = false;
    let recovered = false;
    const deadline = Date.now() + 240000;

    while (Date.now() < deadline) {
      const hs = await host.evaluate(() => {
        const s = window.__pgnHost.state;
        const q = window.PGNEngine.currentQuestion(s);
        return { phase: s.phase, r: s.r, q: s.q, type: (s.rounds[s.r] || {}).type, key: window.PGNEngine.questionKey(s), correct: q ? q.correct : null };
      });
      seenPhases.add(hs.phase + (hs.type ? ':' + hs.type : ''));
      if (hs.phase === 'question') questionsPlayed.add(hs.key);
      const shotKey = hs.phase + ':' + hs.type;
      if (!shots[shotKey] && ['question', 'reveal', 'standings', 'wager', 'roundIntro'].includes(hs.phase)) {
        shots[shotKey] = true;
        await sleep(350);
        const n = Object.keys(shots).length + 4;
        await host.screenshot({ path: path.join(SHOTS, String(n).padStart(2, '0') + '-host-' + hs.phase + '-' + hs.type + '.png') });
        await players[1].page.screenshot({ path: path.join(SHOTS, String(n).padStart(2, '0') + '-phone-' + hs.phase + '-' + hs.type + '.png') });
      }
      if (hs.phase === 'gameover') break;

      // Joseph's phone "goes to sleep" for a few seconds during the speed round.
      if (!droppedOnce && hs.type === 'speed' && hs.phase === 'question') {
        droppedOnce = true;
        log('… Joseph’s phone drops offline');
        await players[1].ctx.setOffline(true);
        // Kill the open stream too, like iOS does to a sleeping tab's sockets.
        await players[1].page.evaluate(() => window.__pgnPlayer.rt.close());
        await sleep(2500);
        await players[1].ctx.setOffline(false);
        // Waking up: the page notices it is visible/online again and rejoins
        // the same seat with the same player id.
        const seqBefore = await players[1].page.evaluate(() => window.__pgnPlayer.view.seq);
        await players[1].page.evaluate(() => window.dispatchEvent(new Event('online')));
        await players[1].page.waitForFunction((s) => window.__pgnPlayer.joined && window.__pgnPlayer.rt.alive() && window.__pgnPlayer.view.seq > s, seqBefore, { timeout: 10000 });
        recovered = await players[1].page.evaluate(() => window.__pgnPlayer.name === 'Joseph' && window.__pgnPlayer.view.count === 3);
        log('… Joseph’s phone is back: rejoined=' + recovered);
      }

      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const pv = await p.page.evaluate(() => {
          const P = window.__pgnPlayer;
          const v = P.view;
          return v ? { phase: v.phase, key: v.question && v.question.key, buttons: document.querySelectorAll('[data-pick]:not([disabled])').length, wagerBtn: !!document.querySelector('#lockW') } : null;
        });
        if (!pv) continue;
        if (pv.phase === 'question' && pv.key && !answered[i + pv.key] && pv.buttons === 4) {
          answered[i + pv.key] = true;
          const choice = i === 0 ? hs.correct : i === 1 ? Math.floor(Math.random() * 4) : 0;
          await sleep(150 + i * 250);
          await p.page.click('[data-pick="' + choice + '"]').catch(() => {});
        }
        if (pv.phase === 'wager' && pv.wagerBtn && !wagered[i]) {
          wagered[i] = true;
          await p.page.click(['[data-w]:last-child', '[data-w]:nth-child(3)', '[data-w]:first-child'][i]);
          await p.page.click('#lockW');
        }
      }
      await sleep(150);
    }

    assert(seenPhases.has('question:classic'), 'played the classic multiple-choice round');
    assert(seenPhases.has('question:speed'), 'played the speed round');
    assert(seenPhases.has('wager:final') && seenPhases.has('question:final'), 'played the all-in wager finale');
    assert(seenPhases.has('reveal:classic') && seenPhases.has('standings:classic'), 'showed reveals and standings');
    assert(questionsPlayed.size === 10, 'the Short game was exactly 10 questions (' + questionsPlayed.size + ')');
    assert(recovered, 'a phone that dropped offline rejoined the same seat');

    await host.waitForSelector('.winner-name');
    await sleep(600);
    await host.screenshot({ path: path.join(SHOTS, '20-host-gameover.png') });

    // Every screen agrees on the final scores.
    const hostScores = await host.evaluate(() => {
      const s = window.__pgnHost.state;
      return s.order.map((id) => [s.players[id].name, s.players[id].score]);
    });
    log('Final scores: ' + hostScores.map(([n, s]) => n + ' ' + s).join(', '));
    for (const p of players) {
      await p.page.waitForFunction(() => window.__pgnPlayer.view && window.__pgnPlayer.view.phase === 'gameover');
      const phoneScores = await p.page.evaluate(() => window.__pgnPlayer.view.top.map((x) => [x.name, x.score]));
      const sortedHost = hostScores.slice().sort((a, b) => a[0].localeCompare(b[0])).join('|');
      const sortedPhone = phoneScores.slice().sort((a, b) => a[0].localeCompare(b[0])).join('|');
      assert(sortedHost === sortedPhone, p.name + '’s phone shows the same final scores as the TV');
    }
    const place = await players[2].page.evaluate(() => [document.querySelector('#meScore').textContent, document.querySelector('#mePlace').textContent]);
    assert(/of 3$/.test(place[1]), 'each phone shows its own score and place: ' + place.join(' · '));
    const winner = await host.textContent('.winner-name');
    assert(/Mary/.test(winner), 'the player who knew every answer won: "' + winner.trim() + '"');
    await players[0].page.screenshot({ path: path.join(SHOTS, '21-phone-winner.png') });
    await players[2].page.screenshot({ path: path.join(SHOTS, '22-phone-gameover.png') });

    // Play again keeps everyone in the room, with fresh questions.
    const firstIds = await host.evaluate(() => window.__pgnHost.state.rounds.flatMap((r) => r.questions.map((q) => q.id)));
    await host.click('#againBtn');
    await host.waitForFunction(() => window.__pgnHost.state.phase === 'lobby' && window.__pgnHost.state.pack);
    const again = await host.evaluate(() => ({ n: window.__pgnHost.state.order.length, ids: window.__pgnHost.state.rounds.flatMap((r) => r.questions.map((q) => q.id)) }));
    assert(again.n === 3, '"Play again" keeps all 3 players in the room');
    assert(again.ids.every((id) => !firstIds.includes(id)), '"Play again" deals questions nobody has seen yet');
    await players[0].page.waitForFunction(() => window.__pgnPlayer.view.phase === 'lobby');
    assert(true, 'phones return to the lobby for the next game');

    // Host refresh mid-lobby resumes the same room.
    await host.reload();
    await host.waitForSelector('#resumeBtn');
    await host.click('#resumeBtn');
    await host.waitForSelector('.code-big');
    assert((await host.textContent('.code-big')).trim() === room, 'a refreshed TV resumes the same room code');

    // Ending the room tells every phone.
    host.once('dialog', (d) => d.accept());
    await host.click('#endBtn');
    await players[2].page.waitForFunction(() => /wrap/.test(document.body.textContent));
    assert(true, 'ending the room tells every phone');

    // A locked pack plays only its free sample round.
    await hostCtx.clearCookies();
    await host.evaluate(() => localStorage.removeItem('pgn:codes'));
    await host.reload();
    await host.waitForSelector('[data-pack="christmas-movies"] .pill.lock');
    await host.click('[data-pack="christmas-movies"]');
    await host.click('#goSample');
    await host.waitForSelector('.code-big');
    const sample = await host.evaluate(() => window.__pgnHost.state.rounds.map((r) => r.type + ':' + r.questions.length));
    assert(sample.join() === 'sample:5', 'a locked pack offers exactly one free 5-question sample round');

    assert(errors.length === 0, 'no JavaScript errors on any page' + (errors.length ? ': ' + errors.join('; ') : ''));
    console.log('\nE2E PASSED. Screenshots in ' + SHOTS);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error('\nE2E FAILED: ' + e.message);
  process.exit(1);
});
