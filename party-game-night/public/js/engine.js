// Party Game Night: the game engine.
//
// Pure game rules, no DOM and no network. The host's browser owns the one
// authoritative copy of the state and calls these functions; phones only ever
// see publicView(). The same file runs under Node for the tests.
//
// Time is always passed in (`now`, ms) so the rules are deterministic and the
// host can resume a game after a page reload from its saved deadlines.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PGNEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_PLAYERS = 200;
  // The TV leaderboard and the phones' mini-board show this many rows.
  const TOP_N = 10;
  const NAME_MAX = 14;
  const SAMPLE_SIZE = 5;
  // Answers that arrive this long after the buzzer still count: the phone
  // sent them in time and the network was slow.
  const GRACE_MS = 700;
  // Once everyone has answered, wait this long before revealing, so the last
  // tap gets a beat on screen instead of an instant cut.
  const ALL_IN_BEAT_MS = 1200;
  // A phone may report its own answer time (fairer on a laggy network), but
  // never more than this much faster than the host saw it.
  const CLIENT_TIME_SLACK_MS = 1500;

  const TIMING = {
    roundIntro: 6000,
    wager: 25000,
    reveal: 9000,
    speedReveal: 6500,
    standings: 8000,
  };

  const ROUND_TYPES = {
    classic: {
      title: 'Round One: Ho-Ho-Know-It-All',
      blurb: 'Four choices. Twenty seconds. Faster right answers score more, up to 1,000.',
      limitMs: 20000,
    },
    speed: {
      title: 'Round Two: The Sleigh Ride',
      blurb: 'Ten seconds a question. Speed pays big, and wrong answers cost 250. Guess wisely.',
      limitMs: 10000,
    },
    final: {
      title: 'The All-In Finale',
      blurb: 'One hard question. Bet any part of your score (the house spots you 1,000). Right doubles down, wrong pays up.',
      limitMs: 30000,
    },
    sample: {
      title: 'Free Sample Round',
      blurb: 'A taste of the pack. Four choices, twenty seconds, faster right answers score more.',
      limitMs: 20000,
    },
  };

  const LENGTHS = {
    // classic + speed + 1 all-in finale
    short: { label: 'Short', classic: 5, speed: 4, questions: 10, minutes: '~8 min' },
    long: { label: 'Long', classic: 10, speed: 9, questions: 20, minutes: '~16 min' },
  };

  const DIFF_ORDER = { easy: 0, medium: 1, hard: 2 };

  // ---------------------------------------------------------------- helpers

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function cleanName(raw) {
    return String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX);
  }

  const ROOM_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels: no accidental words
  function makeRoomCode(rng) {
    rng = rng || Math.random;
    let s = '';
    for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(rng() * ROOM_ALPHABET.length)];
    return s;
  }

  function round10(n) {
    return Math.round(n / 10) * 10;
  }

  function maxWager(score) {
    return Math.max(1000, score);
  }

  // Shuffle the choices so the JSON answer position tells nobody anything.
  function prepareQuestion(q, rng) {
    const order = shuffle(q.choices.map((_, i) => i), rng);
    return {
      id: q.id,
      difficulty: q.difficulty,
      category: q.category || null,
      text: q.q,
      choices: order.map((i) => q.choices[i]),
      correct: order.indexOf(q.answer),
      reveal: q.reveal || '',
      refs: Array.isArray(q.refs) ? q.refs : [],
    };
  }

  // ---------------------------------------------------------------- rounds

  /**
   * Build the rounds for a game.
   *   questions: the pack's questions (full pack, or just its sample)
   *   opts.mode: 'full' | 'sample'
   *   opts.length: 'short' (10 questions) | 'long' (20)
   *   opts.used: Set of question ids played recently (picked last)
   */
  function buildRounds(questions, opts) {
    const rng = opts.rng || Math.random;
    const used = opts.used || new Set();

    if (opts.mode === 'sample') {
      const sample = questions.filter((q) => q.sample);
      const pool = (sample.length ? sample : questions).slice(0, SAMPLE_SIZE);
      return [makeRound('sample', byDifficulty(pool), rng)];
    }

    const len = LENGTHS[opts.length] || LENGTHS.short;
    // Unused questions first, random within each group.
    let pool = shuffle(questions, rng).sort((a, b) => (used.has(a.id) ? 1 : 0) - (used.has(b.id) ? 1 : 0));

    function take(n, pred) {
      const out = [];
      for (const pass of [pred, () => true]) {
        for (let i = 0; i < pool.length && out.length < n; ) {
          if (pass(pool[i])) out.push(pool.splice(i, 1)[0]);
          else i++;
        }
      }
      return out;
    }

    const final = take(1, (q) => q.difficulty === 'hard');
    const speed = take(len.speed, (q) => q.difficulty !== 'hard');
    const classic = take(len.classic, () => true);

    return [
      makeRound('classic', byDifficulty(classic), rng),
      makeRound('speed', byDifficulty(speed), rng),
      makeRound('final', final, rng),
    ].filter((r) => r.questions.length);
  }

  function byDifficulty(qs) {
    return qs.slice().sort((a, b) => (DIFF_ORDER[a.difficulty] || 0) - (DIFF_ORDER[b.difficulty] || 0));
  }

  function makeRound(type, qs, rng) {
    const t = ROUND_TYPES[type];
    return {
      type,
      title: t.title,
      blurb: t.blurb,
      limitMs: t.limitMs,
      questions: qs.map((q) => prepareQuestion(q, rng)),
    };
  }

  // ---------------------------------------------------------------- state

  function createRoom(opts) {
    return {
      v: 1,
      room: opts.room,
      hostId: opts.hostId,
      createdAt: opts.now,
      seq: 1,
      phase: 'lobby',
      pack: null, // {id, title, collection, theme}
      mode: null,
      length: null,
      rounds: [],
      r: 0,
      q: 0,
      players: {},
      order: [],
      kicked: [],
      answers: {},
      results: null,
      wagers: {},
      prevRanks: {},
      phaseStartedAt: opts.now,
      phaseEndsAt: null,
      paused: false,
      pausedRemaining: null,
      line: null,
      gamesPlayed: 0,
    };
  }

  function isExpired(state, now) {
    return now - state.createdAt >= ROOM_TTL_MS;
  }

  /** Load a pack into the room and return to the lobby. Scores reset; players stay. */
  function setupGame(state, opts) {
    state.pack = opts.pack;
    state.mode = opts.mode;
    state.length = opts.length;
    state.rounds = opts.rounds;
    state.r = 0;
    state.q = 0;
    state.answers = {};
    state.results = null;
    state.wagers = {};
    state.prevRanks = {};
    for (const id of state.order) {
      const p = state.players[id];
      p.score = 0;
      p.streak = 0;
    }
    setPhase(state, 'lobby', opts.now, null);
    state.line = pickLine('lobby', state, opts.rng);
    return state;
  }

  /** Room stays open, pack cleared: phones show "host is picking a pack". */
  function clearPack(state, now) {
    state.pack = null;
    state.rounds = [];
    state.mode = null;
    setPhase(state, 'lobby', now, null);
    state.line = null;
  }

  function setPhase(state, phase, now, durationMs) {
    state.phase = phase;
    state.phaseStartedAt = now;
    state.phaseEndsAt = durationMs == null ? null : now + durationMs;
    state.paused = false;
    state.pausedAt = null;
    state.pausedRemaining = null;
    state.seq++;
  }

  function nameTaken(state, name, exceptId) {
    const n = name.toLowerCase();
    return state.order.some((id) => id !== exceptId && state.players[id].name.toLowerCase() === n);
  }

  /** Returns {ok, reason?, rejoined?}. Players may join late, mid-game, at zero. */
  function join(state, msg, now) {
    const pid = String(msg.pid || '').slice(0, 64);
    const name = cleanName(msg.name);
    if (!pid) return { ok: false, reason: 'bad-request' };
    if (isExpired(state, now)) return { ok: false, reason: 'expired' };
    if (state.kicked.includes(pid)) return { ok: false, reason: 'removed' };

    const existing = state.players[pid];
    if (existing) {
      if (name && name !== existing.name && !nameTaken(state, name, pid)) {
        existing.name = name;
        state.seq++;
      }
      return { ok: true, rejoined: true };
    }
    if (!name) return { ok: false, reason: 'name-required' };
    if (nameTaken(state, name)) return { ok: false, reason: 'name-taken' };
    if (state.order.length >= MAX_PLAYERS) return { ok: false, reason: 'full' };

    state.players[pid] = { name, score: 0, streak: 0, joinedAt: now };
    state.order.push(pid);
    state.seq++;
    return { ok: true };
  }

  /** Remove a player. ban=true (the host's ✕) keeps them out of this room. */
  function kick(state, pid, ban) {
    if (!state.players[pid]) return false;
    delete state.players[pid];
    state.order = state.order.filter((id) => id !== pid);
    delete state.answers[pid];
    delete state.wagers[pid];
    if (ban !== false && !state.kicked.includes(pid)) state.kicked.push(pid);
    state.seq++;
    return true;
  }

  function currentRound(state) {
    return state.rounds[state.r] || null;
  }

  function currentQuestion(state) {
    const round = currentRound(state);
    return round ? round.questions[state.q] || null : null;
  }

  function start(state, now, rng) {
    if (!state.pack || !state.rounds.length) return { ok: false, reason: 'no-pack' };
    if (!state.order.length) return { ok: false, reason: 'no-players' };
    if (state.phase !== 'lobby' && state.phase !== 'gameover') return { ok: false, reason: 'in-progress' };
    state.r = 0;
    state.q = 0;
    for (const id of state.order) {
      state.players[id].score = 0;
      state.players[id].streak = 0;
    }
    state.prevRanks = {};
    enterRoundIntro(state, now, rng);
    return { ok: true };
  }

  function enterRoundIntro(state, now, rng) {
    state.answers = {};
    state.results = null;
    state.wagers = {};
    setPhase(state, 'roundIntro', now, TIMING.roundIntro);
    state.line = pickLine('round:' + currentRound(state).type, state, rng);
  }

  function enterQuestion(state, now, rng) {
    state.answers = {};
    state.results = null;
    setPhase(state, 'question', now, currentRound(state).limitMs);
    state.line = pickLine('question', state, rng);
  }

  function answer(state, msg, now) {
    if (state.phase !== 'question' || state.paused) return false;
    const pid = msg.pid;
    if (!state.players[pid] || state.answers[pid]) return false;
    // A stale answer from a previous question must not land on this one.
    if (msg.qkey !== questionKey(state)) return false;
    if (now > state.phaseEndsAt + GRACE_MS) return false;
    const q = currentQuestion(state);
    const choice = Number(msg.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) return false;

    const hostMs = now - state.phaseStartedAt;
    let ms = hostMs;
    const clientMs = Number(msg.ms);
    if (Number.isFinite(clientMs)) ms = Math.min(hostMs, Math.max(clientMs, hostMs - CLIENT_TIME_SLACK_MS));
    ms = Math.max(0, ms);

    state.answers[pid] = { choice, ms };
    state.seq++;
    if (Object.keys(state.answers).length >= state.order.length) {
      state.phaseEndsAt = Math.min(state.phaseEndsAt, now + ALL_IN_BEAT_MS);
    }
    return true;
  }

  function wager(state, msg, now) {
    if (state.phase !== 'wager' || state.paused) return false;
    const p = state.players[msg.pid];
    if (!p) return false;
    const amt = Math.round(Number(msg.amount));
    if (!Number.isFinite(amt)) return false;
    state.wagers[msg.pid] = Math.min(maxWager(p.score), Math.max(0, amt));
    state.seq++;
    if (Object.keys(state.wagers).length >= state.order.length) {
      state.phaseEndsAt = Math.min(state.phaseEndsAt, now + ALL_IN_BEAT_MS);
    }
    return true;
  }

  function questionKey(state) {
    const q = currentQuestion(state);
    return q ? state.r + ':' + state.q + ':' + q.id : null;
  }

  function scoreFor(roundType, limitMs, ans, correct, wagerAmt) {
    if (roundType === 'final') return correct ? wagerAmt : -wagerAmt;
    if (!ans) return 0;
    const frac = Math.min(1, Math.max(0, 1 - ans.ms / limitMs));
    if (roundType === 'speed') return correct ? round10(250 + 750 * frac) : -250;
    return correct ? round10(500 + 500 * frac) : 0;
  }

  function ranks(state) {
    const sorted = state.order.slice().sort((a, b) => {
      const d = state.players[b].score - state.players[a].score;
      return d || state.players[a].joinedAt - state.players[b].joinedAt;
    });
    const out = {};
    let prevScore = null;
    let prevRank = 0;
    sorted.forEach((id, i) => {
      const s = state.players[id].score;
      const rank = s === prevScore ? prevRank : i + 1;
      out[id] = rank;
      prevScore = s;
      prevRank = rank;
    });
    return { sorted, rank: out };
  }

  function closeQuestion(state, now, rng) {
    const round = currentRound(state);
    const q = currentQuestion(state);
    // Rank arrows mean nothing while everyone is still tied (e.g. the first question).
    const tied = new Set(state.order.map((id) => state.players[id].score)).size <= 1;
    state.prevRanks = tied ? {} : ranks(state).rank;
    const results = {};
    let right = 0;
    for (const id of state.order) {
      const ans = state.answers[id] || null;
      const correct = !!ans && ans.choice === q.correct;
      const w = state.wagers[id] || 0;
      const pts = scoreFor(round.type, round.limitMs, ans, correct, w);
      const p = state.players[id];
      p.score += pts;
      p.streak = correct ? (p.streak || 0) + 1 : 0;
      if (correct) right++;
      results[id] = { choice: ans ? ans.choice : null, correct, points: pts, ms: ans ? ans.ms : null };
    }
    state.results = results;
    const dur = round.type === 'speed' ? TIMING.speedReveal : TIMING.reveal;
    setPhase(state, 'reveal', now, dur);
    const n = state.order.length;
    state.line = pickLine(right === 0 ? 'reveal:none' : right === n && n > 1 ? 'reveal:all' : 'reveal', state, rng);
  }

  /** Move to the next phase. The timer calls this; so does the host's Next button. */
  function advance(state, now, rng) {
    const round = currentRound(state);
    switch (state.phase) {
      case 'roundIntro':
        if (round.type === 'final') {
          setPhase(state, 'wager', now, TIMING.wager);
          state.line = pickLine('wager', state, rng);
        } else {
          state.q = 0;
          enterQuestion(state, now, rng);
        }
        return true;
      case 'wager':
        state.q = 0;
        enterQuestion(state, now, rng);
        return true;
      case 'question':
        closeQuestion(state, now, rng);
        return true;
      case 'reveal':
        if (state.q + 1 < round.questions.length) {
          state.q++;
          enterQuestion(state, now, rng);
        } else if (state.r + 1 < state.rounds.length) {
          state.prevRanks = ranks(state).rank;
          setPhase(state, 'standings', now, TIMING.standings);
          state.line = pickLine('standings', state, rng);
        } else {
          finish(state, now, rng);
        }
        return true;
      case 'standings':
        state.r++;
        state.q = 0;
        enterRoundIntro(state, now, rng);
        return true;
      default:
        return false;
    }
  }

  function finish(state, now, rng) {
    setPhase(state, 'gameover', now, null);
    state.gamesPlayed = (state.gamesPlayed || 0) + 1;
    state.line = pickLine(state.mode === 'sample' ? 'gameover:sample' : 'gameover', state, rng);
  }

  /** Called a few times a second by the host. Returns true if anything changed. */
  function tick(state, now, rng) {
    if (state.paused || state.phaseEndsAt == null) return false;
    if (now < state.phaseEndsAt) return false;
    return advance(state, now, rng);
  }

  function pause(state, now) {
    if (state.paused || state.phaseEndsAt == null) return false;
    state.paused = true;
    state.pausedAt = now;
    state.pausedRemaining = Math.max(0, state.phaseEndsAt - now);
    state.seq++;
    return true;
  }

  function resume(state, now) {
    if (!state.paused) return false;
    // Slide the whole phase forward by the time spent paused, so the clock
    // and answer speeds pick up exactly where they stopped.
    const d = Math.max(0, now - state.pausedAt);
    state.phaseStartedAt += d;
    state.phaseEndsAt += d;
    state.paused = false;
    state.pausedAt = null;
    state.pausedRemaining = null;
    state.seq++;
    return true;
  }

  // ---------------------------------------------------------------- view

  /**
   * What gets broadcast to every phone. The correct answer only appears once
   * the question has closed.
   *
   * Sized for 200 players: Ably bills in 5 KiB chunks and delivers each
   * broadcast to every phone, so the view carries full rows (names) only for
   * the top TOP_N, plus one tiny array per player under `scores`:
   *   question: [score, answered 0|1]
   *   wager:    [score, wagered 0|1]
   *   reveal:   [score, points, choice (-1 = none), correct 0|1]
   *   other:    [score]
   * A phone finds its own entry by player id and works out its place as
   * 1 + (number of higher scores), the same tie rule the TV uses.
   */
  function publicView(state, now) {
    const round = currentRound(state);
    const q = currentQuestion(state);
    const rk = ranks(state);
    const inQ = state.phase === 'question' || state.phase === 'reveal';

    const top = rk.sorted.slice(0, TOP_N).map((id) => {
      const p = state.players[id];
      return { id, name: p.name, score: p.score, rank: rk.rank[id], prevRank: state.prevRanks[id] || null };
    });

    const scores = {};
    for (const id of state.order) {
      const sc = state.players[id].score;
      if (state.phase === 'question') scores[id] = [sc, state.answers[id] ? 1 : 0];
      else if (state.phase === 'wager') scores[id] = [sc, state.wagers[id] != null ? 1 : 0];
      else if (state.phase === 'reveal' && state.results && state.results[id]) {
        const r = state.results[id];
        scores[id] = [sc, r.points, r.choice == null ? -1 : r.choice, r.correct ? 1 : 0];
      } else scores[id] = [sc];
    }

    let remainingMs = null;
    if (state.paused) remainingMs = state.pausedRemaining;
    else if (state.phaseEndsAt != null) remainingMs = Math.max(0, state.phaseEndsAt - now);

    const view = {
      room: state.room,
      hostId: state.hostId,
      seq: state.seq,
      phase: state.phase,
      paused: state.paused,
      remainingMs,
      durationMs: state.phaseEndsAt != null ? state.phaseEndsAt - state.phaseStartedAt : null,
      pack: state.pack ? { id: state.pack.id, title: state.pack.title, icon: state.pack.icon, theme: state.pack.theme } : null,
      mode: state.mode,
      count: state.order.length,
      top,
      scores,
      round: round && state.phase !== 'lobby' && state.phase !== 'gameover'
        ? { idx: state.r, count: state.rounds.length, type: round.type, title: round.title, blurb: round.blurb }
        : null,
      question: null,
    };

    if (state.phase === 'wager' && q) {
      view.question = { category: q.category || state.pack.title, difficulty: q.difficulty };
    }
    if (inQ && q) {
      view.question = { key: questionKey(state), text: q.text, choices: q.choices };
      if (state.phase === 'reveal') {
        view.question.correct = q.correct;
        // The explanation goes to phones too, so a game works with no TV at all.
        view.question.reveal = q.reveal;
        view.question.refs = q.refs;
      }
    }
    return view;
  }

  /** A phone's place, from the scores map: 1 + how many scored higher. */
  function placeOf(scores, pid) {
    const mine = scores[pid];
    if (!mine) return null;
    let higher = 0;
    for (const k in scores) if (scores[k][0] > mine[0]) higher++;
    return higher + 1;
  }

  // ---------------------------------------------------------------- the host's voice

  const LINES = {
    lobby: [
      "Grab your phones. Yes, the ones you've been pretending not to look at all night.",
      'Join now. Late arrivals will be judged, silently, by the whole room.',
      "Phones out, egg nog down. Well. Down-ish.",
    ],
    'round:classic': [
      "Let's warm up. Four answers, one is right, and the clock is not your friend.",
      'Round one. Answer fast, answer right, and try to look humble about it.',
    ],
    'round:sample': [
      "Free sample! Like the cheese cubes at the store, except you have to think.",
    ],
    'round:speed': [
      "The Sleigh Ride! Ten seconds. Wrong answers cost you. Hesitation costs you more.",
      'Speed round. If you overthink, the reindeer leave without you.',
    ],
    'round:final': [
      "All in. One question. Bet big, bet small, or bet like your uncle at the white elephant swap.",
      "The finale. This is where friendships are tested and leads evaporate.",
    ],
    wager: [
      'Place your wagers. Remember: confidence is not the same thing as knowledge.',
      "How sure are you? Put a number on it. A number you can live with.",
    ],
    question: [null],
    reveal: [
      'And the answer is...',
      "Let's see who was paying attention.",
      'Drumroll, please. Somebody find a drum.',
    ],
    'reveal:all': [
      'Everybody got it! Fine. Too easy. Noted.',
      'A clean sweep. Merry Christmas to all of you, I suppose.',
    ],
    'reveal:none': [
      'Nobody. Not one of you. The silence is deafening.',
      'Zero for everybody! Santa is updating the list as we speak.',
    ],
    standings: [
      "Here's how the sleigh is loaded so far.",
      'Halftime standings. Some of you should be worried.',
    ],
    gameover: [
      'That is a wrap! Somebody get our champion a candy cane.',
      'Game over! Winners: be gracious. Everyone else: there is always next year.',
    ],
    'gameover:sample': [
      'That was the free sample! Unlock the full pack for the speed round and the all-in finale.',
    ],
  };

  function pickLine(kind, state, rng) {
    const list = LINES[kind] || [];
    if (!list.length) return null;
    return list[Math.floor((rng || Math.random)() * list.length)];
  }

  return {
    ROOM_TTL_MS,
    MAX_PLAYERS,
    TOP_N,
    placeOf,
    NAME_MAX,
    TIMING,
    ROUND_TYPES,
    LENGTHS,
    shuffle,
    cleanName,
    makeRoomCode,
    maxWager,
    buildRounds,
    prepareQuestion,
    createRoom,
    isExpired,
    setupGame,
    clearPack,
    join,
    kick,
    start,
    answer,
    wager,
    advance,
    tick,
    pause,
    resume,
    ranks,
    scoreFor,
    questionKey,
    currentRound,
    currentQuestion,
    publicView,
  };
});
