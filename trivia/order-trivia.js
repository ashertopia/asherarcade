/* Trivia section of order.html: school/party colors with a live preview, and
 * the 20-question builder (pick a sample question or write your own).
 * Answers are saved on the customer's device as they type, so a long form
 * survives a closed tab. Needs trivia/theme.js and trivia/sample-questions.js.
 *
 *   var t = TriviaOrder.mount(container, { nameInput, occasionInput });
 *   t.collect() -> { error } or { details, game }
 *   t.clearDraft()
 */
(function (root) {
  'use strict';
  var COUNT = 20;
  var DRAFT_KEY = 'aa-trivia-order-draft';
  var SWATCHES = [
    ['Black', '#111111'], ['White', '#ffffff'], ['Red', '#c8102e'], ['Maroon', '#7a0019'],
    ['Orange', '#ff7a00'], ['Yellow', '#ffd200'], ['Gold', '#c5a100'], ['Green', '#00843d'],
    ['Teal', '#008080'], ['Light blue', '#4b9cd3'], ['Blue', '#0047ab'], ['Navy', '#0b1f4b'],
    ['Purple', '#5b2a86'], ['Pink', '#ff69b4'], ['Gray', '#8a8d8f']
  ];
  var OCCASION_KEYS = {
    'Graduation': 'graduation', 'Birthday': 'birthday', 'Wedding or engagement': 'wedding',
    'Baby or bridal shower': 'shower', 'Anniversary': 'anniversary', 'Retirement': 'retirement',
    'Something else': 'custom'
  };
  var CSS = '' +
    '.tq-colors{display:grid;grid-template-columns:1fr 1fr;gap:16px;}' +
    '@media(max-width:600px){.tq-colors{grid-template-columns:1fr;}}' +
    '.tq-sw{display:flex;flex-wrap:wrap;gap:7px;margin-top:4px;}' +
    '.tq-sw button{width:34px;height:34px;border:2px solid var(--rule);cursor:pointer;padding:0;position:relative;}' +
    '.tq-sw button[aria-pressed=true]{outline:3px solid var(--ink);outline-offset:2px;}' +
    '.tq-sw label.tq-custom{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:0;cursor:pointer;}' +
    '.tq-sw input[type=color]{width:34px;height:34px;border:2px solid var(--rule);padding:0;background:none;cursor:pointer;}' +
    '.tq-picked{font-size:13.5px;color:var(--ink-soft);margin:6px 0 0;}' +
    '.tq-preview{margin-top:14px;padding:18px 16px;border-radius:14px;text-align:center;color:#fff;max-width:340px;}' +
    '.tq-preview .e{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:4px 10px;border-radius:99px;background:rgba(0,0,0,.28);}' +
    '.tq-preview .t{font-weight:900;font-size:20px;line-height:1.1;margin:8px 0 10px;}' +
    '.tq-preview .b{display:block;border-radius:10px;padding:10px;font-weight:900;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1a1033;}' +
    '.tq-preview .tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;}' +
    '.tq-preview .tiles span{border-radius:8px;padding:9px 4px;font-size:12px;font-weight:800;}' +
    '.tq-progress{position:sticky;top:76px;z-index:5;background:var(--paper);border:2px solid var(--ink);padding:10px 14px;font-weight:600;font-size:14px;display:flex;justify-content:space-between;gap:10px;}' +
    '.tq-progress i{display:block;height:6px;background:var(--paper-3);margin-top:6px;}' +
    '.tq-progress i b{display:block;height:100%;width:0;background:var(--ochre);transition:width .3s;}' +
    '.tq-q{border:1px solid var(--rule);background:var(--paper-2);padding:14px;margin-top:12px;}' +
    '.tq-q.done{border-color:#7aa36b;box-shadow:inset 4px 0 0 #7aa36b;}' +
    '.tq-q.bad{border-color:var(--bad);box-shadow:inset 4px 0 0 var(--bad);}' +
    '.tq-tips{background:var(--paper-2);border-left:4px solid var(--ochre);padding:10px 14px;font-size:14px;margin:0 0 12px;}' +
    '.tq-tips ul{margin:6px 0 0;padding-left:18px;}' + '.tq-tips li{margin:4px 0;}' + '.tq-tips span{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:0 2px 0 6px;}' +
    '.tq-long{font-size:12.5px;color:var(--ochre-deep);margin:4px 0 0;}' +
    '.tq-q h4{margin:0 0 8px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);display:flex;justify-content:space-between;}' +
    '.tq-q .tq-wrong{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}' +
    '@media(max-width:600px){.tq-q .tq-wrong{grid-template-columns:1fr;}}' +
    '.tq-q .tq-row{margin-top:8px;}' +
    '.tq-q .tq-row > span{display:block;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:4px;}' +
    '.tq-q .tq-right input{border-color:#7aa36b !important;background:#eef6ea !important;}' +
    '.oform .tq-q input[type=text],.oform .tq-q select{padding:10px 11px;font-size:15px;background:var(--paper);}';

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }

  function mount(box, opts) {
    if (!document.getElementById('tq-css')) { var st = el('style', { id: 'tq-css' }); st.textContent = CSS; document.head.appendChild(st); }
    var saved = load() || {};
    var state = {
      primary: saved.primary || '#0b1f4b',
      secondary: saved.secondary || '#ffd200',
      qs: []
    };
    for (var i = 0; i < COUNT; i++) {
      var s = (saved.qs || [])[i] || {};
      state.qs.push({ q: s.q || '', right: s.right || '', wrong: (s.wrong || ['', '', '']).slice(0, 3), fact: s.fact || '', tpl: s.tpl || '', filled: s.filled || '' });
    }
    if (saved.honoree && opts.nameInput && !opts.nameInput.value) opts.nameInput.value = saved.honoree;
    if (saved.occasion && opts.occasionInput && !opts.occasionInput.value) opts.occasionInput.value = saved.occasion;

    function first() { return ((opts.nameInput && opts.nameInput.value) || '').trim().split(/\s+/)[0] || ''; }
    function occasion() { return OCCASION_KEYS[opts.occasionInput && opts.occasionInput.value] || 'custom'; }
    function save() {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          primary: state.primary, secondary: state.secondary, qs: state.qs,
          honoree: opts.nameInput ? opts.nameInput.value : '', occasion: opts.occasionInput ? opts.occasionInput.value : ''
        }));
      } catch (e) {}
    }

    /* ---------- colors ---------- */
    var colors = el('div');
    colors.innerHTML =
      '<span class="lbl">Colors <span class="req">*</span></span>' +
      '<p class="hint" style="margin:0 0 10px">School colors, team colors or party colors. Pick two. We fine-tune the shades so every word stays easy to read.</p>' +
      '<div class="tq-colors">' + ['primary', 'secondary'].map(function (k) {
        return '<div><span class="lbl" style="margin:0">' + (k === 'primary' ? 'Main color' : 'Second color') + '</span>' +
          '<div class="tq-sw" data-k="' + k + '">' +
          SWATCHES.map(function (s) { return '<button type="button" title="' + s[0] + '" aria-label="' + s[0] + '" data-c="' + s[1] + '" style="background:' + s[1] + '"></button>'; }).join('') +
          '<label class="tq-custom">Other <input type="color" data-k="' + k + '"></label></div>' +
          '<p class="tq-picked" id="tq-picked-' + k + '"></p></div>';
      }).join('') + '</div>' +
      '<div class="tq-preview" id="tq-preview" aria-label="Preview of your colors"><span class="e">Preview</span>' +
      '<div class="t" id="tq-pv-title"></div><span class="b" id="tq-pv-btn">Let\'s play</span>' +
      '<div class="tiles"><span style="background:#e21b3c">Answer</span><span style="background:#1368ce">Answer</span>' +
      '<span style="background:#d89e00;color:#1a1033">Answer</span><span style="background:#26890c">Answer</span></div></div>';
    box.appendChild(colors);

    function nameOf(hex) {
      for (var i = 0; i < SWATCHES.length; i++) if (SWATCHES[i][1].toLowerCase() === hex.toLowerCase()) return SWATCHES[i][0];
      return hex.toUpperCase();
    }
    function paintColors() {
      ['primary', 'secondary'].forEach(function (k) {
        colors.querySelectorAll('.tq-sw[data-k=' + k + '] button').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-c').toLowerCase() === state[k].toLowerCase()));
        });
        colors.querySelector('input[type=color][data-k=' + k + ']').value = state[k];
        document.getElementById('tq-picked-' + k).textContent = nameOf(state[k]);
      });
      var t = root.TriviaTheme.makeTheme(state.primary, state.secondary);
      var pv = document.getElementById('tq-preview');
      pv.style.background = 'radial-gradient(ellipse at 50% -10%,' + t.bg2 + ' 0%,' + t.bg1 + ' 75%)';
      pv.querySelector('.e').style.color = t.accent;
      document.getElementById('tq-pv-btn').style.background = t.accent;
      document.getElementById('tq-pv-title').textContent = 'How Well Do You Know ' + (first() || 'Them') + '?';
    }
    colors.addEventListener('click', function (e) {
      var b = e.target.closest('.tq-sw button'); if (!b) return;
      state[b.parentNode.getAttribute('data-k')] = b.getAttribute('data-c'); paintColors(); save();
    });
    colors.addEventListener('input', function (e) {
      if (e.target.type !== 'color') return;
      state[e.target.getAttribute('data-k')] = e.target.value; paintColors(); save();
    });

    /* ---------- questions ---------- */
    var qwrap = el('div');
    qwrap.innerHTML =
      '<span class="lbl">Your 20 questions <span class="req">*</span></span>' +
      '<p class="hint" style="margin:0 0 8px">Pick a sample question or write your own, then type the right answer. Wrong answers are optional: leave them blank and we will write believable ones for you. The story is optional too. It shows after everyone answers, and it is where the laughs are. Your answers save on this device as you go.</p>' +
      '<div class="tq-tips"><b>Keep answers to 3 words or less</b> so they fit on the buttons. For example:' +
      '<ul><li>What was Maya\'s first car? <span>Right:</span> Blue minivan <span>Wrong:</span> Red pickup, Silver sedan, Riding mower</li>' +
      '<li>What does Maya always order at a coffee shop? <span>Right:</span> Hot chocolate <span>Wrong:</span> Iced latte, Chai tea</li>' +
      '<li>How many times did Maya take the driving test? <span>Right:</span> Twice <span>Wrong:</span> leave blank</li></ul></div>' +
      '<div class="tq-progress"><div style="flex:1"><span id="tq-count">0 of 20 done</span><i><b id="tq-bar"></b></i></div></div>';
    var list = el('div');
    qwrap.appendChild(list);
    box.appendChild(qwrap);

    function sampleOptions(current) {
      var f = first(), html = '<option value="">Pick a sample question or write your own</option>';
      root.TriviaSamples.groupsFor(occasion()).forEach(function (g) {
        html += '<optgroup label="' + esc(g.group) + '">' + g.questions.map(function (q) {
          var text = root.TriviaSamples.fill(q, f);
          return '<option value="' + esc(q) + '"' + (text === current ? ' selected' : '') + '>' + esc(text) + '</option>';
        }).join('') + '</optgroup>';
      });
      return html + '<option value="__own">Write my own question</option>';
    }
    function renderQs() {
      list.textContent = '';
      state.qs.forEach(function (q, i) {
        var c = el('div', { 'class': 'tq-q', 'data-i': i });
        c.innerHTML =
          '<h4><span>Question ' + (i + 1) + '</span><span class="tq-st"></span></h4>' +
          '<select class="tq-sample" aria-label="Sample questions for question ' + (i + 1) + '">' + sampleOptions(q.q) + '</select>' +
          '<div class="tq-row"><span>Question</span><input type="text" class="tq-text" maxlength="140" placeholder="Type your question"></div>' +
          '<div class="tq-row tq-right"><span>Right answer (3 words or less)</span><input type="text" class="tq-ans" data-w="-1" maxlength="60" placeholder="The correct answer"></div>' +
          '<div class="tq-row"><span>Wrong answers (optional, leave blank and we write them)</span><div class="tq-wrong">' +
          [0, 1, 2].map(function (w) { return '<input type="text" class="tq-ans" data-w="' + w + '" maxlength="60" placeholder="Wrong answer ' + (w + 1) + ' (optional)">'; }).join('') +
          '</div></div>' +
          '<p class="tq-long" hidden>Tip: 3 words or less fits best on the buttons.</p>' +
          '<div class="tq-row"><span>The story (optional)</span><input type="text" class="tq-fact" maxlength="200" placeholder="Shown after they answer. e.g. She cried when it got towed."></div>';
        c.querySelector('.tq-text').value = q.q;
        c.querySelector('.tq-ans[data-w="-1"]').value = q.right;
        [0, 1, 2].forEach(function (w) { c.querySelector('.tq-ans[data-w="' + w + '"]').value = q.wrong[w] || ''; });
        c.querySelector('.tq-fact').value = q.fact;
        list.appendChild(c);
      });
      progress();
    }
    function given(q) { return q.wrong.map(function (w) { return w.trim(); }).filter(Boolean); }
    function complete(q) {
      if (!q.q.trim() || !q.right.trim()) return false;
      var all = [q.right.trim()].concat(given(q)).map(function (a) { return a.toLowerCase(); });
      return all.every(function (a, i) { return all.indexOf(a) === i; });
    }
    function tooLong(q) { return [q.right].concat(q.wrong).some(function (a) { return a.trim().split(/\s+/).length > 3; }); }
    function progress() {
      var n = 0;
      state.qs.forEach(function (q, i) {
        var ok = complete(q); if (ok) n++;
        var card = list.children[i]; if (!card) return;
        card.classList.toggle('done', ok);
        if (ok) card.classList.remove('bad');
        card.querySelector('.tq-st').textContent = ok ? 'Done' : '';
        card.querySelector('.tq-long').hidden = !tooLong(q);
      });
      document.getElementById('tq-count').textContent = n + ' of ' + COUNT + ' done';
      document.getElementById('tq-bar').style.width = (n / COUNT * 100) + '%';
    }
    list.addEventListener('change', function (e) {
      if (!e.target.classList.contains('tq-sample')) return;
      var card = e.target.closest('.tq-q'), q = state.qs[+card.getAttribute('data-i')];
      var v = e.target.value, input = card.querySelector('.tq-text');
      if (v === '__own') { input.value = ''; q.q = ''; input.focus(); }
      else if (v) { q.tpl = v; q.q = root.TriviaSamples.fill(v, first()); q.filled = q.q; input.value = q.q; card.querySelector('.tq-ans[data-w="-1"]').focus(); }
      progress(); save();
    });
    list.addEventListener('input', function (e) {
      var card = e.target.closest('.tq-q'); if (!card) return;
      var q = state.qs[+card.getAttribute('data-i')];
      if (e.target.classList.contains('tq-text')) q.q = e.target.value;
      else if (e.target.classList.contains('tq-fact')) q.fact = e.target.value;
      else if (e.target.classList.contains('tq-ans')) {
        var w = +e.target.getAttribute('data-w');
        if (w < 0) q.right = e.target.value; else q.wrong[w] = e.target.value;
      }
      progress(); save();
    });

    function refreshNames() {
      paintColors();
      list.querySelectorAll('.tq-q').forEach(function (card) {
        var q = state.qs[+card.getAttribute('data-i')];
        // A sample question picked before the name was typed follows the new name,
        // unless the customer has since edited the wording.
        if (q.tpl && q.q === q.filled) {
          q.q = q.filled = root.TriviaSamples.fill(q.tpl, first());
          card.querySelector('.tq-text').value = q.q;
        }
        card.querySelector('.tq-sample').innerHTML = sampleOptions(q.q);
      });
      save();
    }
    if (opts.nameInput) opts.nameInput.addEventListener('change', refreshNames);
    if (opts.nameInput) opts.nameInput.addEventListener('input', function () { paintColors(); save(); });
    if (opts.occasionInput) opts.occasionInput.addEventListener('change', refreshNames);

    paintColors();
    renderQs();

    return {
      collect: function () {
        var bad = [];
        state.qs.forEach(function (q, i) {
          var ok = complete(q);
          list.children[i].classList.toggle('bad', !ok);
          if (!ok) bad.push(i + 1);
        });
        if (bad.length) {
          var firstBad = list.children[bad[0] - 1];
          setTimeout(function () { firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
          return { error: bad.length === COUNT ? 'Please add your 20 questions.'
            : 'Questions ' + bad.join(', ') + ' still need a question and a right answer (and no answer typed twice).' };
        }
        var honoree = ((opts.nameInput && opts.nameInput.value) || '').trim();
        var details = { 'Main color': nameOf(state.primary) + ' ' + state.primary, 'Second color': nameOf(state.secondary) + ' ' + state.secondary };
        var questions = state.qs.map(function (q, i) {
          // Studio's "Paste questions" format: question, *right, wrong answers, > story
          // Wrong answers the customer gave come first, in order; the rest are ours to write.
          var g = given(q), need = 3 - g.length;
          details['Q' + (i + 1)] = [q.q.trim(), '*' + q.right.trim()].concat(g)
            .concat(need ? ['(we write ' + need + ' wrong answer' + (need > 1 ? 's' : '') + ')'] : [])
            .concat(q.fact.trim() ? ['> ' + q.fact.trim()] : []).join('\n');
          var item = { q: q.q.trim(), answers: [q.right.trim()].concat(g), correct: 0 };
          if (need) item.wrongNeeded = need;
          if (q.fact.trim()) item.fact = q.fact.trim();
          return item;
        });
        var game = {
          title: 'How Well Do You Know ' + (first() || 'Them') + '?',
          honoree: honoree, occasion: occasion(),
          theme: { primary: state.primary, secondary: state.secondary },
          secondsPerQuestion: 20, shuffleAnswers: true, questions: questions
        };
        return { details: details, game: game };
      },
      clearDraft: function () { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
    };
  }

  root.TriviaOrder = { mount: mount };
})(this);
