// One small interface over two transports:
//   ably  - production (Vercel): Ably's hosted WebSockets
//   local - `npm run dev`: the dev server's in-memory relay
//
//   const rt = await PGNRealtime.connect({ mode, room, clientId, onMessage, onStatus })
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

  async function connectAbly(o) {
    if (!window.Ably) await loadScript('/vendor/ably.min.js');
    const client = new window.Ably.Realtime({
      authUrl: '/api/ably-token',
      authParams: { clientId: o.clientId, room: o.room },
      clientId: o.clientId,
      echoMessages: false,
    });
    const channel = client.channels.get('pgn:' + o.room);
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
    channel.on('attached', (change) => {
      if (change && change.resumed === false && everConnected) o.onStatus('resync');
    });

    await channel.subscribe((msg) => o.onMessage(msg.name, msg.data, msg.clientId));

    return {
      publish(name, data) {
        return channel.publish(name, data).catch((e) => console.warn('publish failed', e));
      },
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
            body: JSON.stringify({ name, data, clientId: o.clientId }),
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

  window.PGNRealtime = { connect };
})();
