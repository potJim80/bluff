// Kemps, as a pure reducer: apply(state, action) -> new state.
// The host keeps the whole state, hands included; publicView() is what goes on the wire for
// everyone, and each phone gets only its own four cards and who its partner is (sealed, see seal.js).
//
// The game: teams of two, partners sitting opposite each other. Everyone holds four cards; four
// more lie face up in the middle (the spread). Everyone swaps with the spread at once, as fast as
// they like, trying to collect four of a kind. Whoever gets it signals their partner in real life
// (a wink, a tap — never out loud); the partner calls "Kemps!". The other teams watch for the
// signal and can call "Stop!" on someone they think has it. A right call wins your team a letter
// of K-E-M-P-S; a wrong one loses one. First team to spell KEMPS wins.

import { dealerOf, mayDeal, log, shuffle, lobbyMove, nameOf } from '../../common/js/table.js';

export const INFO = { id: 'kemps', name: 'Kemps', min: 4, max: 8 };
export const ACTIONS = ['start', 'swap', 'done', 'kemps', 'stop'];   // the moves a phone may send
export const RANKS = 'A23456789TJQK';
export const SUITS = 'SHDC';
export const RANK_NAMES = ['Aces', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings'];
export const WORD = 'KEMPS';
export const TO_WIN = WORD.length;     // five letters
export const IDLE_MS = 10000;          // a spread nobody swaps with for this long is replaced
export const REVEAL_MS = 5000;         // how long the called player's cards stay turned over
export const HAND = 4;                 // cards each
export const EVEN_NOTE = 'Kemps needs an even number: 4, 6 or 8';

export const rankOf = (card) => RANKS.indexOf(card[0]);

export function freshDeck() {
  const d = [];
  for (const r of RANKS) for (const u of SUITS) d.push(r + u);
  return d;
}

export function sortHand(cards) {
  return cards.slice().sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]));
}

// Four cards, all the same rank.
export const isKemps = (hand) => Array.isArray(hand) && hand.length === HAND && hand.every(c => c[0] === hand[0][0]);

// Can this many players start? 4, 6 or 8.
export const rightCount = (n) => n >= INFO.min && n <= INFO.max && n % 2 === 0;

// For the phones' lobby (phone-kit): why the cards can't be dealt yet, or null if they can.
// Gets the public view; only players whose phones are here count, as at the deal.
export function dealProblem(view) {
  const here = (view?.players || []).filter(p => p.connected).length;
  return rightCount(here) ? null : `${EVEN_NOTE}.`;
}

// Teams for a list of players in seat order: seat i plays with seat i + n/2 (straight across the
// table). Team 1 is seats 0 and n/2, Team 2 seats 1 and n/2+1, and so on.
export function pairUp(players) {
  const half = players.length / 2, teams = [];
  for (let k = 0; k < half; k++) teams.push([players[k].id, players[k + half].id]);
  return teams;
}

export function newGame(code, players = []) {
  return {
    code, phase: 'lobby', round: 0,
    players: players.map(p => ({ id: p.id, name: p.name, connected: p.connected ?? true })),
    banned: [], log: [], seq: 0,
    teams: [],            // [{ members: [id, id], score }]
    hands: {}, spread: [], stock: [], discard: [],
    handNo: 0, spreadNo: 0, done: [], idleUntil: null,
    call: null,           // the last call: { by, kind, target, cards, correct, team, delta, until }
    winner: null,         // index into teams once a team has spelled KEMPS
  };
}

export const teamOf = (s, id) => s.teams.findIndex(t => t.members.includes(id));
export const partnerOf = (s, id) => { const t = s.teams[teamOf(s, id)]; return t ? t.members.find(m => m !== id) : null; };
export const teamName = (k) => `Team ${k + 1}`;
const both = (s, k) => s.teams[k].members.map(id => nameOf(s, id)).join(' & ');

// Only a real deck of 52 different cards can be dealt from (a.deck is for the tests).
function goodDeck(d) {
  if (!Array.isArray(d) || d.length !== 52) return false;
  const all = new Set(freshDeck());
  return new Set(d).size === 52 && d.every(c => all.has(c));
}

export function apply(s0, a) {
  if (!a || typeof a !== 'object') return s0;
  // join and leave work the same as in every game; leaving can finish "everyone's done".
  const moved = lobbyMove(s0, a, { max: INFO.max });
  if (moved) return a.type === 'leave' && moved !== s0 ? refreshIfAllDone(moved, a.at) : moved;

  const s = structuredClone(s0);
  const me = s.players.find(p => p.id === a.id);
  const inHand = !!(me && s.hands[a.id]);       // dealt into this hand
  switch (a.type) {
    case 'remove': {          // from the screen: gone for good, can't sit down again
      if (!me) return s0;
      s.banned.push(a.id);
      s.players = s.players.filter(p => p.id !== a.id);
      if (s.phase === 'lobby' || s.phase === 'over') { log(s, `${me.name} was removed`, a.at); return s; }
      // Mid-game a team is now one short: the game can't go on.
      const k = teamOf(s0, a.id);
      log(s, `${me.name} was removed, which breaks up ${teamName(k)}. Back to the start — deal again with 4, 6 or 8`, a.at);
      return toLobby(s);
    }
    case 'start': {
      if (s.phase !== 'lobby' && s.phase !== 'over') return s0;
      if (!mayDeal(s, a)) return s0;
      s.players = s.players.filter(p => p.connected);
      if (!rightCount(s.players.length)) return s0;
      s.teams = pairUp(s.players).map(members => ({ members, score: 0 }));
      Object.assign(s, { round: s.round + 1, handNo: 0, winner: null, call: null });
      deal(s, a.at, goodDeck(a.deck) ? a.deck : null);
      log(s, `New game. ${s.teams.map((t, k) => `${teamName(k)}: ${both(s, k)}`).join(' · ')}`, a.at);
      return s;
    }
    case 'swap': {            // give one of mine, take one from the spread
      if (s.phase !== 'swap' || !inHand) return s0;
      const { give, takeCard } = a;
      if (typeof give !== 'string' || typeof takeCard !== 'string') return s0;
      const hi = s.hands[a.id].indexOf(give), si = s.spread.indexOf(takeCard);
      if (hi < 0 || si < 0) return s0;       // not mine, or someone else got there first
      s.hands[a.id][hi] = takeCard;          // each card lands in the other's place
      s.spread[si] = give;
      s.done = s.done.filter(id => id !== a.id);
      s.idleUntil = (a.at ?? 0) + IDLE_MS;
      s.seq++;
      return s;
    }
    case 'done': {            // nothing more wanted from this spread
      if (s.phase !== 'swap' || !inHand || s.done.includes(a.id)) return s0;
      s.done.push(a.id);
      return refreshIfAllDone(s, a.at);
    }
    case 'kemps': {           // "my partner has four of a kind"
      if (s.phase !== 'swap' || !inHand) return s0;
      return called(s, a, 'kemps', partnerOf(s, a.id));
    }
    case 'stop': {            // "that opponent has four of a kind"
      if (s.phase !== 'swap' || !inHand) return s0;
      const t = a.target;
      if (typeof t !== 'string' || !s.hands[t] || teamOf(s, t) === teamOf(s, a.id)) return s0;   // not yourself, not your partner
      return called(s, a, 'stop', t);
    }
    case 'refresh': {         // the host's timer: nobody swapped for ten seconds
      if (s.phase !== 'swap') return s0;
      return newSpread(s, a.at);
    }
    case 'next': {            // the host's timer: the reveal has been on screen long enough
      if (s.phase !== 'reveal') return s0;
      const top = s.teams.findIndex(t => t.score >= TO_WIN);
      if (top >= 0) {
        s.phase = 'over'; s.winner = top; s.idleUntil = null;
        log(s, `${teamName(top)} spelled KEMPS and wins — ${both(s, top)}`, a.at);
        return s;
      }
      s.call = null;
      deal(s, a.at, goodDeck(a.deck) ? a.deck : null);
      return s;
    }
  }
  return s0;
}

// A new hand for the same teams: the whole deck shuffled again, four each, four in the spread.
function deal(s, at, deck) {
  const d = deck ? deck.slice() : shuffle(freshDeck());
  s.hands = {};
  s.players.forEach((p, i) => { s.hands[p.id] = sortHand(d.slice(i * HAND, i * HAND + HAND)); });
  const used = s.players.length * HAND;
  s.spread = d.slice(used, used + HAND);
  s.stock = d.slice(used + HAND);
  s.discard = [];
  s.handNo++;
  s.spreadNo = 1;
  s.done = [];
  s.idleUntil = (at ?? 0) + IDLE_MS;
  s.phase = 'swap';
}

// The spread goes to the discard pile and four new cards come off the stock. If the stock is
// short, the discard pile is shuffled back into it first.
function newSpread(s, at) {
  s.discard.push(...s.spread);
  if (s.stock.length < HAND) { s.stock.push(...shuffle(s.discard)); s.discard = []; }
  s.spread = s.stock.splice(0, HAND);
  s.spreadNo++;
  s.done = [];
  s.idleUntil = (at ?? 0) + IDLE_MS;
  s.seq++;
  return s;
}

// Everyone whose phone is here has said they're done: next spread. Away players don't hold it up.
function refreshIfAllDone(s, at) {
  if (s.phase !== 'swap') return s;
  const here = s.players.filter(p => p.connected && s.hands[p.id]);
  if (!here.length || !here.every(p => s.done.includes(p.id))) return s;
  return newSpread(s, at);
}

// Someone called. Turn the target's cards over, score it, and show it for a few seconds.
function called(s, a, kind, target) {
  const k = teamOf(s, a.id), team = s.teams[k];
  const correct = isKemps(s.hands[target]);
  const before = team.score;
  team.score = correct ? before + 1 : Math.max(0, before - 1);
  s.call = { by: a.id, kind, target, cards: s.hands[target].slice(), correct, team: k, delta: team.score - before, until: (a.at ?? 0) + REVEAL_MS };
  s.phase = 'reveal';
  s.idleUntil = null;
  const word = kind === 'kemps' ? 'Kemps' : 'Stop';
  const result = correct ? `right! ${teamName(k)} gets ${WORD[team.score - 1]}`
    : team.score < before ? `wrong. ${teamName(k)} loses a letter` : `wrong. ${teamName(k)} had no letters to lose`;
  log(s, `${nameOf(s, a.id)} called ${word} on ${nameOf(s, target)} — ${result}`, a.at);
  return s;
}

// Back to the lobby (a team was broken up): no hands, no teams, no scores.
function toLobby(s) {
  Object.assign(s, { phase: 'lobby', teams: [], hands: {}, spread: [], stock: [], discard: [], spreadNo: 0, handNo: 0, done: [], idleUntil: null, call: null, winner: null });
  return s;
}

// The host's clock: a spread nobody touches is replaced; a reveal moves on after a few seconds.
export function timer(s) {
  if (s.phase === 'swap') return { at: s.idleUntil, action: { type: 'refresh' } };
  if (s.phase === 'reveal') return { at: s.call.until, action: { type: 'next' } };
  return null;
}

// After the screen reloads: give the spread, or a reveal, its full time back.
export function resume(s, now) {
  if (s.phase === 'swap') s.idleUntil = now + IDLE_MS;
  if (s.phase === 'reveal') s.call.until = now + REVEAL_MS;
  return s;
}

// Each phone sees only its own four cards, and who its partner is.
export function secrets(s) {
  const out = {};
  for (const id in s.hands) out[id] = { hand: s.hands[id], partner: partnerOf(s, id) };
  return out;
}
export { dealerOf };

// Everything except the cards in hands, the stock and the discard pile. The spread is face up, so
// it's public; a call turns the called player's cards over for everyone.
export function publicView(s) {
  return {
    code: s.code, phase: s.phase, round: s.round, banned: s.banned, winner: s.winner,
    // team: 0, 1, 2 … (null for someone who sat down after the last deal)
    players: s.players.map(p => ({ ...p, team: teamOf(s, p.id) >= 0 ? teamOf(s, p.id) : null, done: s.done.includes(p.id) })),
    teams: s.teams.map(t => ({ members: t.members, score: t.score })),
    spread: s.spread, stock: s.stock.length, discard: s.discard.length,
    handNo: s.handNo, spreadNo: s.spreadNo, idleUntil: s.idleUntil,
    call: s.call, log: s.log.slice(0, 12),
  };
}
