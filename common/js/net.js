// Transport, the same way Nomic does it: a public MQTT broker over websockets. The screen and
// every phone connect to the broker; nothing connects to anything else, so it works from any
// network. The screen publishes the table (retained, so a phone that joins late gets it at once);
// phones publish their moves.
//
// One room code is one party, whatever game it is playing: every table goes out on the same topic
// and says which game it is, so the phones can follow the screen from game to game.
//
// There are secrets at these tables, so hands and moves are sealed (seal.js). What is public is
// what everyone at the table can see anyway.

import { shared, seal, open } from './seal.js';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
export const topic = (code, leaf) => `party/v1/${code.toUpperCase()}/${leaf}`;
const rid = () => Math.random().toString(36).slice(2, 10);
const parse = (buf) => { try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); } catch { return null; } };
const opts = (extra = {}) => ({ clientId: 'party-' + rid(), clean: true, connectTimeout: 8000, reconnectPeriod: 2000, keepalive: 30, ...extra });
const mqttConnect = (url, o) => globalThis.mqtt.connect(url, o);

// The screen. Tries the brokers in order and uses the first that connects.
//   game:    which game this table is (the phones open that game's page)
//   actions: the moves a phone may make; the screen's own controls never come over the wire
//   keys:    the screen's key pair (seal.js makeKeys), kept for the whole party
//   known:   { id: { pub, seq } } for phones that already said hello, kept for the whole party
export function hostRoom(code, { game, actions, keys, known, onAction, onLeave, connect = mqttConnect, brokers = BROKERS }) {
  const allowed = new Set(actions);
  const phones = new Map(Object.entries(known || {}));   // id -> { pub, seq }
  const sharedKeys = new Map();                         // id -> Promise<CryptoKey>
  const keyFor = (id) => { if (!sharedKeys.has(id)) sharedKeys.set(id, shared(keys, phones.get(id).pub)); return sharedKeys.get(id); };
  const hostId = rid();               // changes on every screen load; phones introduce themselves again when they see a new one
  let client = null, latest = null, sending = Promise.resolve(), inbox = Promise.resolve(), leaving = false;
  const events = [];

  const handle = async (msg) => {
    if (leaving) return;
    if (msg.type === 'hello') {
      if (typeof msg.id !== 'string' || typeof msg.pub !== 'string') return;
      if (!phones.has(msg.id)) phones.set(msg.id, { pub: msg.pub, seq: 0 });
      if (phones.get(msg.id).pub !== msg.pub) return;        // someone else already sits under that id
      onAction({ type: 'join', id: msg.id, name: msg.name });
      if (latest) publish(latest);                           // so they get their hand even if nothing changed
      return;
    }
    if (msg.type === 'leave') { if (phones.has(msg.id)) onLeave(msg.id); return; }
    if (msg.type !== 'act' || !phones.has(msg.id) || !msg.box) return;
    const a = await open(await keyFor(msg.id), msg.box);
    const p = phones.get(msg.id);
    if (!a || !allowed.has(a.type) || !(a.seq > p.seq)) return;   // not theirs, or a replay
    p.seq = a.seq;
    // Only the screen may deal by itself or stack the deal: those fields never come from a phone.
    const { seq, byScreen, deck, first, at, ...action } = a;
    onAction({ ...action, id: msg.id });
  };

  const ready = new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= brokers.length) return reject(new Error('no-broker'));
      const url = brokers[i++];
      const c = connect(url, opts({ reconnectPeriod: 0 }));
      const giveUp = setTimeout(() => { c.end(true); tryNext(); }, 9000);
      c.on('connect', () => {
        clearTimeout(giveUp);
        c.end(true);
        client = connect(url, opts());          // reconnect for real, with auto-reconnect on
        for (const ev of ['connect', 'reconnect', 'close', 'offline', 'error']) client.on(ev, (e) => events.push(`${Date.now() % 100000} ${ev} ${e?.message || ''}`));
        client.on('connect', () => { client.subscribe(topic(code, 'host'), { qos: 1 }); if (latest && !leaving) publish(latest); });
        client.on('message', (t, buf) => { const msg = parse(buf); if (msg && typeof msg === 'object') inbox = inbox.then(() => handle(msg)).catch(e => console.error(e)); });   // one at a time, in order
        resolve(url);
      });
      c.on('error', () => { clearTimeout(giveUp); c.end(true); tryNext(); });
    };
    tryNext();
  });

  // view: what everyone sees; secret: { id: what only that phone sees }. Sealing is async, so
  // publishes queue up in order.
  const publish = (next) => {
    latest = next;
    sending = sending.then(async () => {
      if (latest !== next || leaving) return;                // a newer table is already queued
      const sealed = {};
      for (const [id, data] of Object.entries(next.secret || {})) if (phones.has(id)) sealed[id] = await seal(await keyFor(id), data);
      const msg = { ...next.view, game, sealed, hostId, hostPub: keys.pub, stamp: Date.now() };
      if (client?.connected) client.publish(topic(code, 'state'), JSON.stringify(msg), { qos: 0, retain: true });
      events.push(`${Date.now() % 100000} publish ${client?.connected ? 'ok' : 'SKIPPED'} ${next.view.phase}`);
    }).catch(e => console.error(e));
    return sending;
  };

  // The screen is going back to the game list. Tell the phones (they wait, then follow the next
  // game), and don't wipe the table on the way out. Resolves once the broker has it, or after a
  // moment either way.
  const leaveTo = (players) => {
    leaving = true;
    const msg = JSON.stringify({ game: 'menu', phase: 'menu', code: code.toUpperCase(), players, hostId, hostPub: keys.pub, stamp: Date.now() });
    return new Promise((resolve) => {
      const done = setTimeout(resolve, 1500);
      if (!client?.connected) { clearTimeout(done); return resolve(); }
      client.publish(topic(code, 'state'), msg, { qos: 1, retain: true }, () => { clearTimeout(done); resolve(); });
    });
  };
  const close = () => { if (leaving) return; try { client?.publish(topic(code, 'state'), '', { retain: true }); } catch {} };
  if (globalThis.addEventListener) globalThis.addEventListener('pagehide', close);
  const end = () => { close(); client?.end(true); };
  return { ready, publish, leaveTo, close, end, known: () => Object.fromEntries(phones), events };
}

// The game list ended the party ("New party"). Tell any phone still waiting on the old code, on
// every broker, since the list doesn't know which one the phones settled on.
export function announceEnd(code, { connect = mqttConnect, brokers = BROKERS } = {}) {
  const msg = JSON.stringify({ game: 'ended', phase: 'ended', code: code.toUpperCase(), players: [], stamp: Date.now() });
  return Promise.all(brokers.map(url => new Promise((resolve) => {
    let c;
    const done = () => { clearTimeout(t); try { c?.end(true); } catch {} resolve(); };
    const t = setTimeout(done, 4000);
    try {
      c = connect(url, opts({ reconnectPeriod: 0 }));
      c.on('connect', () => c.publish(topic(code, 'state'), msg, { qos: 1, retain: true }, done));
      c.on('error', done);
    } catch { done(); }
  })));
}

// A phone. Listens on every broker for the room's table and settles on whichever has it.
//   keys: this phone's key pair, kept across reloads
//   onState(view, secret): secret is null if the screen hasn't dealt this phone in
export function joinRoom(code, { id, name, keys, onState, onStatus, connect = mqttConnect, brokers = BROKERS }) {
  let chosen = null, closed = false, hostId = null, hostPub = null, key = null, lastHello = 0, seq = 0, inbox = Promise.resolve();
  const clients = new Map();
  onStatus('connecting');
  const hello = () => { lastHello = Date.now(); chosen?.publish(topic(code, 'host'), JSON.stringify({ type: 'hello', id, name, pub: keys.pub }), { qos: 1 }); };
  // A hello that isn't urgent: at most one every few seconds, so two screens left open on the same
  // code can't set off an endless back-and-forth of hellos and tables.
  let soon = null;
  const helloSoon = () => { if (!soon) soon = setTimeout(() => { soon = null; if (!closed) hello(); }, Math.max(0, 3000 - (Date.now() - lastHello))); };

  const onTable = async (c, s) => {
    if (!chosen) {
      chosen = c;
      for (const [u, other] of clients) if (other !== c) { other.end(true); clients.delete(u); }
      onStatus('open'); hello();
    }
    if (c !== chosen) return;
    if (s.hostId !== hostId) { const first = hostId === null; hostId = s.hostId; if (!first) helloSoon(); }   // a reloaded screen
    if (typeof s.hostPub === 'string' && s.hostPub !== hostPub) { hostPub = s.hostPub; key = await shared(keys, hostPub); }
    const me = s.players.find(p => p.id === id);
    // Not at the table in the lobby, or shown as away: say hello again (a dropped message, or a stray "leave").
    // While the screen is on the game list there is nobody to say it to.
    if (s.phase !== 'menu' && !s.banned?.includes(id) && (s.phase === 'lobby' || s.phase === 'over' ? !me : me && !me.connected)) helloSoon();
    const secret = s.sealed?.[id] ? await open(key, s.sealed[id]) : null;
    onState(s, secret);
  };

  for (const url of brokers) {
    const c = connect(url, opts({ will: { topic: topic(code, 'host'), payload: JSON.stringify({ type: 'leave', id }), qos: 1 } }));
    clients.set(url, c);
    c.on('connect', () => { if (!chosen) c.subscribe(topic(code, 'state'), { qos: 0 }); else if (c === chosen) { onStatus('open'); hello(); } });
    c.on('message', (t, buf) => {
      const s = parse(buf); if (!s || typeof s !== 'object' || !s.phase || !Array.isArray(s.players)) return;
      if (s.stamp && Date.now() - s.stamp > 3 * 3600e3) return;      // a room someone left open hours ago
      inbox = inbox.then(() => onTable(c, s)).catch(e => console.error(e));   // in order, or an older table could land last
    });
    c.on('reconnect', () => chosen === c && onStatus('closed'));
    c.on('error', (e) => onStatus('error', e?.message));
    c.on('close', () => chosen === c && !closed && onStatus('closed'));
  }
  const noRoom = setTimeout(() => { if (!chosen && !closed) onStatus('no-room'); }, 7000);
  return {
    async send(action) {
      if (!chosen?.connected || !key) return false;
      seq = Math.max(seq + 1, Date.now() * 1000);            // always rising, even across reloads and games
      chosen.publish(topic(code, 'host'), JSON.stringify({ type: 'act', id, box: await seal(key, { ...action, seq }) }), { qos: 1 });
      return true;
    },
    close() {
      closed = true; clearTimeout(noRoom); clearTimeout(soon);
      try { chosen?.publish(topic(code, 'host'), JSON.stringify({ type: 'leave', id }), { qos: 1 }); } catch {}
      for (const c of clients.values()) c.end(true);
    },
    // Going to another game's page: hang up cleanly, so the broker doesn't announce that we left.
    quietClose() {
      closed = true; clearTimeout(noRoom); clearTimeout(soon);
      return Promise.race([
        Promise.all([...clients.values()].map(c => new Promise(r => { try { c.end(false, {}, r); } catch { r(); } }))),
        new Promise(r => setTimeout(r, 800)),
      ]);
    },
  };
}
