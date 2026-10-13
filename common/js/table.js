// Small pieces every game's rules use. Pure functions, no browser needed (the tests run in Node).

// Whoever deals: the first person at the table whose phone is here. The screen can always deal.
export const dealerOf = (s) => s.players.find(p => p.connected) || null;
export const mayDeal = (s, a) => !!a.byScreen || (dealerOf(s)?.id === a.id && !!a.id);

export const nameOf = (s, id) => s.players.find(p => p.id === id)?.name || '?';

// The table's running commentary, newest first. seq counts every line.
export function log(s, t, at) { s.seq = (s.seq || 0) + 1; s.log = [{ t, at: at ?? s.seq, n: s.seq }, ...(s.log || [])].slice(0, 40); }

export function shuffle(cards, rand = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Remove the given cards from a hand, one instance each (two decks have duplicates).
// Returns null if any card isn't there.
export function take(hand, cards) {
  const left = hand.slice();
  for (const c of cards) { const i = left.indexOf(c); if (i < 0) return null; left.splice(i, 1); }
  return left;
}

// The usual lobby moves. Returns the new state, or null if the game should handle the action itself.
//   join:   a phone says hello. Known players come back; newcomers sit down only between games.
//   leave:  a phone went away. In the lobby that frees the seat.
export function lobbyMove(s0, a, { max, canSitDown = (s) => s.phase === 'lobby' || s.phase === 'over' }) {
  if (a.type !== 'join' && a.type !== 'leave') return null;
  const me = s0.players.find(p => p.id === a.id);
  if (a.type === 'join') {
    if (s0.banned?.includes(a.id)) return s0;
    const s = structuredClone(s0);
    if (me) { s.players.find(p => p.id === a.id).connected = true; return s; }
    if (!canSitDown(s0) || s0.players.length >= max) return s0;   // newcomers wait for the next deal
    const name = String(a.name || '').trim().slice(0, 16) || `Player ${s.players.length + 1}`;
    s.players.push({ id: a.id, name, connected: true });
    log(s, `${name} sat down`, a.at);
    return s;
  }
  if (!me) return s0;
  const s = structuredClone(s0);
  if (s.phase === 'lobby') { s.players = s.players.filter(p => p.id !== a.id); return s; }
  s.players.find(p => p.id === a.id).connected = false;
  return s;
}
