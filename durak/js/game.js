// Durak ("the fool"), the Russian attack-and-defend game, as a pure reducer: apply(state, action)
// -> new state. The host keeps the whole state, hands and stock included; publicView() is what goes
// on the wire for everyone, and each phone gets only its own hand (sealed, see seal.js).
//
// The game: 36 cards, Sixes up to Aces. Six each; the next card is turned up and its suit is trumps.
// Each round (a "bout") one player attacks the next one clockwise, the defender. The attacker leads
// a card; the defender covers it with a higher card of the same suit, or with a trump. Everyone but
// the defender may throw in more cards of ranks already on the table. Beat everything and the cards
// are thrown away; give up and the defender takes the lot. Then everyone draws back up to six.
// Once the stock is gone, players who empty their hands are out and safe. Nobody wins: the last one
// holding cards is the durak.
//
// Phases: lobby -> attack (a bout is on) <-> taking (the defender gave up) -> over.

import { dealerOf, mayDeal, nameOf, log, shuffle, lobbyMove } from '../../common/js/table.js';

export const INFO = { id: 'durak', name: 'Durak', min: 2, max: 6 };
export const ACTIONS = ['start', 'attack', 'beat', 'take', 'done'];   // the moves a phone may send
export const RANKS = '6789TJQKA';            // low to high
export const SUITS = 'SHCD';
export const RANK_NAMES = ['Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const SUIT_SIGNS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const HAND = 6;                       // everyone draws back up to six
export const THROW_MS = 7000;                // after everything is beaten: time to throw in more
export const TAKE_MS = 5000;                 // after the defender gives up: time to throw in more

export const rankOf = (card) => RANKS.indexOf(card[0]);
export const suitOf = (card) => card[1];
export const plural = (r) => RANK_NAMES[r] + (r === 0 ? 'es' : 's');      // Sixes, Sevens …
const isCard = (c) => typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);

export function freshDeck() {
  const d = [];
  for (const r of RANKS) for (const u of SUITS) d.push(r + u);
  return d;
}

// Does `card` beat `attack`? A higher card of the same suit, or any trump on a card that isn't one.
export function beats(card, attack, trump) {
  if (suitOf(card) === suitOf(attack)) return rankOf(card) > rankOf(attack);
  return suitOf(card) === trump;
}

// For showing a hand: suit by suit, trumps last, low to high inside each suit.
export function sortHand(cards, trump) {
  const suitPlace = (c) => suitOf(c) === trump ? 9 : SUITS.indexOf(suitOf(c));
  return cards.slice().sort((a, b) => suitPlace(a) - suitPlace(b) || rankOf(a) - rankOf(b));
}

export function newGame(code, players = []) {
  return {
    code, phase: 'lobby', round: 0,
    players: players.map(p => ({ id: p.id, name: p.name, connected: p.connected ?? true })),
    banned: [], hands: {}, stock: [], discard: [], trump: null, trumpSuit: null,
    attacker: null, defender: null, table: [], limit: 0, done: [], until: null,
    out: [], durak: null, ending: null, log: [], seq: 0,
  };
}

// ---- small questions about the table ----
const inGame = (s, id) => !!s.players.find(p => p.id === id) && !s.out.includes(id);
const openAttacks = (s) => s.table.filter(t => !t.beat).length;
export const tableRanks = (s) => new Set(s.table.flatMap(t => t.beat ? [t.attack[0], t.beat[0]] : [t.attack[0]]));

// The next player clockwise after `id` who is still in the game (not out), or null.
function nextIn(s, id) {
  const n = s.players.length, i = s.players.findIndex(p => p.id === id);
  for (let k = 1; k <= n; k++) { const p = s.players[(i + k) % n]; if (p.id !== id && inGame(s, p.id)) return p.id; }
  return null;
}
// The first player still in the game at seat `i` or after it.
function firstInFrom(s, i) {
  const n = s.players.length;
  for (let k = 0; k < n; k++) { const p = s.players[(i + k) % n]; if (inGame(s, p.id)) return p.id; }
  return null;
}

// The attackers we're still waiting on before a bout can close: everyone but the defender who is
// still in, has cards to throw, has a phone that's here, and hasn't said they're done.
export function waitingOn(s) {
  return s.players.filter(p => p.id !== s.defender && inGame(s, p.id) && p.connected
    && (s.hands[p.id]?.length ?? 0) > 0 && !s.done.includes(p.id)).map(p => p.id);
}

// Can this player throw in (or lead) this card right now? Used by the reducer and by the phone.
export function mayAttack(s, id, card) {
  if (s.phase !== 'attack' && s.phase !== 'taking') return false;
  if (!s.hands[id]?.includes(card)) return false;
  if (s.table.length === 0) return s.phase === 'attack' && id === s.attacker;        // the lead
  if (id === s.defender || !inGame(s, id)) return false;
  if (s.table.length >= s.limit) return false;
  return tableRanks(s).has(card[0]);
}

// ---- a bout starts, ends, and everyone draws ----
function newBout(s, attacker) {
  s.attacker = attacker;
  s.defender = nextIn(s, attacker);
  s.table = []; s.done = []; s.until = null;
  s.limit = Math.min(HAND, s.hands[s.defender]?.length ?? 0);
  s.phase = 'attack';
  return s;
}

// Main attacker first, then the others clockwise, the defender last.
function drawOrder(s, attacker, defender) {
  const n = s.players.length, i = s.players.findIndex(p => p.id === attacker);
  const order = [];
  for (let k = 0; k < n; k++) { const p = s.players[(i + k + n) % n]; if (p.id !== defender && inGame(s, p.id)) order.push(p.id); }
  if (defender && inGame(s, defender)) order.push(defender);
  return order;
}

function drawUp(s, order) {
  for (const id of order) while (s.hands[id].length < HAND && s.stock.length) s.hands[id].push(s.stock.shift());
}

// Once the stock is gone, anyone with no cards is out (safe), in the order given.
function markOut(s, order, at) {
  if (s.stock.length) return;
  for (const id of order) if (s.hands[id].length === 0 && !s.out.includes(id)) {
    s.out.push(id);
    log(s, `${nameOf(s, id)} is out — safe, ${place(s.out.length)}`, at);
  }
}
export const place = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

// Is the game over? One player left with cards is the durak; nobody left means a draw.
// why: 'short' when it ended because players were removed, not by play.
function checkOver(s, at, why) {
  const left = s.players.filter(p => inGame(s, p.id));
  if (left.length >= 2) return false;
  s.discard.push(...s.table.flatMap(t => t.beat ? [t.attack, t.beat] : [t.attack]));
  Object.assign(s, { phase: 'over', table: [], done: [], until: null, attacker: null, defender: null, limit: 0 });
  if (why === 'short') { s.durak = null; s.ending = 'short'; log(s, 'Not enough players left — game over', at); }
  else if (left.length === 1) { s.durak = left[0].id; s.ending = 'durak'; log(s, `${left[0].name} is the durak`, at); }
  else { s.durak = null; s.ending = 'draw'; log(s, 'Everyone ran out at once — no durak', at); }
  return true;
}

// The bout is over: the defender beat everything (taken = false) or picks the table up (true).
function endBout(s, taken, at) {
  const cards = s.table.flatMap(t => t.beat ? [t.attack, t.beat] : [t.attack]);
  const def = s.defender;
  if (taken) { s.hands[def].push(...cards); log(s, `${nameOf(s, def)} takes ${cards.length} card${cards.length === 1 ? '' : 's'}`, at); }
  else { s.discard.push(...cards); log(s, `${nameOf(s, def)} beat everything`, at); }
  s.table = []; s.done = []; s.until = null;
  const order = drawOrder(s, s.attacker, def);
  drawUp(s, order);
  markOut(s, order, at);
  if (checkOver(s, at)) return s;
  // After a defence the defender attacks next; after a take they're skipped.
  const next = !taken && inGame(s, def) ? def : nextIn(s, def);
  newBout(s, next);
  log(s, `${nameOf(s, s.attacker)} attacks ${nameOf(s, s.defender)}`, at);
  return s;
}

// After any change mid-bout: should the bout close now? Everything beaten (or the defender taking)
// and either the table is full, or nobody who could still throw in is left to wait for.
function settle(s, at) {
  if (s.phase === 'attack' && s.table.length && !openAttacks(s)) {
    if (s.table.length >= s.limit || !waitingOn(s).length) return endBout(s, false, at);
  }
  if (s.phase === 'taking' && (s.table.length >= s.limit || !waitingOn(s).length)) return endBout(s, true, at);
  return s;
}

function startTaking(s, at) {
  s.phase = 'taking'; s.done = []; s.until = (at ?? 0) + TAKE_MS;
  log(s, `${nameOf(s, s.defender)} takes the cards`, at);
  return settle(s, at);
}

// A deck handed in by the screen or a test must be exactly the 36 cards, once each.
const validDeck = (d) => Array.isArray(d) && d.length === 36 && d.every(isCard) && new Set(d).size === 36;

export function apply(s0, a) {
  if (!a || typeof a !== 'object') return s0;
  const moved = lobbyMove(s0, a, { max: INFO.max });
  if (moved) {
    // A phone went away mid-bout: they no longer hold up the end of it.
    if (a.type === 'leave' && moved !== s0 && (moved.phase === 'attack' || moved.phase === 'taking')) return settle(moved, a.at);
    return moved;
  }
  const s = structuredClone(s0);
  const me = s.players.find(p => p.id === a.id);
  switch (a.type) {
    case 'remove': {          // from the screen: gone for good, can't sit down again
      if (!me) return s0;
      s.banned.push(a.id);
      return dropPlayer(s, a.id, `${me.name} was removed`, a.at);
    }
    case 'start': {
      if (s.phase !== 'lobby' && s.phase !== 'over') return s0;
      if (!mayDeal(s, a)) return s0;
      const players = s.players.filter(p => p.connected);
      if (players.length < INFO.min || players.length > INFO.max) return s0;
      s.players = players;
      // Only the screen (or a test) may hand in a deck; a phone's action always carries its id.
      const deck = !a.id && validDeck(a.deck) ? a.deck.slice() : shuffle(freshDeck());
      const n = players.length;
      s.hands = Object.fromEntries(players.map(p => [p.id, []]));
      for (let k = 0; k < HAND * n; k++) s.hands[players[k % n].id].push(deck[k]);
      // The next card is turned up for trumps and goes under the stock, drawn last. With six
      // players there is nothing left, so the last card dealt is shown instead (it stays in that hand).
      if (HAND * n < deck.length) { s.trump = deck[HAND * n]; s.stock = [...deck.slice(HAND * n + 1), s.trump]; }
      else { s.trump = deck[deck.length - 1]; s.stock = []; }
      s.trumpSuit = suitOf(s.trump);
      Object.assign(s, { round: s.round + 1, discard: [], out: [], durak: null, ending: null });
      // The lowest trump attacks first; if nobody holds a trump, the first seat does.
      let first = players[0].id, low = 99;
      for (const p of players) for (const c of s.hands[p.id]) if (suitOf(c) === s.trumpSuit && rankOf(c) < low) { low = rankOf(c); first = p.id; }
      newBout(s, first);
      log(s, `New game, trumps are ${SUIT_SIGNS[s.trumpSuit]}. ${nameOf(s, s.attacker)} attacks ${nameOf(s, s.defender)}`, a.at);
      return s;
    }
    case 'attack': {          // lead a card, or throw one in
      if (!me || !isCard(a.card) || !mayAttack(s, a.id, a.card)) return s0;
      const hand = s.hands[a.id];
      hand.splice(hand.indexOf(a.card), 1);
      s.table.push({ attack: a.card, beat: null, by: a.id });
      if (s.phase === 'attack') s.until = null;            // the defender has something to beat again
      log(s, s.table.length === 1 ? `${me.name} leads against ${nameOf(s, s.defender)}` : `${me.name} throws in`, a.at);
      return settle(s, a.at);
    }
    case 'beat': {            // the defender covers one attack card
      if (s.phase !== 'attack' || a.id !== s.defender || !isCard(a.card)) return s0;
      const t = Number.isInteger(a.target) ? s.table[a.target] : null;
      if (!t || t.beat || !s.hands[a.id].includes(a.card) || !beats(a.card, t.attack, s.trumpSuit)) return s0;
      const hand = s.hands[a.id];
      hand.splice(hand.indexOf(a.card), 1);
      t.beat = a.card;
      s.done = [];            // a new rank may be on the table: everyone gets to look again
      if (!openAttacks(s)) s.until = (a.at ?? 0) + THROW_MS;
      return settle(s, a.at);
    }
    case 'take': {            // the defender gives up and will pick up the table
      if (s.phase !== 'attack' || a.id !== s.defender || !openAttacks(s)) return s0;
      return startTaking(s, a.at);
    }
    case 'done': {            // an attacker has nothing more to throw in
      const waiting = (s.phase === 'attack' && s.table.length && !openAttacks(s)) || s.phase === 'taking';
      if (!me || !waiting || a.id === s.defender || !inGame(s, a.id) || s.done.includes(a.id)) return s0;
      s.done.push(a.id);
      return settle(s, a.at);
    }
    case 'endbout': {         // the host's timer: the time to throw in more ran out
      if (s.phase === 'taking') return endBout(s, true, a.at);
      if (s.phase === 'attack' && s.table.length && !openAttacks(s)) return endBout(s, false, a.at);
      return s0;
    }
    case 'skip': {            // from the screen: the player who must lead has gone quiet
      if (s.phase !== 'attack' || s.table.length || s.players.find(p => p.id === s.attacker)?.connected) return s0;
      log(s, `${nameOf(s, s.attacker)} was skipped`, a.at);
      newBout(s, nextIn(s, s.attacker));
      return s;
    }
    case 'forcetake': {       // from the screen: the defender's phone is away, so they take
      if (s.phase !== 'attack' || !openAttacks(s) || s.players.find(p => p.id === s.defender)?.connected) return s0;
      return startTaking(s, a.at);
    }
  }
  return s0;
}

// A player is removed mid-game: their hand goes to the discard. If they were attacking or
// defending, the bout is called off (table to the discard, nobody picks up), everyone draws as
// after any bout, and the next player along leads.
function dropPlayer(s, id, why, at) {
  const idx = s.players.findIndex(p => p.id === id);
  log(s, why, at);
  if (s.phase === 'lobby' || s.phase === 'over') { s.players.splice(idx, 1); return s; }
  s.discard.push(...(s.hands[id] || []));
  delete s.hands[id];
  const inBout = id === s.attacker || id === s.defender;
  s.players.splice(idx, 1);
  s.out = s.out.filter(x => x !== id);
  s.done = s.done.filter(x => x !== id);
  if (checkOver(s, at, 'short')) return s;
  if (!inBout) return settle(s, at);
  s.discard.push(...s.table.flatMap(t => t.beat ? [t.attack, t.beat] : [t.attack]));
  s.table = [];
  const lead = firstInFrom(s, idx % s.players.length);
  const order = drawOrder(s, lead, nextIn(s, lead));
  drawUp(s, order);
  markOut(s, order, at);
  if (checkOver(s, at)) return s;
  newBout(s, inGame(s, lead) ? lead : nextIn(s, lead));
  log(s, `${nameOf(s, s.attacker)} attacks ${nameOf(s, s.defender)}`, at);
  return s;
}

// The host's clock: the time to throw in more runs out by itself.
export function timer(s) {
  if ((s.phase === 'attack' || s.phase === 'taking') && s.until) return { at: s.until, action: { type: 'endbout' } };
  return null;
}

// After the screen reloads: give a running throw-in window its full time back.
export function resume(s, now) {
  if (s.until && s.phase === 'taking') s.until = now + TAKE_MS;
  else if (s.until && s.phase === 'attack') s.until = now + THROW_MS;
  return s;
}

// Each phone sees only its own hand.
export const secrets = (s) => Object.fromEntries(Object.entries(s.hands).map(([id, hand]) => [id, { hand }]));
export { dealerOf };

// Everything except the cards in hands, in the stock and in the discard. The trump card is face up.
export function publicView(s) {
  return {
    code: s.code, phase: s.phase, round: s.round, banned: s.banned,
    players: s.players.map(p => {
      const k = s.out.indexOf(p.id);
      return { ...p, cards: s.hands[p.id]?.length ?? 0, place: k < 0 ? null : k + 1 };
    }),
    attacker: s.attacker, defender: s.defender,
    table: s.table.map(t => ({ attack: t.attack, beat: t.beat, by: t.by })),
    stock: s.stock.length, trump: s.trump, trumpSuit: s.trumpSuit, discard: s.discard.length,
    until: s.until, done: s.done, limit: s.limit, out: s.out, durak: s.durak, ending: s.ending,
    log: s.log.slice(0, 12),
  };
}
