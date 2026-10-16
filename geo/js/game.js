// Pinpoint, a GeoGuessr-style guessing game, as a pure reducer: apply(state, action) -> new state.
// The host keeps the whole state; publicView() is what goes on the wire for everyone.
//
// The game: five rounds. Each round the screen shows a photo taken somewhere on Earth. Everyone
// drops a pin on the map on their phone and locks it in. When everyone has (or the time runs out)
// the screen shows where it really was and how far off each pin landed. Closer is more points,
// up to 5,000 a round. Most points after five rounds wins.
//
// What's secret: where the photo is, until the reveal, and each pin, until the reveal (moves are
// sealed, and the public view only says who has locked in). Each phone is told its own pin back,
// so a reloaded phone still shows it.
//
// Phases: lobby -> guess <-> reveal -> over.

import { dealerOf, mayDeal, nameOf, log, shuffle, lobbyMove } from '../../common/js/table.js';
import { PLACES } from './places.js';

export const INFO = { id: 'geo', name: 'Pinpoint', min: 1, max: 12 };
export const ACTIONS = ['start', 'guess', 'next'];   // the moves a phone may send
export const ROUNDS = 5;
export const GUESS_MS = 75000;                        // time to drop a pin
export const REVEAL_MS = 25000;                       // the answer stays up this long, then the next round
export const MAX_POINTS = 5000;
export { PLACES };

// Great-circle distance in km.
export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// GeoGuessr's world-map curve: 5,000 on the spot, about half at 1,000 km, next to nothing past 5,000 km.
export const points = (d) => Math.round(MAX_POINTS * Math.exp(-d / 1492.7));

// Longitudes wrap (a pin dropped after scrolling the map sideways can come in as 200°).
const wrapLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
export function cleanPin(a) {
  const lat = Number(a?.lat), lon = Number(a?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 1e4) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(wrapLon(lon) * 1e5) / 1e5 };
}

export function newGame(code, players = []) {
  return {
    code, phase: 'lobby', round: 0,
    players: players.map(p => ({ id: p.id, name: p.name, connected: p.connected ?? true })),
    banned: [], places: [], used: [], n: 0, pins: {}, until: null,
    results: [], scores: {}, log: [], seq: 0,
  };
}

// The five photos for a game: ones this party hasn't seen yet, while there are enough of them.
function pickPlaces(s, given) {
  const all = PLACES.map((_, i) => i);
  if (Array.isArray(given) && given.length === ROUNDS && given.every(i => Number.isInteger(i) && PLACES[i]) && new Set(given).size === ROUNDS) return given.slice();
  let fresh = all.filter(i => !s.used.includes(i));
  if (fresh.length < ROUNDS) { s.used = []; fresh = all; }
  return shuffle(fresh).slice(0, ROUNDS);
}

// Who we're still waiting on this round: everyone whose phone is here and hasn't locked in.
export const waitingOn = (s) => s.players.filter(p => p.connected && !s.pins[p.id]).map(p => p.id);

function startRound(s, at) {
  s.n += 1; s.pins = {}; s.phase = 'guess'; s.until = (at ?? 0) + GUESS_MS;
  log(s, `Round ${s.n} of ${ROUNDS}`, at);
  return s;
}

// Everyone's in (or the time ran out): score the round and show where it was.
function reveal(s, at) {
  const place = PLACES[s.places[s.n - 1]];
  const guesses = {};
  for (const p of s.players) {
    const pin = s.pins[p.id];
    const r = pin ? { ...pin, km: Math.round(km(pin, place)), pts: points(km(pin, place)) } : { km: null, pts: 0 };
    guesses[p.id] = r;
    s.scores[p.id] = (s.scores[p.id] || 0) + r.pts;
  }
  s.results.push({ place: s.places[s.n - 1], guesses });
  s.phase = 'reveal'; s.until = (at ?? 0) + REVEAL_MS;
  const best = s.players.filter(p => guesses[p.id].km != null).sort((a, b) => guesses[a.id].km - guesses[b.id].km)[0];
  log(s, `It was ${place.where}${best ? ` — ${best.name} was closest` : ''}`, at);
  return s;
}

function finish(s, at) {
  s.phase = 'over'; s.until = null; s.pins = {};
  const top = Math.max(0, ...s.players.map(p => s.scores[p.id] || 0));
  const winners = s.players.filter(p => (s.scores[p.id] || 0) === top);
  log(s, winners.length === 1 ? `${winners[0].name} wins with ${top.toLocaleString('en-US')}` : `A tie at ${top.toLocaleString('en-US')}`, at);
  return s;
}

// After any change mid-round: is everyone in?
function settle(s, at) {
  if (s.phase === 'guess' && s.players.some(p => p.connected) && !waitingOn(s).length) return reveal(s, at);
  return s;
}

export function apply(s0, a) {
  if (!a || typeof a !== 'object') return s0;
  // Anyone can sit down at any time; they start on nothing and play from the next photo they see.
  const moved = lobbyMove(s0, a, { max: INFO.max, canSitDown: () => true });
  if (moved) return moved !== s0 && a.type === 'leave' ? settle(moved, a.at) : moved;
  const s = structuredClone(s0);
  const me = s.players.find(p => p.id === a.id);
  switch (a.type) {
    case 'remove': {          // from the screen: gone for good
      if (!me) return s0;
      s.banned.push(a.id);
      s.players = s.players.filter(p => p.id !== a.id);
      delete s.pins[a.id]; delete s.scores[a.id];
      log(s, `${me.name} was removed`, a.at);
      return settle(s, a.at);
    }
    case 'start': {
      if (s.phase !== 'lobby' && s.phase !== 'over') return s0;
      if (!mayDeal(s, a)) return s0;
      const players = s.players.filter(p => p.connected);
      if (players.length < INFO.min) return s0;
      s.players = players;
      // Only the screen (or a test) may choose the photos; a phone's action always carries its id.
      s.places = pickPlaces(s, a.id ? null : a.places);
      s.used = [...new Set([...s.used, ...s.places])];
      Object.assign(s, { round: s.round + 1, n: 0, results: [], scores: Object.fromEntries(players.map(p => [p.id, 0])) });
      log(s, 'New game — five places', a.at);
      return startRound(s, a.at);
    }
    case 'guess': {           // a phone locks in its pin; it can't be moved after
      if (s.phase !== 'guess' || !me || s.pins[a.id]) return s0;
      const pin = cleanPin(a);
      if (!pin) return s0;
      s.pins[a.id] = pin;
      if (!(a.id in s.scores)) s.scores[a.id] = 0;
      return settle(s, a.at);
    }
    case 'timeup': {          // the host's clock: time to guess ran out
      if (s.phase !== 'guess') return s0;
      log(s, 'Time’s up', a.at);
      return reveal(s, a.at);
    }
    case 'skip': {            // from the screen: show the answer now, without waiting
      if (s.phase !== 'guess') return s0;
      return reveal(s, a.at);
    }
    case 'next': {            // the dealer's phone, the screen, or the clock after a reveal
      if (s.phase !== 'reveal') return s0;
      if (a.id && dealerOf(s)?.id !== a.id) return s0;
      return s.n >= ROUNDS ? finish(s, a.at) : startRound(s, a.at);
    }
  }
  return s0;
}

// The host's clock: the guessing time runs out, and the answer moves on by itself.
export function timer(s) {
  if (s.phase === 'guess' && s.until) return { at: s.until, action: { type: 'timeup' } };
  if (s.phase === 'reveal' && s.until) return { at: s.until, action: { type: 'next' } };
  return null;
}

// After the screen reloads: give a running clock its full time back.
export function resume(s, now) {
  if (s.phase === 'guess') s.until = now + GUESS_MS;
  else if (s.phase === 'reveal') s.until = now + REVEAL_MS;
  return s;
}

// Each phone is told its own pin (so a reload still shows it), nothing else.
export const secrets = (s) => Object.fromEntries(s.players.map(p => [p.id, { pin: s.phase === 'guess' ? s.pins[p.id] || null : null }]));
export { dealerOf, nameOf };

// What everyone sees. While guessing: the photo and who has locked in — not where it is, and not
// anyone's pin. After each reveal: the place, every pin and its points.
export function publicView(s) {
  const cur = s.n ? PLACES[s.places[s.n - 1]] : null;
  return {
    code: s.code, phase: s.phase, round: s.round, banned: s.banned,
    players: s.players.map(p => ({ ...p, score: s.scores[p.id] || 0, locked: !!s.pins[p.id] })),
    n: s.n, rounds: ROUNDS, until: s.until,
    photo: cur && s.phase !== 'over' ? { img: cur.img, w: cur.w, h: cur.h } : null,
    // Every round revealed so far, answers included. The one being guessed isn't in here yet.
    results: s.results.map(r => ({ ...placeView(PLACES[r.place]), guesses: r.guesses })),
    log: s.log.slice(0, 12),
  };
}
const placeView = (p) => ({ img: p.img, w: p.w, h: p.h, lat: p.lat, lon: p.lon, where: p.where, credit: p.credit, page: p.page });
