// The phone: join a room, then mirror whatever the host broadcasts.
//
// Phones hold no game rules. They render the host's latest public view and
// send three things back: join, answer, wager. If the phone sleeps or loses
// signal, it rejoins with the same player id and the host re-sends the state.
(function () {
  'use strict';
  const { esc, store, uid, shape, LETTERS, avatar, fmt, signed, ordinal, getJSON } = window.PGN;
  const A = window.PGNAudio;
  const $ = (s) => document.querySelector(s);
  const main = $('#main');
  const SESSION_KEY = 'pgn:player';
  const SESSION_TTL = 24 * 60 * 60 * 1000;

  const P = {
    cfg: null,
    room: null,
    pid: null,
    name: null,
    rt: null,
    view: null,
    joined: false,
    viewKey: null,
    joinTimer: null,
    lastJoinSent: 0,
    answer: null, // {key, choice, sentAt, ms}
    qKey: null,
    qSeenAt: 0,
    deadline: 0,
    duration: 0,
    wager: null, // {amount, locked}
    resultKey: null,
    status: 'idle',
  };
  window.__pgnPlayer = P;

  const REASONS = {
    'name-taken': 'Someone in this room already has that name. Try another!',
    'name-required': 'Pick a nickname first.',
    full: 'That room is full (200 players max).',
    expired: 'That room has expired. Ask the host for a new code.',
    removed: 'The host removed you from this game.',
    'bad-request': 'Something went wrong. Try again?',
  };

  // ---------------------------------------------------------------- boot

  async function boot() {
    PGN.lights($('#lights'), 8);
    PGN.snow($('#snow'), { density: 0.00006 });
    A.bindButtons();
    try {
      P.cfg = await getJSON('/api/config');
    } catch (e) {
      P.cfg = { realtime: 'none' };
    }
    const params = new URLSearchParams(location.search);
    const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const s = store.get(SESSION_KEY, null);
    const fresh = s && Date.now() - s.at < SESSION_TTL;
    if (fresh && (!roomParam || roomParam === s.room)) {
      // Same phone, same room: slip straight back in (phone slept, tab reloaded…).
      P.room = s.room;
      P.pid = s.pid;
      P.name = s.name;
      showWaiting('Rejoining room ' + s.room + '…');
      connect(true);
    } else {
      showJoin(roomParam, s && s.name, '');
    }
    // Woken from sleep or back on Wi-Fi: the socket may be dead or stale.
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', (e) => e.persisted && wake());
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- join

  function showJoin(room, name, err) {
    P.viewKey = 'join';
    $('#top').hidden = true;
    main.innerHTML =
      '<div class="center"><div class="eyebrow">Christmas Party</div><h1>Game <em>Night</em></h1>' +
      '<p class="lede" style="margin-top:8px">Enter the code on the TV.</p></div>' +
      '<form id="joinForm" autocomplete="off" novalidate>' +
      '<label class="field"><span>Room code</span><input class="input code-input" id="roomIn" maxlength="4" inputmode="text" autocapitalize="characters" spellcheck="false" value="' + esc(room || '') + '" aria-label="Room code" required></label>' +
      '<label class="field"><span>Your nickname</span><input class="input name-input" id="nameIn" maxlength="14" autocapitalize="words" spellcheck="false" value="' + esc(name || '') + '" placeholder="e.g. Aunt Linda" required></label>' +
      '<div class="err" id="joinErr" role="alert">' + esc(err || '') + '</div>' +
      '<button class="btn primary big-btn" id="joinBtn" type="submit">Join the game</button>' +
      '</form><p class="center muted" style="font-size:13px">Only your nickname is shared, and it’s gone after the party.</p>';
    const roomIn = $('#roomIn');
    const nameIn = $('#nameIn');
    roomIn.addEventListener('input', () => {
      roomIn.value = roomIn.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (roomIn.value.length === 4 && !nameIn.value) nameIn.focus();
    });
    (room && room.length === 4 ? nameIn : roomIn).focus();
    $('#joinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      A.unlock();
      const r = roomIn.value.trim().toUpperCase();
      const n = nameIn.value.replace(/\s+/g, ' ').trim();
      if (r.length !== 4) return ($('#joinErr').textContent = 'Room codes are 4 letters.');
      if (!n) return ($('#joinErr').textContent = 'Pick a nickname.');
      const prev = store.get(SESSION_KEY, null);
      P.room = r;
      P.name = n;
      P.pid = prev && prev.room === r && Date.now() - prev.at < SESSION_TTL ? prev.pid : uid('p', 7);
      $('#joinBtn').disabled = true;
      $('#joinBtn').textContent = 'Joining…';
      connect(false);
    });
  }

  async function connect(rejoining) {
    if (P.cfg.realtime === 'none') return showJoin(P.room, P.name, 'This game server isn’t set up for phones yet (no realtime key).');
    if (P.rt) P.rt.close();
    P.joined = false;
    try {
      P.rt = await window.PGNRealtime.connect({
        mode: P.cfg.realtime,
        role: 'player',
        room: P.room,
        clientId: P.pid,
        onMessage,
        onStatus,
      });
    } catch (e) {
      return showJoin(P.room, P.name, 'Could not connect: ' + e.message);
    }
    clearTimeout(P.joinTimer);
    P.joinTimer = setTimeout(() => {
      if (P.joined) return;
      if (rejoining) {
        // The host may be reloading. Keep trying quietly.
        showWaiting('Looking for room ' + P.room + '… Is the TV still on?', true);
        P.joinTimer = setInterval(() => !P.joined && sendJoin(), 4000);
      } else {
        if (P.rt) P.rt.close();
        P.rt = null;
        showJoin(P.room, P.name, 'No game found with code ' + P.room + '. Check the TV and try again.');
      }
    }, 7000);
  }

  function onStatus(s) {
    P.status = s;
    $('#banner').hidden = !(s === 'reconnecting' && P.joined);
    if (s === 'connected' || s === 'resync') sendJoin();
  }

  function wake() {
    if (!P.room || !P.pid || P.viewKey === 'join' || P.viewKey === 'closed') return;
    if (!P.rt || !P.rt.alive()) {
      $('#banner').hidden = false;
      return connect(true);
    }
    sendJoin();
  }

  // "join" doubles as "hello, send me the state": the host treats a known
  // player id as a rejoin and re-broadcasts.
  function sendJoin() {
    if (!P.rt) return;
    P.lastJoinSent = Date.now();
    P.rt.publish('join', { pid: P.pid, name: P.name });
  }

  function leave() {
    if (P.rt) {
      P.rt.publish('leave', { pid: P.pid });
      setTimeout(() => P.rt && P.rt.close(), 300);
    }
    store.del(SESSION_KEY);
    P.joined = false;
    P.view = null;
    showJoin('', P.name, '');
  }

  // ---------------------------------------------------------------- messages

  function onMessage(name, data) {
    if (!data || typeof data !== 'object') return;
    if (name === 'joinResult') {
      if (data.pid !== P.pid) return;
      clearTimeout(P.joinTimer);
      clearInterval(P.joinTimer);
      if (data.ok) {
        markJoined();
      } else {
        P.joined = false;
        if (data.reason === 'removed') store.del(SESSION_KEY);
        if (P.rt) P.rt.close();
        P.rt = null;
        P.view = null;
        showJoin(data.reason === 'removed' ? '' : P.room, P.name, REASONS[data.reason] || 'Could not join.');
      }
      return;
    }
    if (name === 'closed') {
      store.del(SESSION_KEY);
      if (P.rt) P.rt.close();
      P.rt = null;
      P.joined = false;
      P.view = null;
      P.viewKey = 'closed';
      $('#top').hidden = true;
      main.innerHTML = '<div class="wait-art">🎁</div><h1 class="center">That’s a wrap!</h1><p class="lede center">' +
        (data.reason === 'expired' ? 'This room expired.' : 'The host closed the room.') + ' Thanks for playing.</p>' +
        '<button class="btn primary big-btn" id="againBtn">Join another game</button>';
      $('#againBtn').addEventListener('click', () => showJoin('', P.name, ''));
      return;
    }
    if (name === 'state') {
      if (data.room !== P.room) return;
      if (P.view && data.hostId === P.view.hostId && data.seq < P.view.seq) return; // stale
      onState(data);
    }
  }

  // The TV doesn't send a "welcome": seeing our own id in a broadcast is the
  // confirmation (one fewer message per join, times 200 phones).
  function markJoined() {
    clearTimeout(P.joinTimer);
    clearInterval(P.joinTimer);
    $('#banner').hidden = true;
    if (P.joined) return;
    P.joined = true;
    store.set(SESSION_KEY, { room: P.room, pid: P.pid, name: P.name, at: (store.get(SESSION_KEY, {}) || {}).at || Date.now() });
    A.sfx.tap();
    vibrate(30);
  }

  function onState(v) {
    P.view = v;
    const me = currentMe();
    if (me) markJoined();
    else if (P.joined && Date.now() - P.lastJoinSent > 3000) sendJoin(); // host lost us (e.g. it reloaded)
    if (!P.joined) return;
    if (v.pack && v.pack.theme) document.body.dataset.theme = v.pack.theme;

    // Countdown runs on this phone's own clock, from the time left when sent.
    P.deadline = performance.now() + (v.remainingMs || 0);
    P.duration = v.durationMs || 0;
    P.paused = v.paused;
    P.pausedLeft = v.remainingMs || 0;

    if (v.phase === 'question' && v.question) {
      if (v.question.key !== P.qKey) {
        P.qKey = v.question.key;
        P.qSeenAt = performance.now();
      }
      // Our answer didn't arrive? Send it again.
      if (P.answer && P.answer.key === P.qKey && me && !me.answered && P.answer.sentAt && Date.now() - P.answer.sentAt > 3500) sendAnswer();
    }
    if (v.phase === 'wager' && !P.wager) P.wager = { amount: 0, locked: false };
    if (v.phase !== 'wager' && v.phase !== 'question') P.wager = v.phase === 'reveal' ? P.wager : null;
    render(me);
  }

  // ---------------------------------------------------------------- actions

  function pick(i) {
    const v = P.view;
    if (!v || v.phase !== 'question' || v.paused) return;
    if (P.answer && P.answer.key === v.question.key) return;
    P.answer = { key: v.question.key, choice: i, ms: Math.round(performance.now() - P.qSeenAt), sentAt: 0 };
    // In a big room, spread the burst of taps over a few hundred ms so the
    // inbox channels stay under Ably's rate limit. The answer time was
    // measured at the tap, so the delay costs no points.
    const jitter = v.count > 20 ? Math.random() * 400 : 0;
    setTimeout(sendAnswer, jitter);
    A.sfx.tap();
    vibrate(20);
    render(currentMe());
  }

  function sendAnswer() {
    P.answer.sentAt = Date.now();
    P.rt.publish('answer', { pid: P.pid, qkey: P.answer.key, choice: P.answer.choice, ms: P.answer.ms });
  }

  function lockWager() {
    P.wager.locked = true;
    P.rt.publish('wager', { pid: P.pid, amount: P.wager.amount });
    A.sfx.tap();
    vibrate(20);
    render(currentMe());
  }

  // Our own row, unpacked from the compact scores map (see engine publicView).
  function currentMe() {
    const v = P.view;
    const a = v && v.scores ? v.scores[P.pid] : null;
    if (!a) return null;
    const me = { id: P.pid, name: P.name, score: a[0], rank: window.PGNPlace(v.scores, P.pid) };
    if (v.phase === 'question') me.answered = !!a[1];
    if (v.phase === 'wager') me.wagered = !!a[1];
    if (v.phase === 'reveal' && a.length >= 4) me.result = { points: a[1], choice: a[2] < 0 ? null : a[2], correct: !!a[3] };
    return me;
  }
  const vibrate = (ms) => navigator.vibrate && navigator.vibrate(ms);

  // ---------------------------------------------------------------- render

  function showWaiting(msg, withLeave) {
    P.viewKey = 'waiting:' + msg;
    main.innerHTML = '<div class="wait-art">🎄</div><p class="lede center">' + esc(msg) + '</p>' +
      (withLeave ? '<button class="btn ghost leave" id="leaveBtn">Join a different room</button>' : '');
    const b = $('#leaveBtn');
    if (b) b.addEventListener('click', leave);
  }

  function header(me) {
    const v = P.view;
    $('#top').hidden = false;
    $('#meAvatar').innerHTML = avatar(P.name, P.pid);
    $('#meName').textContent = P.name;
    $('#meSub').textContent = 'Room ' + P.room + ' · ' + v.count + ' playing';
    $('#meScore').textContent = me ? fmt(me.score) : '0';
    const started = v.phase !== 'lobby' || (me && me.score !== 0);
    $('#mePlace').textContent = me && started ? ordinal(me.rank) + ' of ' + v.count : 'pts';
  }

  function render(me) {
    const v = P.view;
    if (!v) return;
    header(me);
    const key = v.phase + ':' + (v.question && v.question.key ? v.question.key : '') + ':' + (v.round ? v.round.idx : '') + ':' + (v.pack ? v.pack.id : '') +
      ':' + (P.answer && v.question && P.answer.key === v.question.key ? 'a' : '') + ':' + (P.wager && P.wager.locked ? 'w' : '') + ':' + v.paused;
    if (key === P.viewKey && v.phase !== 'lobby') return;
    P.viewKey = key;
    const fn = VIEWS[v.phase];
    main.innerHTML = fn ? fn(v, me) : '';
    bind(v, me);
  }

  function timerBar() {
    return '<div class="p-timer" id="ptimer"><i></i></div>';
  }

  // Top N, plus our own row underneath if we're further down.
  function miniBoard(v, n) {
    const row = (p) =>
      '<div class="row' + (p.rank === 1 ? ' first' : '') + '"' + (p.id === P.pid ? ' style="border-color:var(--gold)"' : '') + '><span class="rank">' + p.rank + '</span>' + avatar(p.name, p.id) +
      '<span class="nm">' + esc(p.name) + '</span><span></span><span class="sc">' + fmt(p.score) + '</span></div>';
    const top = v.top.slice(0, n);
    const me = currentMe();
    let html = top.map(row).join('');
    if (me && !top.some((p) => p.id === P.pid)) html += '<div class="gap-dots">⋮</div>' + row(me);
    return '<div class="board mini-board">' + html + '</div>';
  }

  function placeCard(me, v) {
    if (!me) return '';
    return '<div class="place-card"><div><div class="k">Your place</div><div class="v">' + ordinal(me.rank) + ' <span>of ' + v.count + '</span></div></div>' +
      '<div><div class="k">Score</div><div class="v">' + fmt(me.score) + '</div></div></div>';
  }

  const VIEWS = {
    lobby(v) {
      if (!v.pack) return '<div class="wait-art">🎁</div><h1 class="center">You’re in!</h1><p class="lede center">The host is picking a question pack…</p>' + leaveBtn();
      return '<div class="wait-art">' + esc(v.pack.icon || '🎄') + '</div><h1 class="center">You’re in!</h1>' +
        '<p class="lede center">' + esc(v.pack.title) + (v.mode === 'sample' ? ' · free sample' : '') + '</p>' +
        '<p class="center muted">' + v.count + ' player' + (v.count === 1 ? '' : 's') + ' so far. Eyes on the TV: the host starts when everyone’s here.</p>' + leaveBtn();
    },
    roundIntro(v) {
      return '<div class="eyebrow center">' + (v.round.type === 'final' ? 'Final round' : 'Round ' + (v.round.idx + 1)) + '</div>' +
        '<div class="round-title">' + esc(v.round.title) + '</div><p class="lede center">' + esc(v.round.blurb) + '</p>' + timerBar();
    },
    question(v) {
      const q = v.question;
      const mine = P.answer && P.answer.key === q.key ? P.answer.choice : null;
      return timerBar() + '<div class="p-q">' + esc(q.text) + '</div>' +
        '<div class="p-answers' + (mine != null ? ' locked' : '') + '">' + q.choices.map((c, i) =>
          '<button class="p-ans c' + i + (mine === i ? ' mine' : '') + '" data-pick="' + i + '"' + (mine != null || v.paused ? ' disabled' : '') + '>' + shape(i) +
          '<span><span class="sr-only">' + LETTERS[i] + ': </span>' + esc(c) + '</span></button>').join('') + '</div>' +
        '<div class="lockin">' + (v.paused ? 'Paused by the host' : mine != null ? 'Locked in! Fingers crossed. 🤞' : v.round.type === 'speed' ? 'Fast! Wrong answers cost 250.' : v.round.type === 'final' ? 'Your wager rides on this one.' : 'Faster right answers score more.') + '</div>';
    },
    wager(v, me) {
      const score = me ? me.score : 0;
      const max = Math.max(1000, score);
      const w = P.wager || { amount: 0, locked: false };
      if (w.locked) {
        return '<div class="wager-box"><div class="eyebrow">Wager locked</div><div class="wager-amt">' + fmt(w.amount) + '</div>' +
          '<p class="lede">Category: <b>' + esc(v.question ? v.question.category : '') + '</b></p>' + timerBar() +
          '<button class="btn ghost big-btn" id="changeWager" style="margin-top:12px">Change my wager</button></div>';
      }
      return '<div class="wager-box"><div class="eyebrow">All-in finale · ' + esc(v.question ? v.question.category : '') + '</div>' +
        '<div class="muted">You have ' + fmt(score) + '. Bet up to ' + fmt(max) + '.</div>' +
        '<div class="wager-amt" id="wAmt">' + fmt(w.amount) + '</div>' +
        '<input type="range" class="range" id="wRange" min="0" max="' + max + '" step="50" value="' + Math.min(w.amount, max) + '" aria-label="Wager amount">' +
        '<div class="quick"><button class="btn" data-w="0">0</button><button class="btn" data-w="' + Math.round(max / 4 / 50) * 50 + '">¼</button><button class="btn" data-w="' + Math.round(max / 2 / 50) * 50 + '">½</button><button class="btn" data-w="' + max + '">All in</button></div>' +
        timerBar() + '<button class="btn primary big-btn" id="lockW">Lock in my wager</button></div>';
    },
    reveal(v, me) {
      const q = v.question;
      const res = me && me.result;
      if (q && P.resultKey !== q.key && res) {
        P.resultKey = q.key;
        if (res.correct) { A.sfx.correct(); vibrate([30, 40, 30]); } else { A.sfx.wrong(); vibrate(120); }
      }
      const right = q ? shape(q.correct) + ' ' + esc(q.choices[q.correct]) : '';
      let html;
      if (!res) html = '<div class="verdict none"><div class="big">Next one’s yours</div><div class="was">The answer: ' + right + '</div></div>';
      else if (res.correct) html = '<div class="verdict good"><div class="big">Correct!</div><div class="pts">' + signed(res.points) + '</div></div>';
      else if (res.choice == null && v.round.type !== 'final') html = '<div class="verdict none"><div class="big">Too slow!</div><div class="pts">' + (res.points ? signed(res.points) : '+0') + '</div><div class="was">It was ' + right + '</div></div>';
      else html = '<div class="verdict bad"><div class="big">Nope!</div><div class="pts">' + (res.points ? signed(res.points) : '+0') + '</div><div class="was">It was ' + right + '</div></div>';
      // The why behind the answer, so the game works with no TV in the room.
      if (q && q.reveal) {
        const refs = (q.refs || []).map((r) => '<span class="pill">' + esc(r.label) + ': ' + esc(r.ref) + '</span>').join('');
        html += '<div class="p-explain">' + esc(q.reveal) + (refs ? '<div class="refs">' + refs + '</div>' : '') + '</div>';
      }
      return html + placeCard(me, v);
    },
    standings(v, me) {
      return '<div class="eyebrow center">Standings</div>' + placeCard(me, v) + miniBoard(v, 5);
    },
    gameover(v, me) {
      const first = me && me.rank === 1;
      if (first && P.resultKey !== 'gameover') { P.resultKey = 'gameover'; A.sfx.fanfare(); vibrate([40, 60, 40, 60, 80]); }
      return '<div class="wait-art">' + (first ? '🏆' : '🎄') + '</div><h1 class="center">' +
        (me ? (first ? 'You won!' : 'You finished ' + ordinal(me.rank)) : 'Game over') + '</h1>' +
        placeCard(me, v) + miniBoard(v, 5) +
        '<p class="center muted">Stay here: the host can start another game.</p>' + leaveBtn();
    },
  };

  function leaveBtn() {
    return '<button class="btn ghost leave" id="leaveBtn">Leave game</button>';
  }

  function bind(v, me) {
    main.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.pick))));
    const lb = $('#leaveBtn');
    if (lb) lb.addEventListener('click', () => confirm('Leave this game?') && leave());
    const range = $('#wRange');
    if (range) {
      const setAmt = (n) => {
        P.wager.amount = Math.max(0, Math.min(Number(range.max), Math.round(n)));
        range.value = P.wager.amount;
        $('#wAmt').textContent = fmt(P.wager.amount);
      };
      range.addEventListener('input', () => setAmt(Number(range.value)));
      main.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => setAmt(Number(b.dataset.w))));
      $('#lockW').addEventListener('click', lockWager);
    }
    const cw = $('#changeWager');
    if (cw) cw.addEventListener('click', () => { P.wager.locked = false; render(currentMe()); });
  }

  function frame() {
    requestAnimationFrame(frame);
    const bar = document.querySelector('#ptimer i');
    if (!bar || !P.duration) return;
    const left = P.paused ? P.pausedLeft : Math.max(0, P.deadline - performance.now());
    const frac = Math.max(0, Math.min(1, left / P.duration));
    bar.style.transform = 'scaleX(' + frac + ')';
    bar.parentElement.classList.toggle('low', left < 5000);
  }

  boot();
})();
