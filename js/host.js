// The host: owns the whole table (hands and pile included), applies moves one at a time, and runs
// the clocks — the calling window, and how long a reveal stays on screen.
import { newGame, apply, publicView } from './game.js';
import { makeKeys } from './seal.js';

const REVEAL_MS = 5000;
const SAVE = 'bluff.host';

export class Host {
  // publish({ view, hands }) sends the table out; render(view) draws the screen.
  constructor({ render, publish = () => {}, code, fresh = false, now = () => Date.now() }) {
    this.render = render; this.publish = publish; this.now = now;
    const saved = fresh || code ? null : loadSaved();
    this.state = saved?.state || newGame(code || makeCode());
    this.keys = saved?.keys || null;
    this.known = saved?.known || {};
    this.resumed = !!saved;
    this.queue = Promise.resolve();
    this.timer = null;
  }

  async init() { if (!this.keys) this.keys = await makeKeys(); this.set(this.state); return this; }

  set(s) {
    this.state = s;
    const view = publicView(s);
    this.render(view);
    this.publish({ view, hands: s.hands });
    this.save();
    this.clock();
  }
  save() { try { localStorage.setItem(SAVE, JSON.stringify({ state: this.state, keys: this.keys, known: this.knownNow?.() || this.known, at: Date.now() })); } catch {} }

  // Every move goes through here, one at a time.
  dispatch(action) {
    this.queue = this.queue.then(() => {
      const next = apply(this.state, { ...action, at: this.now() });
      if (next !== this.state) this.set(next);
    }).catch(e => console.error(e));
    return this.queue;
  }

  // The window closes by itself when nobody calls; a reveal moves on after a few seconds.
  clock() {
    clearTimeout(this.timer);
    const s = this.state;
    if (s.phase === 'window') {
      const until = s.play.until;
      this.timer = setTimeout(() => { if (this.state.play?.until === until && this.state.phase === 'window') this.dispatch({ type: 'close' }); }, Math.max(0, until - this.now()));
    } else if (s.phase === 'reveal') {
      const n = s.seq;
      this.timer = setTimeout(() => { if (this.state.seq === n && this.state.phase === 'reveal') this.dispatch({ type: 'next' }); }, REVEAL_MS);
    }
  }
}

function loadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE) || 'null');
    if (!d || Date.now() - d.at > 6 * 3600e3) return null;           // older than six hours: start fresh
    if (d.state.phase === 'lobby' && d.state.players.length === 0) return null;
    for (const p of d.state.players) p.connected = false;              // phones will say hello again
    if (d.state.phase === 'window') d.state.play.until = Date.now() + 10000;   // give the table its window back
    return d;
  } catch { return null; }
}

// Consonants only, so it never spells anything.
export function makeCode(n = 4) {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  return Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join('');
}
