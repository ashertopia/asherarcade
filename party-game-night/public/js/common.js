// Shared helpers for the host and phone pages: escaping, storage, shapes,
// avatars, lights, snow, confetti, toasts.
(function () {
  'use strict';

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const store = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    },
  };

  function uid(prefix) {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return (prefix || '') + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  }

  // A shape per answer, so colour is never the only cue.
  const SHAPES = [
    '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M11 2h2v5.3l3.1-2.2 1.2 1.6L13 9.8V11h1.2l3.1-4.3 1.6 1.2L16.7 11H22v2h-5.3l2.2 3.1-1.6 1.2L13 13v1.2l4.3 3.1-1.2 1.6L13 16.7V22h-2v-5.3l-3.1 2.2-1.2-1.6L11 14.2V13H9.8l-3.1 4.3-1.6-1.2L7.3 13H2v-2h5.3L5.1 7.9l1.6-1.2L11 11V9.8L6.7 6.7l1.2-1.6L11 7.3z"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 2l9 10-9 10-9-10z"/></svg>',
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/></svg>',
  ];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const shape = (i) => '<span class="shape" aria-hidden="true">' + SHAPES[i % 4] + '</span>';

  const AV_COLORS = ['#c63d33', '#2a8a5f', '#d39a2c', '#3b86b8', '#8e5bd1', '#d0567f', '#3aa6a0', '#b7652b', '#5a7bd8', '#7a9a2e'];
  function avatar(name, id) {
    let h = 0;
    for (const ch of String(id || name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const initial = (String(name || '?').trim()[0] || '?').toUpperCase();
    return '<span class="avatar" style="background:' + AV_COLORS[h % AV_COLORS.length] + '">' + esc(initial) + '</span>';
  }

  const fmt = (n) => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  function lights(el, count) {
    if (!el) return;
    const n = count || Math.max(10, Math.round(window.innerWidth / 70));
    let html = '<svg preserveAspectRatio="none" viewBox="0 0 100 44"><path d="M0 6 ' +
      Array.from({ length: n }, (_, i) => 'Q ' + ((i + 0.5) * 100) / n + ' 22 ' + ((i + 1) * 100) / n + ' 6').join(' ') +
      '" fill="none" stroke="#25362f" stroke-width="0.6" vector-effect="non-scaling-stroke"/></svg>';
    for (let i = 0; i < n; i++) {
      const left = ((i + 0.5) * 100) / n;
      html += '<span class="bulb c' + (i % 4) + '" style="left:calc(' + left + '% - 5px);top:13px;animation-delay:' + ((i * 0.37) % 3).toFixed(2) + 's"></span>';
    }
    el.innerHTML = html;
  }

  function snow(canvas, opts) {
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    const density = (opts && opts.density) || 0.00009;
    let w, h, flakes;
    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const count = Math.min(220, Math.round(window.innerWidth * window.innerHeight * density));
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 2.2 + 0.6) * dpr,
        s: (Math.random() * 0.6 + 0.25) * dpr, d: Math.random() * Math.PI * 2, o: Math.random() * 0.5 + 0.35,
      }));
    }
    resize();
    window.addEventListener('resize', resize);
    let last = performance.now();
    function frame(t) {
      const dt = Math.min(50, t - last) / 16.7;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.d += 0.01 * dt;
        f.y += f.s * dt;
        f.x += Math.sin(f.d) * 0.35 * dt;
        if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,' + f.o + ')';
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function confetti(canvas, ms) {
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const colors = ['#f2c46d', '#d0453a', '#2e8a62', '#fbf3e4', '#8fc9e8'];
    const bits = Array.from({ length: 180 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
    }));
    const end = performance.now() + (ms || 4500);
    function frame(t) {
      ctx.clearRect(0, 0, W, H);
      for (const b of bits) {
        b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (t < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  let toastTimer = null;
  function toast(msg, ms) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3200);
  }

  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || 'Request failed (' + r.status + ')'), { status: r.status, body });
    return body;
  }

  window.PGN = { esc, store, uid, shape, LETTERS, avatar, fmt, signed, ordinal, lights, snow, confetti, toast, getJSON };
})();
