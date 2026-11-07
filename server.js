// Bağımlılıksız sunucu: statik dosyalar + WebSocket oda sistemi.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = require('./rules.js');
const PUB = __dirname, OK = ['/index.html', '/rules.js'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const server = http.createServer((q, s) => {
  try {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (!OK.includes(p)) return s.writeHead(404).end('404');
    const f = path.join(PUB, p);
    if (!f.startsWith(PUB)) return s.writeHead(403).end();
    fs.readFile(f, (e, d) => {
      if (e) return s.writeHead(404).end('404');
      s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      s.end(d);
    });
  } catch { s.writeHead(400).end(); }
});

// ---- Minimal WebSocket ----
function send(c, o) {
  if (c.sock.destroyed) return;
  const p = Buffer.from(JSON.stringify(o)), n = p.length;
  c.sock.write(Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), p]));
}
function parse(c) {
  const b = c.buf;
  if (b.length < 2) return null;
  let len = b[1] & 127, o = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); o = 4; }
  else if (len === 127) { c.sock.destroy(); return null; }
  const masked = b[1] & 128;
  if (masked) o += 4;
  if (b.length < o + len) return null;
  const pl = Buffer.from(b.subarray(o, o + len));
  if (masked) for (let i = 0; i < len; i++) pl[i] ^= b[o - 4 + (i % 4)];
  c.buf = b.subarray(o + len);
  return { op: b[0] & 15, pl };
}
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const c = { sock, buf: Buffer.alloc(0), room: null, color: null };
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    let f;
    while ((f = parse(c))) {
      if (f.op === 8) return sock.end();
      if (f.op === 9) sock.write(Buffer.concat([Buffer.from([0x8a, f.pl.length]), f.pl]));
      if (f.op === 1) { try { handle(c, JSON.parse(f.pl.toString())); } catch {} }
    }
  });
  sock.on('close', () => leave(c));
  sock.on('error', () => sock.destroy());
});

// ---- Oyun odaları ----
const rooms = {};
const newCode = () => {
  let s;
  do s = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
  while (rooms[s]);
  return s;
};
const begin = rm => {
  rm.board = R.init(); rm.turn = 'b'; rm.over = false; rm.draw = null; rm.again = new Set();
  rm.p.forEach(c => send(c, { t: 'start', color: c.color, board: rm.board, turn: 'b' }));
};
const finish = (rm, winner) => { rm.over = true; rm.p.forEach(c => send(c, { t: 'end', winner })); };
const okPt = a => Array.isArray(a) && a.length === 2 && a.every(n => Number.isInteger(n) && n >= 0 && n < 6);

function handle(c, m) {
  const rm = rooms[c.room], opp = rm && rm.p.find(x => x !== c);
  switch (m.t) {
    case 'create':
      if (c.room) return;
      c.room = newCode(); rooms[c.room] = { p: [c] };
      return send(c, { t: 'room', code: c.room });
    case 'join': {
      if (c.room) return;
      const k = String(m.code || '').toUpperCase().trim(), r = rooms[k];
      if (!r || r.p.length > 1) return send(c, { t: 'err', m: 'Oda bulunamadı ya da dolu.' });
      c.room = k; r.p.push(c);
      const f = Math.random() < 0.5;
      r.p[0].color = f ? 'b' : 'w'; r.p[1].color = f ? 'w' : 'b';
      return begin(r);
    }
    case 'move': {
      if (!rm || rm.over || !opp || c.color !== rm.turn || !okPt(m.from) || !okPt(m.to)) return;
      if (rm.board[m.from[0]][m.from[1]] !== c.color) return;
      const mv = R.moves(rm.board, m.from[0], m.from[1]).find(x => x.to[0] === m.to[0] && x.to[1] === m.to[1]);
      if (!mv) return;
      rm.board = R.apply(rm.board, m.from, m.to);
      rm.turn = rm.turn === 'b' ? 'w' : 'b'; rm.draw = null;
      const winner = R.count(rm.board, rm.turn) === 0 ? c.color : null;
      if (winner) rm.over = true;
      return rm.p.forEach(x => send(x, { t: 'move', from: m.from, to: m.to, cap: mv.cap, turn: rm.turn, winner }));
    }
    case 'resign': if (rm && !rm.over && opp) return finish(rm, opp.color); return;
    case 'draw': if (rm && !rm.over && opp) { rm.draw = c.color; send(opp, { t: 'draw' }); } return;
    case 'drawYes': if (rm && !rm.over && rm.draw && rm.draw !== c.color) finish(rm, 'draw'); return;
    case 'drawNo': if (rm && rm.draw && opp) { rm.draw = null; send(opp, { t: 'drawNo' }); } return;
    case 'again':
      if (!rm || !rm.over || rm.p.length < 2) return;
      rm.again.add(c);
      if (rm.again.size === 2) { rm.p.forEach(x => (x.color = x.color === 'b' ? 'w' : 'b')); begin(rm); }
  }
}
function leave(c) {
  const rm = rooms[c.room];
  if (!rm) return;
  delete rooms[c.room];
  rm.p.filter(x => x !== c).forEach(x => { x.room = null; send(x, { t: 'left' }); });
}

server.listen(process.env.PORT || 3000, () => console.log('Sürakarta hazır: http://localhost:' + (process.env.PORT || 3000)));
