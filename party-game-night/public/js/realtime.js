// One small interface over two transports:
//   ably  - production (Vercel): Ably's hosted WebSockets
//   local - `npm run dev`: the dev server's in-memory relay
//
//   const rt = await PGNRealtime.connect({ mode, role, room, clientId, onMessage, onStatus })
//
// Channels, sized for 200 phones. Ably bills every delivered copy, so phones
// never hear each other:
//   pgn:ROOM        the TV broadcasts here; every phone listens
//   pgn:ROOM:in0-7  phones send joins/answers/wagers here; only the TV
//                   listens. Eight of them, picked by player id, so 200
//                   near-simultaneous answers (about 25 per channel) stay
//                   under Ably's per-channel rate limit (50 msg/s).
//   rt.publish(name, data)
//   rt.close()
//
// onStatus gets 'connected' | 'reconnecting' | 'resync' | 'failed'. 'resync'
// means "you may have missed messages": the phone asks the host for the
// current state, and the host re-broadcasts it.

(function () {
  'use strict';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  const SHARDS = 8;
  // Must match api/ably-token.js, which grants each phone its one inbox.
  function shardOf(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % SHARDS;
  }

  async function connectAbly(o) {
    if (!window.Ably) await loadScript('/vendor/ably.min.js');
    const client = new window.Ably.Realtime({
      authUrl: '/api/ably-token',
      authParams: { clientId: o.clientId, room: o.room },
      clientId: o.clientId,
      echoMessages: false,
    });
    const isHost = o.role === 'host';
    const broadcast = client.channels.get('pgn:' + o.room);
    const inboxes = Array.from({ length: SHARDS }, (_, i) => client.channels.get('pgn:' + o.room + ':in' + i));
    const outbox = isHost ? broadcast : inboxes[shardOf(o.clientId)];
    let everConnected = false;

    client.connection.on((change) => {
      const s = change.current;
      if (s === 'connected') {
        o.onStatus(everConnected ? 'resync' : 'connected');
        everConnected = true;
      } else if (s === 'disconnected' || s === 'suspended' || s === 'connecting') {
        if (everConnected) o.onStatus('reconnecting');
      } else if (s === 'failed') {
        o.onStatus('failed');
      }
    });
    // A re-attach that couldn't resume means messages may have been missed.
    broadcast.on('attached', (change) => {
      if (change && change.resumed === false && everConnected) o.onStatus('resync');
    });

    const handler = (msg) => o.onMessage(msg.name, msg.data, msg.clientId);
    // The TV listens to the broadcast channel too: that's how it spots
    // another TV already using a room code.
    const listen = isHost ? [broadcast].concat(inboxes) : [broadcast];
    await Promise.all(listen.map((ch) => ch.subscribe(handler)));

    function publish(name, data, attempt) {
      return outbox.publish(name, data).catch((e) => {
        // Rate-limited or mid-reconnect: back off a little and try again.
        if ((attempt || 0) < 3) return new Promise((r) => setTimeout(r, 300 + Math.random() * 700)).then(() => publish(name, data, (attempt || 0) + 1));
        console.warn('publish failed', e);
      });
    }

    return {
      publish,
      close() {
        client.close();
      },
      alive() {
        return ['connected', 'connecting', 'disconnected'].includes(client.connection.state);
      },
    };
  }

  function connectLocal(o) {
    let es = null;
    let everConnected = false;
    let closed = false;
    const base = '/relay/' + o.room;

    function open() {
      es = new EventSource(base + '/stream?cid=' + encodeURIComponent(o.clientId));
      es.onopen = () => {
        o.onStatus(everConnected ? 'resync' : 'connected');
        everConnected = true;
      };
      es.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        o.onMessage(m.name, m.data, m.clientId);
      };
      es.onerror = () => {
        if (closed) return;
        if (everConnected) o.onStatus('reconnecting');
        // EventSource retries by itself while the server is reachable; if the
        // browser gave up (CLOSED), start a fresh one.
        if (es.readyState === EventSource.CLOSED) setTimeout(() => !closed && open(), 1500);
      };
    }
    open();

    return new Promise((resolve) => {
      const api = {
        publish(name, data) {
          return fetch(base + '/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data, clientId: o.clientId, role: o.role }),
            keepalive: true,
          }).catch(() => {});
        },
        close() {
          closed = true;
          if (es) es.close();
        },
        alive() {
          return !closed && !!es && es.readyState !== EventSource.CLOSED;
        },
      };
      resolve(api);
    });
  }

  async function connect(o) {
    if (o.mode === 'ably') return connectAbly(o);
    if (o.mode === 'local') return connectLocal(o);
    throw new Error('Realtime is not configured on this server (set ABLY_API_KEY in Vercel).');
  }

  window.PGNRealtime = { connect, shardOf };
})();
