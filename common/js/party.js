// The party: one room code and the people at it, kept on the screen across games. Opening another
// game keeps the code, the seats (in the same order) and anyone removed, so the phones just follow.
// Everything lives in the screen's browser storage; games are all on one site, so they share it.

const PARTY = 'party';
const GAME = (id) => 'party.game.' + id;
const IDLE_MS = 12 * 3600e3;          // a party nobody has touched for half a day starts over
const SAVE_MS = 6 * 3600e3;           // a game left mid-way resumes for six hours

export const GAMES = ['bluff', 'corner', 'kemps', 'durak'];

const get = (k) => { try { return JSON.parse(globalThis.localStorage?.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { globalThis.localStorage?.setItem(k, JSON.stringify(v)); } catch {} };
const del = (k) => { try { globalThis.localStorage?.removeItem(k); } catch {} };

// { code, keys, known, banned, roster: [{ id, name }], at } or null
export function loadParty(now = Date.now()) {
  const p = get(PARTY);
  if (!p || typeof p.code !== 'string' || now - (p.at || 0) > IDLE_MS) return null;
  return { known: {}, banned: [], roster: [], ...p };
}
export const saveParty = (p) => put(PARTY, { ...p, at: Date.now() });

// Clears the party and every saved game. The next screen makes a new code.
export function endParty() { del(PARTY); for (const g of GAMES) del(GAME(g)); }

export function loadGame(id, code, now = Date.now()) {
  const d = get(GAME(id));
  if (!d || d.state?.code !== code || now - (d.at || 0) > SAVE_MS) return null;
  return d.state;
}
export const saveGame = (id, state) => put(GAME(id), { state, at: Date.now() });
export const dropGame = (id) => del(GAME(id));

// Consonants only, so it never spells anything.
export function makeCode(n = 4) {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  return Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join('');
}
