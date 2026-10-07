// The host: runs on the TV/laptop and owns the game.
//
// It holds the one true game state (engine.js), saves it to localStorage on
// every change (so a refresh resumes the room), broadcasts a public view to
// the phones, and applies their joins/answers/wagers as they arrive.
(function () {
  'use strict';
  const { esc, store, uid, shape, LETTERS, avatar, fmt, signed, ordinal, toast, getJSON } = window.PGN;
  const E = window.PGNEngine;
  const A = window.PGNAudio;

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const lineEl = $('#line');
  const controls = $('#controls');

  // ?speed=4 runs every timer 4x faster: for rehearsals and the automated test.
  const params = new URLSearchParams(location.search);
  const SPEED = Math.max(1, Math.min(20, Number(params.get('speed')) || 1));
  // The game clock runs SPEED times faster than the wall clock.
  const t0 = Date.now();
  const gameNow = () => (SPEED === 1 ? Date.now() : t0 + (Date.now() - t0) * SPEED);

  const H = {
    cfg: null,
    packs: [],
    codes: store.get('pgn:codes', []),
    state: null,
    rt: null,
    hostId: null,
    viewKey: null,
    picking: false,
    lastTickSec: null,
    probing: false,
    collision: false,
    stats: { broadcasts: 0, maxBytes: 0 }, // for the load test
  };
  window.__pgnHost = H; // handy in the console and for tests

  // ---------------------------------------------------------------- boot

  async function boot() {
    PGN.lights($('#lights'));
    PGN.snow($('#snow'));
    A.bindButtons();
    $('#fsBtn').addEventListener('click', toggleFullscreen);
    bindKeys();

    try {
      H.cfg = await getJSON('/api/config');
    } catch (e) {
      H.cfg = { realtime: 'none' };
    }

    const claim = params.get('claim');
    if (claim) await claimPurchase(claim);

    await loadPacks();

    const saved = store.get('pgn:host', null);
    if (saved && saved.state && !E.isExpired(saved.state, Date.now())) {
      H.saved = saved;
    } else if (saved) {
      store.del('pgn:host');
    }
    showPicker();
    requestAnimationFrame(frame);
    setInterval(loop, 200);
  }

  async function loadPacks() {
    try {
      const r = await getJSON('/api/packs?codes=' + encodeURIComponent(H.codes.join(',')));
      H.packs = r.packs;
    } catch (e) {
      H.packs = [];
      toast('Could not load the question packs: ' + e.message);
    }
  }

  // ---------------------------------------------------------------- pack picker

  function showPicker() {
    H.picking = true;
    H.viewKey = 'picker';
    $('#autobar').hidden = true;
    renderChrome();
    A.music(false);
    const s = H.state;
    const groups = {};
    for (const p of H.packs) (groups[p.collection] = groups[p.collection] || []).push(p);

    let html = '';
    if (!H.cfg || H.cfg.realtime === 'none') {
      html += '<div class="setup-note"><b>One setup step left:</b> phones can’t connect until realtime is configured. Add <code>ABLY_API_KEY</code> in Vercel → Settings → Environment Variables, then redeploy. (See the README.)</div>';
    }
    if (H.saved && !s) {
      const st = H.saved.state;
      html += '<div class="resume"><div><b>Room ' + esc(st.room) + ' is still open</b> <span class="muted">· ' +
        st.order.length + ' player' + (st.order.length === 1 ? '' : 's') + (st.pack ? ' · ' + esc(st.pack.title) : '') +
        '</span></div><div style="display:flex;gap:10px"><button class="btn primary small" id="resumeBtn">Resume room</button><button class="btn ghost small" id="discardBtn">Close it</button></div></div>';
    }
    if (s) {
      html += '<div class="resume"><div><b>Room ' + esc(s.room) + ' stays open.</b> <span class="muted">Pick the next pack. Players keep their seats.</span></div>' +
        (s.pack ? '<button class="btn ghost small" id="backLobby">Back to lobby</button>' : '') + '</div>';
    }
    html += '<div class="hero"><div class="eyebrow">Tonight’s entertainment</div><h1 class="display">Christmas <em>Party</em> Game Night</h1>' +
      '<p>Pick a pack. Everyone plays on their phone. Nobody needs an app.</p></div>';
    for (const [name, list] of Object.entries(groups)) {
      html += '<section class="pack-group"><h3>' + esc(name) + '</h3><div class="pack-grid">';
      for (const p of list) html += packCard(p);
      html += '</div></section>';
    }
    if (!H.packs.length) html += '<p class="center muted">No packs found.</p>';
    const col = ((H.cfg && H.cfg.products) || []).find((x) => x.id === 'christmas');
    if (H.packs.some((p) => !p.unlocked) && col) {
      html += '<div class="picker-foot"><button class="btn primary" id="buyAllBtn">🎁 Get all four packs · ' + esc(col.price) + '</button><button class="btn ghost" id="codeBtn">🎟 Have a purchase code?</button></div>';
    } else {
      html += '<div class="picker-foot"><button class="btn ghost" id="codeBtn">🎟 Have a purchase code?</button></div>';
    }
    stage.innerHTML = html;

    stage.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => openPack(b.dataset.pack)));
    on('#codeBtn', 'click', () => codeModal());
    on('#buyAllBtn', 'click', buyModal);
    on('#resumeBtn', 'click', resumeSaved);
    on('#discardBtn', 'click', () => {
      store.del('pgn:host');
      H.saved = null;
      showPicker();
    });
    on('#backLobby', 'click', () => {
      H.picking = false;
      H.viewKey = null;
      render();
    });
    setLine(s ? 'New pack, same crowd. Choose wisely.' : 'Welcome! Pick a pack to open a room.');
  }

  function packCard(p) {
    const total = p.questionCount || 1;
    const d = p.difficulty;
    return '<button class="pack" data-pack="' + esc(p.id) + '">' +
      '<div class="icon">' + esc(p.icon) + '</div>' +
      '<div class="title">' + esc(p.title) + '</div>' +
      '<div class="tag">' + esc(p.tagline) + '</div>' +
      '<div class="meta">' +
      (p.unlocked ? '<span class="pill gold">' + (p.free ? 'Free' : 'Unlocked') + '</span>' : '<span class="pill lock">🔒 Free sample round</span>') +
      '<span class="pill">' + p.questionCount + ' questions</span>' +
      (p.audience ? '<span class="pill">' + esc(p.audience) + '</span>' : '') +
      '</div>' +
      '<div class="diffbar" title="' + d.easy + ' easy · ' + d.medium + ' medium · ' + d.hard + ' hard">' +
      '<i class="e" style="width:' + (d.easy / total) * 100 + '%"></i><i class="m" style="width:' + (d.medium / total) * 100 + '%"></i><i class="h" style="width:' + (d.hard / total) * 100 + '%"></i></div>' +
      '</button>';
  }

  function openPack(id) {
    const p = H.packs.find((x) => x.id === id);
    if (!p) return;
    let length = store.get('pgn:length', 'short');
    if (!E.LENGTHS[length]) length = 'short';
    const lengthSeg = Object.entries(E.LENGTHS)
      .map(([k, v]) => '<button data-len="' + k + '" class="' + (k === length ? 'on' : '') + '">' + v.label + ' · ' + v.questions + ' questions <span class="muted">' + v.minutes + '</span></button>')
      .join('');
    const d = p.difficulty;
    const body =
      '<div class="eyebrow">' + esc(p.collection) + (p.translation ? ' · ' + esc(p.translation) : '') + '</div>' +
      '<h2 class="display">' + esc(p.icon) + ' ' + esc(p.title) + '</h2>' +
      '<p>' + esc(p.description || p.tagline) + '</p>' +
      '<p class="muted">' + p.questionCount + ' questions · ' + d.easy + ' easy, ' + d.medium + ' medium, ' + d.hard + ' hard</p>' +
      (p.unlocked
        ? '<div class="field"><span>Game length</span><div class="seg" id="lenSeg">' + lengthSeg + '</div></div>' +
          '<p class="muted" style="font-size:.9em">Round one: classic multiple choice. Round two: the speed round. Then the all-in wager finale.</p>' +
          '<div class="actions"><button class="btn primary" id="goFull">' + (H.state ? 'Load this pack' : 'Open the room') + '</button><button class="btn ghost" data-close>Cancel</button></div>'
        : '<p>This pack is locked. Play a <b>free 5-question sample round</b> now, or unlock all ' + p.questionCount + ' questions, the speed round and the all-in finale.</p>' +
          offersHTML(p) +
          '<div class="actions"><button class="btn" id="goSample">Play the free sample</button>' +
          '<button class="btn ghost" id="haveCode">I have a code</button><button class="btn ghost" data-close>Cancel</button></div>');
    const m = modal(body);
    m.querySelectorAll('[data-len]').forEach((b) =>
      b.addEventListener('click', () => {
        length = b.dataset.len;
        store.set('pgn:length', length);
        m.querySelectorAll('[data-len]').forEach((x) => x.classList.toggle('on', x === b));
      })
    );
    on('#goFull', 'click', () => { closeModal(); startWithPack(p.id, 'full', length); }, m);
    on('#goSample', 'click', () => { closeModal(); startWithPack(p.id, 'sample', 'short'); }, m);
    on('#haveCode', 'click', () => { closeModal(); codeModal(p.id); }, m);
    bindOffers(m, p.id);
  }

  // ---------------------------------------------------------------- codes + purchase

  function codeModal(thenPackId) {
    const m = modal(
      '<div class="eyebrow">Unlock</div><h2 class="display">Enter your code</h2>' +
      '<p class="muted">Codes look like CHRISTMAS-K7QX-3M9PTR8A. They’re saved on this device.</p>' +
      '<label class="field"><span>Purchase code</span><input class="input" id="codeIn" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>' +
      '<div class="err" id="codeErr"></div>' +
      '<div class="actions"><button class="btn primary" id="codeGo">Unlock</button><button class="btn ghost" data-close>Cancel</button></div>'
    );
    const input = m.querySelector('#codeIn');
    input.focus();
    const go = async () => {
      const code = input.value.trim();
      if (!code) return;
      try {
        const r = await getJSON('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        if (!r.valid) {
          m.querySelector('#codeErr').textContent = 'That code isn’t valid. Check for typos?';
          return;
        }
        addCode(r.code);
        closeModal();
        await loadPacks();
        toast('Unlocked: ' + r.unlocks.map((u) => u.title).join(', '));
        if (H.picking) showPicker();
        if (thenPackId) openPack(thenPackId);
      } catch (e) {
        m.querySelector('#codeErr').textContent = e.message;
      }
    };
    on('#codeGo', 'click', go, m);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  }

  function addCode(code) {
    if (!H.codes.includes(code)) H.codes.push(code);
    store.set('pgn:codes', H.codes);
  }

  // The three ways to buy, Collection first (it's the default). `pack` is the
  // pack the host tapped, for the single-pack option; omit it to offer only
  // the Collection and the Group License.
  function offersHTML(pack) {
    const products = (H.cfg && H.cfg.products) || [];
    const by = (id) => products.find((x) => x.id === id);
    const open = !!(H.cfg && H.cfg.checkout);
    const dis = open ? '' : ' disabled';
    const col = by('christmas');
    const single = by('pack');
    const group = by('group');
    let html = '<div class="offers">';
    if (col) {
      html += '<div class="offer featured"><div class="offer-head"><span class="pill gold">Best value</span><b>' + esc(col.name) + '</b><span class="offer-price">' + esc(col.price) + '</span></div>' +
        '<div class="muted">' + esc(col.blurb) + '</div>' +
        '<button class="btn primary" data-buy="christmas"' + dis + '>Get the ' + esc(col.name) + ' · ' + esc(col.price) + '</button></div>';
    }
    if (single && pack) {
      html += '<div class="offer"><div class="offer-head"><b>Just ' + esc(pack.title) + '</b><span class="offer-price">' + esc(single.price) + '</span></div>' +
        '<button class="btn" data-buy="pack"' + dis + '>Buy this pack · ' + esc(single.price) + '</button></div>';
    }
    if (group) {
      html += '<div class="offer"><div class="offer-head"><b>' + esc(group.name) + '</b><span class="offer-price">' + esc(group.price) + '</span></div>' +
        '<div class="muted">' + esc(group.blurb) + '</div>' +
        '<button class="btn" data-buy="group"' + dis + '>Get the ' + esc(group.name) + ' · ' + esc(group.price) + '</button></div>';
    }
    if (!open) html += '<p class="muted offer-note">Checkout opens soon. Already have a code? Tap “I have a code”.</p>';
    return html + '</div>';
  }

  function bindOffers(root, packId) {
    root.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.buy, packId)));
  }

  function buyModal() {
    const m = modal('<div class="eyebrow">Unlock everything</div><h2 class="display">Christmas Party Game Night</h2>' +
      '<p>Every question in every pack, plus the speed round and the all-in finale.</p>' + offersHTML(null) +
      '<div class="actions"><button class="btn ghost" id="haveCode">I have a code</button><button class="btn ghost" data-close>Close</button></div>');
    bindOffers(m, null);
    on('#haveCode', 'click', () => { closeModal(); codeModal(); }, m);
  }

  async function buy(product, packId) {
    try {
      const r = await getJSON('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product, packId }) });
      location.href = r.url;
    } catch (e) {
      toast(e.message);
    }
  }

  async function claimPurchase(sessionId) {
    history.replaceState(null, '', location.pathname);
    try {
      const r = await getJSON('/api/claim?session_id=' + encodeURIComponent(sessionId));
      addCode(r.code);
      modal('<div class="eyebrow">Thank you!</div><h2 class="display">You’re unlocked 🎉</h2>' +
        '<p>Unlocked: <b>' + r.unlocks.map((u) => esc(u.title)).join(', ') + '</b>. It’s saved on this device. Keep this code to unlock on another one:</p>' +
        '<div class="code-show">' + esc(r.code) + '</div><div class="actions"><button class="btn primary" data-close>Let’s play</button></div>');
    } catch (e) {
      toast('Could not confirm the purchase: ' + e.message, 6000);
    }
  }

  // ---------------------------------------------------------------- room lifecycle

  async function startWithPack(packId, mode, length) {
    A.unlock();
    let data;
    try {
      data = await getJSON('/api/pack?id=' + encodeURIComponent(packId) + '&codes=' + encodeURIComponent(H.codes.join(',')) + (mode === 'sample' ? '&mode=sample' : ''));
    } catch (e) {
      return toast('Could not load that pack: ' + e.message);
    }
    const used = new Set(store.get('pgn:used:' + packId, []));
    // Once nearly everything has been played, start the rotation over.
    if (used.size >= data.questions.length - 3) used.clear();
    const rounds = E.buildRounds(data.questions, { mode: data.mode, length, used });

    if (!H.state) {
      try {
        await openRoom();
      } catch (e) {
        return toast(e.message, 6000);
      }
    }
    E.setupGame(H.state, { pack: data.pack, mode: data.mode, length, rounds, now: gameNow() });
    document.body.dataset.theme = data.pack.theme || 'christmas';
    H.picking = false;
    H.saved = null;
    changed(true);
  }

  async function openRoom() {
    if (H.cfg.realtime === 'none') throw new Error('Realtime isn’t configured yet (ABLY_API_KEY). See the README.');
    H.hostId = uid('host-');
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = E.makeRoomCode();
      H.collision = false;
      await connect(code);
      // Ask the channel if anyone is already hosting this code.
      H.probing = true;
      H.rt.publish('hello', { pid: H.hostId, probe: true });
      await new Promise((r) => setTimeout(r, 900));
      H.probing = false;
      if (!H.collision) {
        H.state = E.createRoom({ room: code, hostId: H.hostId, now: gameNow() });
        return;
      }
      H.rt.close();
    }
    throw new Error('Could not find a free room code. Try again?');
  }

  async function resumeSaved() {
    const saved = H.saved;
    H.saved = null;
    H.hostId = saved.hostId;
    H.state = saved.state;
    document.body.dataset.theme = (H.state.pack && H.state.pack.theme) || 'christmas';
    A.unlock();
    try {
      await connect(H.state.room);
    } catch (e) {
      return toast(e.message, 6000);
    }
    H.picking = !H.state.pack;
    if (H.picking) return showPicker();
    changed(true);
  }

  async function connect(room) {
    if (H.rt) H.rt.close();
    H.rt = await window.PGNRealtime.connect({
      mode: H.cfg.realtime,
      role: 'host',
      room,
      clientId: H.hostId,
      onMessage,
      onStatus(s) {
        if (s === 'reconnecting') toast('Connection hiccup. Reconnecting…');
        if (s === 'resync' && H.state) broadcast();
        if (s === 'failed') toast('Realtime connection failed. Check ABLY_API_KEY.', 8000);
      },
    });
  }

  function endRoom(reason) {
    if (H.rt && H.state) H.rt.publish('closed', { reason: reason || 'ended' });
    if (H.rt) setTimeout(() => H.rt && H.rt.close(), 300);
    store.del('pgn:host');
    H.state = null;
    H.rt = null;
    A.music(false);
    document.body.dataset.theme = 'christmas';
    showPicker();
  }

  // ---------------------------------------------------------------- messages from phones

  function onMessage(name, data, from) {
    if (!data || typeof data !== 'object') return;
    if (H.probing && name === 'state' && data.hostId !== H.hostId) {
      H.collision = true;
      return;
    }
    const s = H.state;
    if (!s) return;
    const t = gameNow();
    switch (name) {
      case 'join': {
        const known = !!s.players[data.pid];
        const res = E.join(s, data, t);
        // Success needs no reply of its own: the phone sees itself in the next
        // state broadcast. Only a refusal gets a message (it goes to every phone,
        // and with 100 of them a reply per join would add up).
        if (!res.ok) H.rt.publish('joinResult', { pid: data.pid, ok: false, reason: res.reason || null, room: s.room });
        else {
          if (!known) A.sfx.join();
          changed();
        }
        break;
      }
      case 'hello':
        // Another TV probing for a free code needs an answer now; anything else
        // waits for the next (throttled) broadcast.
        if (data.probe) broadcast();
        else scheduleBroadcast();
        break;
      case 'answer':
        if (E.answer(s, data, t)) {
          A.sfx.lock();
          changed();
        }
        break;
      case 'wager':
        if (E.wager(s, data, t)) {
          A.sfx.lock();
          changed();
        }
        break;
      case 'leave':
        if (s.players[data.pid] && E.kick(s, data.pid, false)) changed();
        break;
    }
  }

  // ---------------------------------------------------------------- state changes

  // Phase changes go out at once. Joins, answers and wagers are folded into
  // at most one broadcast every BROADCAST_GAP_MS: each broadcast is delivered
  // to every phone, so with 100 players this is what keeps a game at a few
  // thousand Ably messages instead of tens of thousands.
  const BROADCAST_GAP_MS = 1500;
  let bTimer = null;
  let lastBroadcast = 0;
  function changed(immediate) {
    persist();
    if (immediate) broadcast();
    else scheduleBroadcast();
    render();
  }

  function scheduleBroadcast() {
    if (bTimer) return;
    const wait = Math.max(150, BROADCAST_GAP_MS - (Date.now() - lastBroadcast));
    bTimer = setTimeout(broadcast, wait);
  }

  function persist() {
    if (H.state) store.set('pgn:host', { state: H.state, hostId: H.hostId, savedAt: Date.now() });
  }

  function broadcast() {
    clearTimeout(bTimer);
    bTimer = null;
    lastBroadcast = Date.now();
    if (H.rt && H.state) {
      const v = viewForPhones();
      H.stats.broadcasts++;
      H.stats.maxBytes = Math.max(H.stats.maxBytes, JSON.stringify(v).length);
      H.rt.publish('state', v);
    }
  }

  function viewForPhones() {
    const v = E.publicView(H.state, gameNow());
    // Phones count down in real seconds, so undo the rehearsal speed-up.
    if (SPEED !== 1) {
      if (v.remainingMs != null) v.remainingMs = Math.round(v.remainingMs / SPEED);
      if (v.durationMs != null) v.durationMs = Math.round(v.durationMs / SPEED);
    }
    return v;
  }

  function loop() {
    const s = H.state;
    if (!s) return;
    if (E.isExpired(s, Date.now())) {
      toast('Room ' + s.room + ' expired after 24 hours.');
      return endRoom('expired');
    }
    if (H.picking) return;
    const before = s.phase;
    if (E.tick(s, gameNow())) {
      onPhaseChange(before);
      changed(true);
    }
  }

  function onPhaseChange(from) {
    const s = H.state;
    const q = E.currentQuestion(s);
    switch (s.phase) {
      case 'roundIntro':
        A.sfx.chime();
        A.say(s.line);
        break;
      case 'wager':
        A.say(s.line);
        break;
      case 'question':
        A.sfx.question();
        if (q) A.say(q.text);
        break;
      case 'reveal':
        A.sfx.reveal();
        if (q) markUsed(q.id);
        A.say(s.line);
        break;
      case 'standings':
        A.sfx.chime();
        A.say(s.line);
        break;
      case 'gameover':
        A.sfx.fanfare();
        PGN.confetti($('#confetti'), 5000);
        A.say(s.line);
        break;
    }
  }

  function markUsed(id) {
    const key = 'pgn:used:' + H.state.pack.id;
    const list = store.get(key, []);
    if (!list.includes(id)) list.push(id);
    store.set(key, list);
  }

  // Host buttons
  function startGame() {
    const r = E.start(H.state, gameNow());
    if (!r.ok) return toast(r.reason === 'no-players' ? 'Waiting for at least one player to join.' : 'Can’t start yet.');
    A.unlock();
    A.music(false);
    onPhaseChange('lobby');
    changed(true);
  }

  function next() {
    const s = H.state;
    if (!s || H.picking) return;
    if (s.phase === 'lobby') return startGame();
    if (s.paused) E.resume(s, gameNow());
    if (E.advance(s, gameNow())) {
      onPhaseChange();
      changed(true);
    }
  }

  function togglePause() {
    const s = H.state;
    if (!s) return;
    if (s.paused ? E.resume(s, gameNow()) : E.pause(s, gameNow())) changed(true);
  }

  function playAgain() {
    startWithPack(H.state.pack.id, H.state.mode, H.state.length || 'short');
  }

  function newPack() {
    E.clearPack(H.state, gameNow());
    changed(true);
    showPicker();
  }

  // ---------------------------------------------------------------- rendering

  function setLine(text) {
    if (lineEl.dataset.text === (text || '')) return;
    lineEl.dataset.text = text || '';
    lineEl.innerHTML = text ? '<span class="mic" aria-hidden="true">🎙</span><span class="txt">' + esc(text) + '</span>' : '';
  }

  function joinOrigin() {
    return (H.cfg && H.cfg.joinOrigin) || location.origin;
  }

  function renderChrome() {
    const s = H.state;
    const chip = $('#roomChip');
    if (s) {
      chip.hidden = false;
      chip.innerHTML = '<span class="url">' + esc(joinOrigin().replace(/^https?:\/\//, '')) + '/play</span><b>' + esc(s.room) + '</b>';
    } else chip.hidden = true;

    let c = '';
    if (s && !H.picking) {
      if (s.phase !== 'lobby' && s.phase !== 'gameover') {
        c += '<button class="btn small ghost" id="pauseBtn" title="Pause (P)">' + (s.paused ? '▶ Resume' : '⏸ Pause') + '</button>';
        c += '<button class="btn small ghost" id="nextBtn" title="Skip ahead (Space)">Next ⏭</button>';
      }
      if (s.phase === 'lobby' || s.phase === 'gameover') c += '<button class="btn small danger" id="endBtn">End room</button>';
    }
    controls.innerHTML = c;
    on('#pauseBtn', 'click', togglePause);
    on('#nextBtn', 'click', next);
    on('#endBtn', 'click', () => {
      if (confirm('End room ' + s.room + '? Everyone will be disconnected.')) endRoom('ended');
    });
  }

  function render() {
    const s = H.state;
    if (!s || H.picking) return;
    const key = s.phase + ':' + s.r + ':' + s.q + ':' + (s.pack ? s.pack.id : '') + ':' + s.gamesPlayed;
    renderChrome();
    setLine(s.line);
    A.music(s.phase === 'lobby');
    if (key !== H.viewKey) {
      H.viewKey = key;
      H.lastTickSec = null;
      stage.innerHTML = VIEWS[s.phase] ? VIEWS[s.phase](s) : '';
      bindStage();
    } else if (UPDATES[s.phase]) {
      UPDATES[s.phase](s);
    }
  }

  function bindStage() {
    on('#startBtn', 'click', startGame);
    on('#changePack', 'click', newPack);
    on('#againBtn', 'click', playAgain);
    on('#newPackBtn', 'click', newPack);
    on('#unlockBtn', 'click', () => {
      const id = H.state.pack.id;
      newPack();
      openPack(id);
    });
    stage.querySelectorAll('[data-kick]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = H.state.players[b.dataset.kick];
        if (p && confirm('Remove ' + p.name + ' from the game?')) {
          E.kick(H.state, b.dataset.kick, true);
          H.rt.publish('joinResult', { pid: b.dataset.kick, ok: false, reason: 'removed' });
          changed(true);
        }
      })
    );
  }

  const roundLabel = (s) => {
    const r = E.currentRound(s);
    if (!r) return '';
    if (r.type === 'final') return 'Final round';
    return 'Round ' + (s.r + 1) + ' of ' + s.rounds.length;
  };

  function playersHTML(s) {
    if (!s.order.length) return '<div class="empty-players">Waiting for the first brave soul…</div>';
    // Newest first, so a big crowd can still spot their own name pop in.
    return s.order.slice().reverse().map((id) => {
      const p = s.players[id];
      return '<span class="pchip">' + avatar(p.name, id) + esc(p.name) +
        '<button class="x" data-kick="' + esc(id) + '" title="Remove ' + esc(p.name) + '" aria-label="Remove ' + esc(p.name) + '">✕</button></span>';
    }).join('');
  }

  function qrSVG(text) {
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      return '';
    }
  }

  function timerHTML() {
    return '<div class="timer" id="timer"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="bar" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg><div class="num">–</div></div>';
  }

  function lockedRowHTML(s, key) {
    const got = s.order.filter((id) => (key === 'wager' ? s.wagers[id] != null : !!s.answers[id])).length;
    if (s.order.length > 16) {
      // Too many faces for one row: a progress bar instead.
      return '<div class="lockbar"><i style="width:' + (got / s.order.length) * 100 + '%"></i></div><span>' + got + ' of ' + s.order.length + ' locked in</span>';
    }
    return s.order.map((id) => {
      const done = key === 'wager' ? s.wagers[id] != null : !!s.answers[id];
      return avatar(s.players[id].name, id).replace('class="avatar"', 'class="avatar' + (done ? '' : ' wait') + '" title="' + esc(s.players[id].name) + '"');
    }).join('') + '<span>' + got + ' of ' + s.order.length + ' locked in</span>';
  }

  function answersHTML(q, revealed) {
    return '<div class="answers' + (revealed ? ' revealed' : '') + '">' + q.choices.map((c, i) =>
      '<div class="ans c' + i + (revealed && i === q.correct ? ' right' : '') + '">' + shape(i) +
      '<span><span class="sr-only">' + LETTERS[i] + ': </span>' + esc(c) + '</span>' +
      (revealed ? '<span class="count">' + countFor(i) + '</span>' : '') + '</div>'
    ).join('') + '</div>';
  }

  function countFor(i) {
    const s = H.state;
    let n = 0;
    for (const id of s.order) if (s.results && s.results[id] && s.results[id].choice === i) n++;
    return n;
  }

  function boardRows(s, opts) {
    const { sorted, rank } = E.ranks(s);
    const limit = (opts && opts.limit) || E.TOP_N;
    let list = sorted.slice(0, limit);
    if (opts && opts.skip) list = list.slice(opts.skip);
    return list.map((id, i) => {
      const p = s.players[id];
      const res = opts && opts.results && s.results ? s.results[id] : null;
      const prev = s.prevRanks[id];
      const mv = prev && prev !== rank[id] ? (prev > rank[id] ? '<span class="move up">▲' + (prev - rank[id]) + '</span>' : '<span class="move down">▼' + (rank[id] - prev) + '</span>') : '<span class="move"></span>';
      const dl = res ? '<span class="dl ' + (res.points > 0 ? 'up' : res.points < 0 ? 'down' : 'zero') + '">' + (res.points ? signed(res.points) : '—') + '</span>' : '<span></span>';
      return '<div class="row' + (rank[id] === 1 ? ' first' : '') + '" style="animation-delay:' + i * 0.05 + 's"><span class="rank">' + rank[id] + '</span>' +
        avatar(p.name, id) + '<span class="nm">' + esc(p.name) + ' ' + mv + '</span>' + dl + '<span class="sc">' + fmt(p.score) + '</span></div>';
    }).join('') + (sorted.length > limit ? '<div class="more-row">…and ' + (sorted.length - limit) + ' more. Everyone’s place is on their phone.</div>' : '');
  }

  const VIEWS = {
    lobby(s) {
      if (!s.pack) return '';
      const url = joinOrigin() + '/play?room=' + s.room;
      const host = joinOrigin().replace(/^https?:\/\//, '');
      return '<div class="lobby">' +
        '<div class="join-panel"><div class="how">On your phone, go to <b>' + esc(host) + '/play</b><br>and enter the room code</div>' +
        '<div class="code-big" aria-label="Room code ' + esc(s.room.split('').join(' ')) + '">' + esc(s.room) + '</div>' +
        '<div class="qr" title="Scan to join">' + qrSVG(url) + '</div><div class="muted">or scan to join</div></div>' +
        '<div class="lobby-right"><div class="eyebrow">' + esc(s.pack.icon) + ' ' + esc(s.pack.title) + (s.mode === 'sample' ? ' · Free sample round' : ' · ' + esc((E.LENGTHS[s.length] || {}).label || '') + ' game') + '</div>' +
        '<h2 class="display">Who’s playing?</h2><div class="sub" id="pcount">' + countLine(s) + '</div>' +
        '<div class="players' + (s.order.length > 24 ? ' many' : '') + '" id="players">' + playersHTML(s) + '</div>' +
        '<div class="lobby-actions"><button class="btn primary" id="startBtn"' + (s.order.length ? '' : ' disabled') + '>Start the game ▶</button>' +
        '<button class="btn ghost" id="changePack">Change pack</button></div></div></div>';
    },
    roundIntro(s) {
      const r = E.currentRound(s);
      return '<div class="round-intro"><div class="num">' + esc(roundLabel(s)) + '</div><h1 class="display">' + esc(r.title) + '</h1><p>' + esc(r.blurb) + '</p></div>';
    },
    wager(s) {
      const q = E.currentQuestion(s);
      return '<div class="wager-screen"><div class="eyebrow">The All-In Finale</div><h1 class="display">Place your wagers</h1>' +
        '<div class="cat">Category: <b>' + esc((q && q.category) || s.pack.title) + '</b> · Difficulty: <b>' + esc(q ? q.difficulty : 'hard') + '</b></div>' +
        '<p class="muted" style="font-size:clamp(16px,1.3vw,24px)">Bet any part of your score on your phone. Under 1,000 points? The house lets you bet up to 1,000.</p>' +
        '<div style="display:flex;justify-content:center;margin:3vh 0">' + timerHTML() + '</div>' +
        '<div class="locked-row" id="locked">' + lockedRowHTML(s, 'wager') + '</div></div>';
    },
    question(s) {
      const q = E.currentQuestion(s);
      const r = E.currentRound(s);
      return '<div class="q-head"><div class="meta"><span class="pill">' + esc(roundLabel(s)) + '</span><span class="pill">' +
        (r.type === 'final' ? 'All-in question' : 'Question ' + (s.q + 1) + ' of ' + r.questions.length) + '</span>' +
        '<span class="pill">' + esc(q.difficulty) + '</span>' + (q.category ? '<span class="pill">' + esc(q.category) + '</span>' : '') +
        '</div><div class="spacer"></div><span class="paused-tag" id="pausedTag"' + (s.paused ? '' : ' hidden') + '>Paused</span>' + timerHTML() + '</div>' +
        '<h1 class="q-text">' + esc(q.text) + '</h1>' + answersHTML(q, false) +
        '<div class="locked-row" id="locked">' + lockedRowHTML(s, 'answer') + '</div>';
    },
    reveal(s) {
      const q = E.currentQuestion(s);
      const refs = (q.refs || []).map((r) => '<span class="pill">' + esc(r.label) + ': ' + esc(r.ref) + '</span>').join('');
      const isFinal = E.currentRound(s).type === 'final';
      return '<div class="reveal-grid"><div><h1 class="q-text">' + esc(q.text) + '</h1>' + answersHTML(q, true) +
        '<div class="explain">' + esc(q.reveal) + (refs ? '<div class="refs">' + refs + '</div>' : '') + '</div></div>' +
        '<div class="board"><h3>' + (isFinal ? 'Final scores' : 'Leaderboard') + '</h3>' + boardRows(s, { results: true, limit: 10 }) + '</div></div>';
    },
    standings(s) {
      const big = s.order.length > 8;
      return '<div class="standings' + (big ? ' compact' : '') + '"><div class="eyebrow center" style="text-align:center">End of ' + esc(roundLabel(s).toLowerCase()) + '</div><h1 class="display">The standings</h1><div class="board' + (big ? ' cols' : '') + '">' + boardRows(s, {}) + '</div></div>';
    },
    gameover(s) {
      const { sorted } = E.ranks(s);
      const top = sorted.slice(0, 3).map((id) => s.players[id]);
      const tie = top.length > 1 && top[0].score === top[1].score;
      const winners = sorted.filter((id) => s.players[id].score === (top[0] ? top[0].score : 0)).map((id) => s.players[id].name);
      const step = (p, cls, n) => p ? '<div class="step ' + cls + '">' + (n === 1 ? '<div class="crown">👑</div>' : '') + '<div class="who">' + esc(p.name) + '</div><div class="pts">' + fmt(p.score) + ' pts</div><div class="block">' + n + '</div></div>' : '';
      return '<div class="standings' + (sorted.length > 7 ? ' compact' : '') + '"><div class="eyebrow" style="text-align:center">' + (s.mode === 'sample' ? 'Sample round complete' : 'Game over') + '</div>' +
        '<h1 class="winner-name">' + (tie ? 'It’s a tie: ' + esc(winners.join(' & ')) : esc(top[0] ? top[0].name : 'Nobody') + ' wins!') + '</h1>' +
        '<div class="podium">' + step(top[1], 'p2', 2) + step(top[0], 'p1', 1) + step(top[2], 'p3', 3) + '</div>' +
        (sorted.length > 3 ? '<div class="board cols">' + boardRows(s, { skip: 3 }) + '</div>' : '') +
        (s.mode === 'sample' ? '<div class="unlock-cta">Liked the sample? The <b>Christmas Collection</b> unlocks all four packs, every question, the speed round and the all-in finale.</div>' : '') +
        '<div class="end-actions">' +
        (s.mode === 'sample' ? '<button class="btn primary" id="unlockBtn">Get the Christmas Collection</button>' : '<button class="btn primary" id="againBtn">Play again (new questions)</button>') +
        '<button class="btn" id="newPackBtn">New pack</button></div></div>';
    },
  };

  const UPDATES = {
    lobby(s) {
      const el = $('#players');
      if (!el) return;
      const ids = s.order.join(',');
      if (el.dataset.ids !== ids) {
        el.dataset.ids = ids;
        el.classList.toggle('many', s.order.length > 24);
        el.innerHTML = playersHTML(s);
        bindStage();
      }
      $('#pcount').innerHTML = countLine(s);
      const b = $('#startBtn');
      if (b) b.disabled = !s.order.length;
    },
    question(s) {
      const el = $('#locked');
      if (el) el.innerHTML = lockedRowHTML(s, 'answer');
      const p = $('#pausedTag');
      if (p) p.hidden = !s.paused;
    },
    wager(s) {
      const el = $('#locked');
      if (el) el.innerHTML = lockedRowHTML(s, 'wager');
    },
  };

  function countLine(s) {
    const n = s.order.length;
    return n === 0 ? 'Room for up to ' + E.MAX_PLAYERS + ' players.' : n + ' player' + (n === 1 ? '' : 's') + ' in. ' + (n < 2 ? 'The more the merrier.' : 'Start whenever you’re ready.');
  }

  // Timer ring, auto-advance bar, last-five-seconds ticking. Runs every frame.
  function frame() {
    requestAnimationFrame(frame);
    const s = H.state;
    const bar = $('#autobar');
    if (!s || H.picking || s.phaseEndsAt == null) {
      bar.hidden = true;
      return;
    }
    const t = gameNow();
    const total = s.phaseEndsAt - s.phaseStartedAt;
    const left = s.paused ? s.pausedRemaining : Math.max(0, s.phaseEndsAt - t);
    const frac = total > 0 ? left / total : 0;
    const timer = $('#timer');
    if (timer) {
      const sec = Math.ceil(left / 1000 / SPEED);
      timer.querySelector('.bar').setAttribute('stroke-dashoffset', String(276.5 * (1 - frac)));
      timer.querySelector('.num').textContent = String(sec);
      timer.classList.toggle('low', sec <= 5);
      if (s.phase === 'question' && !s.paused && sec <= 5 && sec > 0 && sec !== H.lastTickSec) A.sfx.tick();
      H.lastTickSec = sec;
      bar.hidden = true;
    } else {
      bar.hidden = false;
      bar.style.transform = 'scaleX(' + frac + ')';
    }
  }

  // ---------------------------------------------------------------- misc UI

  function modal(inner) {
    closeModal();
    const root = $('#modalRoot');
    root.innerHTML = '<div class="modal-back" id="modalBack"><div class="modal" role="dialog" aria-modal="true">' + inner + '</div></div>';
    const back = $('#modalBack');
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.hasAttribute('data-close')) closeModal();
    });
    return back.querySelector('.modal');
  }
  function closeModal() {
    $('#modalRoot').innerHTML = '';
  }

  function on(sel, ev, fn, root) {
    const el = (root || document).querySelector(sel);
    if (el) el.addEventListener(ev, fn);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'm' || e.key === 'M') A.setMuted(!A.isMuted());
      if (!H.state || H.picking || $('#modalBack')) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
      if (e.key === 'p' || e.key === 'P') togglePause();
    });
  }

  boot();
})();
