// Transport, the same way Nomic does it: a public MQTT broker over websockets. The screen and
// every phone connect to the broker; nothing connects to anything else, so it works from any
// network. The screen publishes the table (retained, so a phone that joins late gets it at once);
// phones publish their moves.
//
// Unlike Nomic, there are secrets at this table, so hands and moves are sealed (seal.js). What is
// public is what everyone at the table can see anyway: names, card counts, the pile size, the
// claim, and the cards turned over when someone calls.

import { shared, seal, open } from './seal.js';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
const topic = (code, leaf) => `bluff/v1/${code.toUpperCase()}/${leaf}`;
const rid = () => Math.random().toString(36).slice(2, 10);
const parse = (buf) => { try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); } catch { return null; } };
const opts = (extra = {}) => ({ clientId: 'bluff-' + rid(), clean: true, connectTimeout: 8000, reconnectPeriod: 2000, keepalive: 30, ...extra });
const mqttConnect = (url, o) => globalThis.mqtt.connect(url, o);

// Moves a phone may make. The screen's own controls (skip, remove, timers) never come over the wire.
const PLAYER_ACTIONS = new Set(['start', 'play', 'pass', 'call']);

// The screen. Tries the brokers in order and uses the first that connects.
//   keys:   the screen's key pair (seal.js makeKeys), kept across reloads
//   known:  { id: { pub, seq } } for phones that already said hello, kept across reloads
export function hostRoom(code, { keys, known, onAction, onLeave, connect = mqttConnect, brokers = BROKERS }) {
  const phones = new Map(Object.entries(known || {}));   // id -> { pub, seq }
  const sharedKeys = new Map();                         // id -> Promise<CryptoKey>
  const keyFor = (id) => { if (!sharedKeys.has(id)) sharedKeys.set(id, shared(keys, phones.get(id).pub)); return sharedKeys.get(id); };
  const hostId = rid();               // changes on every screen load; phones introduce themselves again when they see a new one
  let client = null, latest = null, sending = Promise.resolve(), inbox = Promise.resolve();
  const events = [];

  const handle = async (msg) => {
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
    if (!a || !PLAYER_ACTIONS.has(a.type) || !(a.seq > p.seq)) return;   // not theirs, or a replay
    p.seq = a.seq;
    const { seq, ...action } = a;
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
        client.on('connect', () => { client.subscribe(topic(code, 'host'), { qos: 1 }); if (latest) publish(latest); });
        client.on('message', (t, buf) => { const msg = parse(buf); if (msg && typeof msg === 'object') inbox = inbox.then(() => handle(msg)).catch(e => console.error(e)); });   // one at a time, in order
        resolve(url);
      });
      c.on('error', () => { clearTimeout(giveUp); c.end(true); tryNext(); });
    };
    tryNext();
  });

  // view: what everyone sees; hands: { id: [cards] }. Sealing is async, so publishes queue up in order.
  const publish = (next) => {
    latest = next;
    sending = sending.then(async () => {
      if (latest !== next) return;                           // a newer table is already queued
      const sealed = {};
      for (const [id, hand] of Object.entries(next.hands)) if (phones.has(id)) sealed[id] = await seal(await keyFor(id), hand);
      const msg = { ...next.view, sealed, hostId, hostPub: keys.pub, stamp: Date.now() };
      if (client?.connected) client.publish(topic(code, 'state'), JSON.stringify(msg), { qos: 0, retain: true });
      events.push(`${Date.now() % 100000} publish ${client?.connected ? 'ok' : 'SKIPPED'} ${next.view.phase}`);
    }).catch(e => console.error(e));
    return sending;
  };
  const close = () => { try { client?.publish(topic(code, 'state'), '', { retain: true }); } catch {} };
  if (globalThis.addEventListener) globalThis.addEventListener('pagehide', close);
  const end = () => { close(); client?.end(true); };
  return { ready, publish, close, end, known: () => Object.fromEntries(phones), events };
}

// A phone. Listens on every broker for the room's table and settles on whichever has it.
//   keys: this phone's key pair, kept across reloads
//   onState(view, hand): hand is null if the screen hasn't dealt this phone in
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
    if (s.hostPub !== hostPub) { hostPub = s.hostPub; key = await shared(keys, hostPub); }
    const me = s.players.find(p => p.id === id);
    // Not at the table in the lobby, or shown as away: say hello again (a dropped message, or a stray "leave")
    if (!s.banned?.includes(id) && (s.phase === 'lobby' || s.phase === 'over' ? !me : me && !me.connected)) helloSoon();
    const hand = s.sealed?.[id] ? await open(key, s.sealed[id]) : null;
    onState(s, hand);
  };

  for (const url of brokers) {
    const c = connect(url, opts({ will: { topic: topic(code, 'host'), payload: JSON.stringify({ type: 'leave', id }), qos: 1 } }));
    clients.set(url, c);
    c.on('connect', () => { if (!chosen) c.subscribe(topic(code, 'state'), { qos: 0 }); else if (c === chosen) { onStatus('open'); hello(); } });
    c.on('message', (t, buf) => {
      const s = parse(buf); if (!s || typeof s !== 'object' || !s.phase) return;
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
      seq = Math.max(seq + 1, Date.now() * 1000);            // always rising, even across reloads
      chosen.publish(topic(code, 'host'), JSON.stringify({ type: 'act', id, box: await seal(key, { ...action, seq }) }), { qos: 1 });
      return true;
    },
    close() {
      closed = true; clearTimeout(noRoom); clearTimeout(soon);
      try { chosen?.publish(topic(code, 'host'), JSON.stringify({ type: 'leave', id }), { qos: 1 }); } catch {}
      for (const c of clients.values()) c.end(true);
    },
  };
}
