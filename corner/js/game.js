// Corner, an open-market trading game, as a pure reducer: apply(state, action) -> new state.
// The host keeps the whole state, hands included; publicView() is what goes on the wire for
// everyone, and each phone gets only its own hand and its own open offer (sealed, see seal.js).
//
// The game: there are no turns. Everyone trades at once. You offer one to four cards of the same
// good, and everyone can see how MANY you offer, never what. As soon as someone else offers the
// same number, the two of you swap. Collect all nine cards of one good (or eight and the Bull)
// to "corner the market": the round ends and you score that good's value. Holding the Bear stops
// you from cornering, and whoever is left holding the Bull or the Bear loses 20 points. Rounds
// keep coming until someone reaches 500.

import { mayDeal, log, shuffle, take, lobbyMove, nameOf } from '../../common/js/table.js';

export const INFO = { id: 'corner', name: 'Corner', min: 3, max: 8 };
export const ACTIONS = ['start', 'offer', 'cancel'];   // the moves a phone may send

// The goods, in the order they come into play: three players use the first three, and so on.
export const GOODS = [
  { id: 'wheat', name: 'Wheat', value: 100 },
  { id: 'barley', name: 'Barley', value: 85 },
  { id: 'coffee', name: 'Coffee', value: 80 },
  { id: 'corn', name: 'Corn', value: 75 },
  { id: 'sugar', name: 'Sugar', value: 65 },
  { id: 'oats', name: 'Oats', value: 60 },
  { id: 'soybeans', name: 'Soybeans', value: 55 },
  { id: 'oranges', name: 'Oranges', value: 50 },
];
export const PER_GOOD = 9;            // cards of each good
export const MAX_OFFER = 4;           // most cards in one offer
export const PENALTY = 20;            // for holding the Bull or the Bear when someone else corners
export const TARGET = 500;            // first to this many points wins the match
export const OPEN_MS = 3000;          // "Ready… Trade!" before each round
export const SCORED_MS = 8000;        // how long the round's result stays up
export const TRADES_KEPT = 8;         // recent trades shown on the screen

// A card id is 'wheat-3' (the third Wheat), or 'bull', or 'bear'.
export const isGood = (card) => card !== 'bull' && card !== 'bear';
export const goodOf = (card) => String(card).split('-')[0];
export const goodInfo = (id) => GOODS.find(g => g.id === id) || null;

// Every card for a table of n players: nine of each of the first n goods, the Bull and the Bear.
export function freshDeck(n) {
  const deck = [];
  for (const g of GOODS.slice(0, n)) for (let k = 1; k <= PER_GOOD; k++) deck.push(`${g.id}-${k}`);
  deck.push('bull', 'bear');
  return deck;
}

// Goods in list order (Wheat first), then the Bull, then the Bear.
const order = (card) => isGood(card) ? GOODS.findIndex(g => g.id === goodOf(card)) * 100 + +card.split('-')[1] : card === 'bull' ? 10000 : 10001;
export function sortHand(cards) { return cards.slice().sort((a, b) => order(a) - order(b)); }

// Does this hand corner the market? Returns { good, double } or null.
//   all nine of a good, or eight and the Bull; nine and the Bull is a double corner.
//   Never while holding the Bear.
export function cornerOf(hand) {
  if (!hand || hand.includes('bear')) return null;
  const bull = hand.includes('bull');
  let best = null;
  for (const g of GOODS) {
    const n = hand.filter(c => isGood(c) && goodOf(c) === g.id).length;
    if (n === PER_GOOD || (n === PER_GOOD - 1 && bull)) {
      const found = { good: g.id, double: n === PER_GOOD && bull };
      if (!best || g.value > goodInfo(best.good).value) best = found;
    }
  }
  return best;
}

export function newGame(code, players = []) {
  return {
    code, phase: 'lobby', round: 0,
    players: players.map(p => ({ id: p.id, name: p.name, connected: p.connected ?? true })),
    banned: [], scores: {}, hands: {}, goods: [],
    offers: [],        // open offers, oldest first: { by, cards, count, since }
    trades: [],        // recent trades, newest first: { a, b, count, at, n }
    tradeN: 0,         // counts every trade, so each one has its own number
    until: null,       // when 'open' or 'scored' moves on by itself
    result: null,      // the last round: { winner, good, double, points, penalties, bull, bear, cards }
    winner: null,      // the match winner, once someone reaches 500
    log: [], seq: 0,
  };
}

export function apply(s0, a) {
  const me = s0.players.find(p => p.id === a.id);
  switch (a.type) {
    case 'join': return lobbyMove(s0, a, { max: INFO.max });
    case 'leave': {           // a phone went away: in the lobby that frees the seat; mid-round it keeps it
      const s = lobbyMove(s0, a, { max: INFO.max });
      if (s === s0) return s0;
      s.offers = s.offers.filter(o => o.by !== a.id);      // an away player's offer is withdrawn
      return s;
    }
    case 'remove': {          // from the screen: gone for good, can't sit down again
      if (!me) return s0;
      const s = structuredClone(s0);
      s.banned.push(a.id);
      s.players = s.players.filter(p => p.id !== a.id);
      delete s.hands[a.id];
      delete s.scores[a.id];
      s.offers = s.offers.filter(o => o.by !== a.id);
      log(s, `${me.name} was removed`, a.at);
      if (s.phase === 'lobby' || s.phase === 'over') return s;
      // Mid-round: their cards are gone, so this round can't be finished. Deal again, or stop.
      if (s.players.length >= INFO.min) { log(s, 'That round is off. New deal', a.at); return deal(s, a.at); }
      Object.assign(s, { phase: 'lobby', hands: {}, goods: [], offers: [], trades: [], until: null, result: null });
      log(s, `Fewer than ${INFO.min} left. Back to the start`, a.at);
      return s;
    }
    case 'start': {
      if (s0.phase !== 'lobby' && s0.phase !== 'over') return s0;
      if (!mayDeal(s0, a)) return s0;
      const s = structuredClone(s0);
      s.players = s.players.filter(p => p.connected);
      if (s.players.length < INFO.min || s.players.length > INFO.max) return s0;
      s.scores = Object.fromEntries(s.players.map(p => [p.id, 0]));
      Object.assign(s, { round: 0, winner: null, result: null, tradeN: 0 });
      log(s, `New game. First to ${TARGET} wins`, a.at);
      return deal(s, a.at, a.deck, a.first);
    }
    case 'go': {              // the host's timer: the countdown is over
      if (s0.phase !== 'open') return s0;
      const s = structuredClone(s0);
      s.phase = 'trading'; s.until = null;
      return s;
    }
    case 'next': {            // the host's timer: the result has been up long enough
      if (s0.phase !== 'scored') return s0;
      return deal(structuredClone(s0), a.at);
    }
    case 'offer': {
      if (s0.phase !== 'trading' || !me || !s0.hands[a.id]) return s0;
      const cards = a.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_OFFER) return s0;
      if (!cards.every(c => typeof c === 'string')) return s0;
      if (!take(s0.hands[a.id], cards)) return s0;                       // not all theirs (or one card twice)
      if (new Set(cards.filter(isGood).map(goodOf)).size > 1) return s0;  // more than one good
      const s = structuredClone(s0);
      const offer = { by: a.id, cards: cards.slice(), count: cards.length, since: a.at ?? 0 };
      s.offers = s.offers.filter(o => o.by !== a.id);                    // a new offer replaces the old one
      // Someone already waiting with the same number? The one who has waited longest trades.
      for (;;) {
        const i = s.offers.findIndex(o => o.count === offer.count && o.by !== a.id);
        if (i < 0) break;
        const other = s.offers.splice(i, 1)[0];
        if (!stillHeld(s, other)) continue;                               // stale: drop it, look again
        return trade(s, other, offer, a.at);
      }
      s.offers.push(offer);
      return s;
    }
    case 'cancel': {
      if (s0.phase !== 'trading' || !s0.offers.some(o => o.by === a.id)) return s0;
      const s = structuredClone(s0);
      s.offers = s.offers.filter(o => o.by !== a.id);
      return s;
    }
  }
  return s0;
}

// An offer still counts if its player is at the table and still holds every card in it.
function stillHeld(s, o) {
  return s.players.some(p => p.id === o.by) && !!s.hands[o.by] && !!take(s.hands[o.by], o.cards);
}

// Two offers of the same size meet: each player gets the other's cards. Then: a corner?
function trade(s, older, newer, at) {
  const x = older.by, y = newer.by;
  s.hands[x] = sortHand([...take(s.hands[x], older.cards), ...newer.cards]);
  s.hands[y] = sortHand([...take(s.hands[y], newer.cards), ...older.cards]);
  s.tradeN = (s.tradeN || 0) + 1;
  s.trades = [{ a: x, b: y, count: older.count, at: at ?? 0, n: s.tradeN }, ...s.trades].slice(0, TRADES_KEPT);
  return checkCorner(s, [x, y], at);
}

// Deal a round to everyone at the table (away players keep their seats and get cards too).
// deck and first are for the tests: a deck in a set order, and the seat that gets the first card.
function deal(s, at, deck, first) {
  const n = s.players.length;
  const fresh = freshDeck(n);
  const rigged = Array.isArray(deck) && deck.length === fresh.length && deck.slice().sort().join() === fresh.slice().sort().join();
  const cards = rigged ? deck.slice() : shuffle(fresh);
  const start = Number.isInteger(first) && first >= 0 && first < n ? first : Math.floor(Math.random() * n);
  s.goods = GOODS.slice(0, n).map(g => g.id);
  s.hands = Object.fromEntries(s.players.map(p => [p.id, []]));
  cards.forEach((c, i) => s.hands[s.players[(start + i) % n].id].push(c));
  for (const id in s.hands) s.hands[id] = sortHand(s.hands[id]);
  for (const p of s.players) s.scores[p.id] ??= 0;
  Object.assign(s, { phase: 'open', round: s.round + 1, offers: [], trades: [], result: null, until: (at ?? 0) + OPEN_MS });
  log(s, `Round ${s.round}: ${n} goods in play`, at);
  return checkCorner(s, s.players.map(p => p.id), at);    // a lucky deal can corner straight away
}

// After a deal or a trade: did any of these players corner a good? The richer good wins a tie.
function checkCorner(s, ids, at) {
  let best = null;
  for (const id of ids) {
    const c = cornerOf(s.hands[id]);
    if (c && (!best || goodInfo(c.good).value > goodInfo(best.good).value)) best = { ...c, id };
  }
  return best ? score(s, best, at) : s;
}

// Somebody cornered the market. They score the good's value (twice for a double); everyone else
// loses 20 for the Bear and 20 for the Bull, if they're holding them.
function score(s, c, at) {
  const g = goodInfo(c.good);
  const points = g.value * (c.double ? 2 : 1);
  s.scores[c.id] += points;
  const penalties = {};
  let bull = null, bear = null;
  for (const p of s.players) {
    if (p.id === c.id) continue;
    let lost = 0;
    if (s.hands[p.id].includes('bear')) { lost += PENALTY; bear = p.id; }
    if (s.hands[p.id].includes('bull')) { lost += PENALTY; bull = p.id; }
    if (lost) { penalties[p.id] = -lost; s.scores[p.id] -= lost; }
  }
  s.result = { winner: c.id, good: c.good, double: c.double, points, penalties, bull, bear, cards: s.hands[c.id].slice() };
  s.offers = [];
  log(s, `${nameOf(s, c.id)} cornered ${g.name}${c.double ? ' twice over' : ''}: +${points}`, at);
  // Anyone at 500? Then the match is over: the highest score wins; a tie at the top goes to
  // whoever just cornered.
  const top = Math.max(...s.players.map(p => s.scores[p.id]));
  if (top >= TARGET) {
    const best = s.players.filter(p => s.scores[p.id] === top).map(p => p.id);
    s.winner = best.includes(c.id) ? c.id : best[0];
    s.phase = 'over'; s.until = null;
    log(s, `${nameOf(s, s.winner)} wins with ${top}`, at);
    return s;
  }
  s.phase = 'scored'; s.until = (at ?? 0) + SCORED_MS;
  return s;
}

// The host's clock: the countdown starts trading; the result moves on to the next deal.
export function timer(s) {
  if (s.phase === 'open') return { at: s.until, action: { type: 'go' } };
  if (s.phase === 'scored') return { at: s.until, action: { type: 'next' } };
  return null;
}

// After the screen reloads: give the countdown, or the result, its full time back.
export function resume(s, now) {
  if (s.phase === 'open') s.until = now + OPEN_MS;
  if (s.phase === 'scored') s.until = now + SCORED_MS;
  return s;
}

// Each phone sees its own hand, and the cards in its own open offer.
export function secrets(s) {
  const out = {};
  for (const id in s.hands) out[id] = { hand: s.hands[id], offer: s.offers.find(o => o.by === id)?.cards || null };
  return out;
}

// Everything but the cards: how many each player holds, how many each open offer is.
// The round's winning hand is shown once the round is over.
export function publicView(s) {
  const offerOf = (id) => s.offers.find(o => o.by === id);
  return {
    code: s.code, phase: s.phase, round: s.round, target: TARGET, until: s.until, winner: s.winner, banned: s.banned,
    players: s.players.map(p => ({ id: p.id, name: p.name, connected: p.connected, cards: s.hands[p.id]?.length ?? 0, score: s.scores[p.id] ?? 0, offer: offerOf(p.id)?.count ?? null })),
    market: s.offers.map(o => ({ by: o.by, count: o.count, since: o.since })),
    trades: s.trades.slice(0, TRADES_KEPT),
    goods: s.goods.map(id => ({ ...goodInfo(id) })),
    result: s.result, log: s.log.slice(0, 12),
  };
}
