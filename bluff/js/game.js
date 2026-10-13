// Bluff (also called Cheat or I Doubt It), as a pure reducer: apply(state, action) -> new state.
// The host keeps the whole state, hands and pile included; publicView() is what goes on the
// wire for everyone, and each phone gets only its own hand (sealed, see seal.js).
//
// The game: the claim walks Aces, Twos, Threes … Kings, then round again. On your turn you put
// down one to four cards face down and they count as the rank it is your turn to claim, true or
// not. Anyone else may call "Bluff!" before the window closes. If any card isn't that rank, the
// player who put them down takes the whole pile; if they were all true, the caller takes it.
// First to get rid of every card, and survive the call on their last play, wins.

import { dealerOf, mayDeal } from '../../common/js/table.js';

export const INFO = { id: 'bluff', name: 'Bluff', min: 2, max: 10 };
export const ACTIONS = ['start', 'play', 'pass', 'call'];      // the moves a phone may send
export const RANKS = 'A23456789TJQK';
export const SUITS = 'SHDC';
export const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
export const MAX_PLAYERS = 10;
export const WINDOW_MS = 10000;        // how long the others have to call
export const REVEAL_MS = 5000;         // how long the turned-over cards stay on screen
export const rankOf = (card) => RANKS.indexOf(card[0]);
export const plural = (r, n) => n === 1 ? RANK_NAMES[r] : RANK_NAMES[r] + (r === 5 ? 'es' : 's');
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
export const claimText = (r, n) => `${NUMBERS[n] || n} ${plural(r, n)}`;

export const decksFor = (n) => n > 6 ? 2 : 1;
export const maxPlay = (s) => 4 * s.decks;

export function freshDeck(decks = 1) {
  const d = [];
  for (let k = 0; k < decks; k++) for (const r of RANKS) for (const u of SUITS) d.push(r + u);
  return d;
}

export function shuffle(cards, rand = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function sortHand(cards) {
  return cards.slice().sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]));
}

export function newGame(code, players = []) {
  return {
    code, phase: 'lobby', round: 0,
    players: players.map(p => ({ id: p.id, name: p.name, connected: p.connected ?? true })),
    banned: [], hands: {}, pile: [], decks: 1,
    turn: 0, rank: 0, play: null, reveal: null, winner: null, log: [], seq: 0,
  };
}

export const current = (s) => s.players[s.turn];
const nameOf = (s, id) => s.players.find(p => p.id === id)?.name || '?';
const others = (s, id) => s.players.filter(p => p.id !== id);

function log(s, t, at) { s.seq++; s.log = [{ t, at: at ?? s.seq, n: s.seq }, ...s.log].slice(0, 40); }

// Remove the given cards from a hand, one instance each (two decks have duplicates).
// Returns null if any card isn't there.
function take(hand, cards) {
  const left = hand.slice();
  for (const c of cards) { const i = left.indexOf(c); if (i < 0) return null; left.splice(i, 1); }
  return left;
}

export function apply(s0, a) {
  const s = structuredClone(s0);
  const me = s.players.find(p => p.id === a.id);
  switch (a.type) {
    case 'join': {
      if (s.banned.includes(a.id)) return s0;
      if (me) { me.connected = true; return s; }
      if ((s.phase !== 'lobby' && s.phase !== 'over') || s.players.length >= MAX_PLAYERS) return s0;   // newcomers wait for the next deal
      const name = String(a.name || '').trim().slice(0, 16) || `Player ${s.players.length + 1}`;
      s.players.push({ id: a.id, name, connected: true });
      log(s, `${name} sat down`, a.at);
      return s;
    }
    case 'leave': {           // a phone went away; in the lobby that frees the seat
      if (!me) return s0;
      if (s.phase === 'lobby') { s.players = s.players.filter(p => p.id !== a.id); return s; }
      me.connected = false;
      return closeIfAllPassed(s, a.at);
    }
    case 'remove': {          // from the screen: gone for good, can't sit down again
      if (!me) return s0;
      s.banned.push(a.id);
      return dropPlayer(s, a.id, `${me.name} was removed`, a.at);
    }
    case 'start': {
      if (s.phase !== 'lobby' && s.phase !== 'over') return s0;
      if (!mayDeal(s, a)) return s0;
      s.players = s.players.filter(p => p.connected);
      if (s.players.length < 2) return s0;
      s.decks = decksFor(s.players.length);
      const deck = a.deck || shuffle(freshDeck(s.decks));
      s.hands = Object.fromEntries(s.players.map(p => [p.id, []]));
      deck.forEach((c, i) => s.hands[s.players[i % s.players.length].id].push(c));
      for (const id in s.hands) s.hands[id] = sortHand(s.hands[id]);
      Object.assign(s, { phase: 'turn', round: s.round + 1, pile: [], turn: 0, rank: 0, play: null, reveal: null, winner: null });
      log(s, `New game. ${s.players[0].name} starts with Aces`, a.at);
      return s;
    }
    case 'play': {
      if (s.phase !== 'turn' || current(s).id !== a.id) return s0;
      const cards = Array.isArray(a.cards) ? a.cards.map(String) : [];
      if (cards.length < 1 || cards.length > maxPlay(s)) return s0;
      const left = take(s.hands[a.id], cards);
      if (!left) return s0;
      s.hands[a.id] = left;
      s.pile.push(...cards);
      s.play = { by: a.id, cards, rank: s.rank, count: cards.length, passes: [], until: (a.at ?? 0) + WINDOW_MS };
      s.phase = 'window';
      log(s, `${me.name} says ${claimText(s.rank, cards.length)}`, a.at);
      return s;
    }
    case 'pass': {            // "let it go"
      if (s.phase !== 'window' || !me || a.id === s.play.by || s.play.passes.includes(a.id)) return s0;
      s.play.passes.push(a.id);
      return closeIfAllPassed(s, a.at);
    }
    case 'call': {
      if (s.phase !== 'window' || !me || a.id === s.play.by) return s0;
      const p = s.play;
      const truthful = p.cards.every(c => rankOf(c) === p.rank);
      const taker = truthful ? a.id : p.by;
      s.reveal = { by: p.by, caller: a.id, cards: p.cards, rank: p.rank, truthful, taker, took: s.pile.length, until: (a.at ?? 0) + REVEAL_MS };
      s.hands[taker] = sortHand([...s.hands[taker], ...s.pile]);
      s.pile = [];
      s.phase = 'reveal';
      log(s, truthful ? `${me.name} called bluff on ${nameOf(s, p.by)}: it was true. ${me.name} takes ${s.reveal.took}`
                      : `${me.name} called bluff on ${nameOf(s, p.by)}: caught! ${nameOf(s, p.by)} takes ${s.reveal.took}`, a.at);
      return s;
    }
    case 'close': {           // the host's timer: the window ran out with nobody calling
      if (s.phase !== 'window') return s0;
      return afterPlay(s, a.at);
    }
    case 'next': {            // the host's timer: the reveal has been on screen long enough
      if (s.phase !== 'reveal') return s0;
      return afterPlay(s, a.at);
    }
    case 'skip': {            // from the screen, when the player whose turn it is has gone quiet
      if (s.phase !== 'turn') return s0;
      log(s, `${current(s).name} was skipped`, a.at);
      return advance(s);
    }
  }
  return s0;
}

function closeIfAllPassed(s, at) {
  if (s.phase !== 'window') return s;
  const waiting = others(s, s.play.by).filter(p => p.connected && !s.play.passes.includes(p.id));
  return waiting.length ? s : afterPlay(s, at);
}

// The window closed, or the reveal is done. Did the player who just played go out?
function afterPlay(s, at) {
  const by = s.play.by;
  if (s.hands[by]?.length === 0) {
    s.phase = 'over'; s.winner = by; s.play = null; s.reveal = null;
    log(s, `${nameOf(s, by)} is out of cards and wins`, at);
    return s;
  }
  return advance(s);
}

function advance(s) {
  s.turn = (s.turn + 1) % s.players.length;
  s.rank = (s.rank + 1) % 13;
  s.play = null; s.reveal = null; s.phase = 'turn';
  return s;
}

// A player leaves mid-game: their cards go into the pile (face down, so nothing is revealed).
function dropPlayer(s, id, why, at) {
  const idx = s.players.findIndex(p => p.id === id);
  log(s, why, at);
  if (s.phase === 'lobby' || s.phase === 'over') { s.players.splice(idx, 1); if (s.turn >= s.players.length) s.turn = 0; return s; }
  s.pile.push(...(s.hands[id] || []));
  delete s.hands[id];
  const theirPlay = s.play?.by === id;       // their play stands, unchallenged; the next player goes on
  s.players.splice(idx, 1);
  if (theirPlay) { s.play = null; s.reveal = null; s.phase = 'turn'; s.turn = idx; s.rank = (s.rank + 1) % 13; }
  else if (idx < s.turn) s.turn--;
  if (s.turn >= s.players.length) s.turn = 0;
  if (s.players.length < 2) {
    s.phase = 'over'; s.winner = s.players[0]?.id ?? null; s.play = null; s.reveal = null;
    if (s.winner) log(s, `${nameOf(s, s.winner)} is the last one at the table`, at);
    return s;
  }
  if (s.phase === 'window') return closeIfAllPassed(s, at);
  return s;
}

// The host's clock: the calling window closes by itself; a reveal moves on after a few seconds.
export function timer(s) {
  if (s.phase === 'window') return { at: s.play.until, action: { type: 'close' } };
  if (s.phase === 'reveal') return { at: s.reveal.until, action: { type: 'next' } };
  return null;
}

// After the screen reloads: give an open window, or a reveal, its full time back.
export function resume(s, now) {
  if (s.phase === 'window') s.play.until = now + WINDOW_MS;
  if (s.phase === 'reveal') s.reveal.until = now + REVEAL_MS;
  return s;
}

// Each phone sees only its own hand.
export const secrets = (s) => s.hands;
export { dealerOf };

// Everything except the cards in hands and in the pile. A reveal shows the called cards to all.
export function publicView(s) {
  return {
    code: s.code, phase: s.phase, round: s.round, decks: s.decks, turn: s.turn, rank: s.rank, winner: s.winner, banned: s.banned,
    players: s.players.map(p => ({ ...p, cards: s.hands[p.id]?.length ?? 0 })),
    pile: s.pile.length,
    play: s.play && { by: s.play.by, rank: s.play.rank, count: s.play.count, passes: s.play.passes, until: s.play.until },
    reveal: s.reveal, log: s.log.slice(0, 12),
  };
}
