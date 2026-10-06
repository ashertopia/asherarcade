#!/usr/bin/env node
// Local development server: no accounts, no internet needed.
//
//   npm run dev            -> http://localhost:3000
//
// It does three things:
//  1. serves public/ the way Vercel does (clean URLs: /host -> host.html)
//  2. runs the api/*.js functions
//  3. stands in for Ably with a tiny in-memory relay (Server-Sent Events down,
//     POST up), so phones on your Wi-Fi can join without an Ably key.
//
// Phones need your computer's LAN address, which this prints on start-up and
// hands to the host page so the QR code points somewhere a phone can reach.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

// A fixed dev secret so `npm run make-code` codes work locally. Production
// uses whatever UNLOCK_SECRET is set in Vercel.
process.env.UNLOCK_SECRET = process.env.UNLOCK_SECRET || 'dev-only-secret';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}
const LAN = lanAddress();
const joinOrigin = process.env.PUBLIC_ORIGIN || (LAN ? 'http://' + LAN + ':' + PORT : null);

// ------------------------------------------------------------- relay
// rooms: code -> Map(clientId -> res)
const rooms = new Map();

function relayStream(req, res, room, clientId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  if (!rooms.has(room)) rooms.set(room, new Map());
  const members = rooms.get(room);
  const prev = members.get(clientId);
  if (prev) prev.end();
  members.set(clientId, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    if (members.get(clientId) === res) members.delete(clientId);
    if (!members.size) rooms.delete(room);
  });
}

async function relayPublish(req, res, room) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let msg;
  try {
    msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    res.writeHead(400).end();
    return;
  }
  const members = rooms.get(room);
  const line = 'data: ' + JSON.stringify({ name: msg.name, data: msg.data, clientId: msg.clientId }) + '\n\n';
  if (members) {
    // Same routing as the Ably channels: the TV's messages reach everyone,
    // a phone's messages reach only TVs. Nobody hears their own messages.
    const fromHost = msg.role === 'host';
    for (const [id, r] of members) {
      if (id === msg.clientId) continue;
      if (fromHost || id.startsWith('host-')) r.write(line);
    }
  }
  res.writeHead(204).end();
}

// ------------------------------------------------------------- api
const apiCache = {};
function apiHandler(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const file = path.join(ROOT, 'api', name + '.js');
  if (!fs.existsSync(file)) return null;
  return (apiCache[name] = apiCache[name] || require(file));
}

// ------------------------------------------------------------- static
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    let m;
    if ((m = p.match(/^\/relay\/([A-Z]{4})\/stream$/)) && req.method === 'GET') {
      return relayStream(req, res, m[1], String(url.searchParams.get('cid') || ''));
    }
    if ((m = p.match(/^\/relay\/([A-Z]{4})\/publish$/)) && req.method === 'POST') {
      return await relayPublish(req, res, m[1]);
    }
    if (p === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ realtime: 'local', checkout: false, joinOrigin, dev: true }));
    }
    if ((m = p.match(/^\/api\/([a-z0-9-]+)$/))) {
      const h = apiHandler(m[1]);
      if (!h) return res.writeHead(404).end();
      return await h(req, res);
    }
    serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  const { packs, errors } = require('./lib/packs').loadAll();
  const { mint } = require('./lib/codes');
  console.log('\n  Christmas Party Game Night (dev)');
  console.log('  Host (TV):     http://localhost:' + PORT + '/host');
  if (joinOrigin) console.log('  Phones join:   ' + joinOrigin + '/play');
  console.log('  Packs loaded:  ' + packs.map((p) => p.id).join(', '));
  if (errors.length) console.log('  Pack errors:   ' + errors.length + ' (see above)');
  console.log('  Dev unlock code (all packs): ' + mint('all', process.env.UNLOCK_SECRET, 'DEV1') + '\n');
});
