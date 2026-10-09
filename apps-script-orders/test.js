// Photo upload checks for Code.gs against fake Apps Script services. Run: node apps-script-orders/test.js
const vm = require('vm'), fs = require('fs');
const props = {}; const files = []; const warns = []; const mails = [];
const ctx = {
  console: { log(){}, error(m){ warns.push('E ' + m); }, warn(m){ warns.push(m); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
  Utilities: { base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(x => x > 127 ? x - 256 : x), newBlob: (b, m, n) => ({ n }) },
  DriveApp: { getFolderById: () => ({ createFile: (a) => files.push(a.n || a) }) },
  MimeType: { PLAIN_TEXT: 'text' }, Session: { getEffectiveUser: () => ({ getEmail: () => 'o@x' }) },
  MailApp: { sendEmail: (...a) => mails.push(a[1]) },
  ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: {} },
};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), ctx);
const id = 'AA-261009-AB12'; props['o_' + id] = JSON.stringify({ f: 'F', k: 'tok', t: Date.now(), n: 0 });
const jpg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(20)]).toString('base64');
const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }));
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
ok(post({ action: 'photo', id, token: 'bad', data: jpg }).error === 'unknown order', 'bad token rejected');
ok(post({ action: 'photo', id, token: 'tok', data: '' }).error === 'empty file', 'empty file named');
ok(post({ action: 'photo', id, token: 'tok', data: Buffer.from('hello world!!').toString('base64') }).error === 'unsupported file', 'non-image rejected');
ok(JSON.parse(props['o_' + id]).n === 0, 'failed tries do not use up the count');
const r = post({ action: 'photo', id, token: 'tok', label: 'face', filename: 'me.jpg', data: jpg });
ok(r.ok && r.n === 1 && files[0] === 'face - me.jpg', 'jpeg saved and counted');
ok(warns.filter(w => /photo rejected/.test(w)).length === 3, 'rejections logged');
ok(post({ action: 'photo-missing', id, token: 'tok', count: 1, reason: 'x.jpg: network' }).ok && /PHOTO MISSING/.test(files[1]) && mails.length === 1, 'missing photo flagged in folder + email');
