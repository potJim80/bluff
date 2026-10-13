// The host: owns the whole table (hands included), applies moves one at a time, and runs the
// clocks. Any game plugs in through its game module:
//
//   INFO                    { id, name, min, max }
//   newGame(code, players)  a fresh table; players arrive as [{ id, name, connected }]
//   apply(state, action)    the next state, or the same object if the move doesn't count
//   publicView(state)       what everyone sees
//   secrets(state)          { id: what only that phone sees }
//   timer(state)            { at, action } when the game should move on by itself, or null
//   resume(state, now)      optional: put a saved table back on its feet after a reload
//   dealProblem(view)       optional: why the cards can't be dealt yet beyond too few players
//                           (e.g. "Kemps needs an even number: 4, 6 or 8"), or null — the phones show it
//
// The party (party.js) outlives any one game: the code, the screen's keys, the phones it knows,
// who sits where and who was removed.
import { makeKeys } from './seal.js';
import { loadParty, saveParty, loadGame, saveGame, makeCode } from './party.js';

export class Host {
  // publish({ view, secret }) sends the table out; render(view) draws the screen.
  constructor({ game, render, publish = () => {}, code, fresh = false, now = () => Date.now() }) {
    this.game = game; this.render = render; this.publish = publish; this.now = now;
    const party = loadParty(now());
    this.party = party && (!code || party.code === code) ? party : { code: code || makeCode(), keys: null, known: {}, banned: [], roster: [] };
    const saved = fresh ? null : loadGame(game.INFO.id, this.party.code, now());
    this.resumed = !!saved;
    this.state = saved ? this.revive(saved) : this.fresh(this.party.roster.map(p => ({ ...p, connected: false })));
    this.queue = Promise.resolve();
    this.timer = null;
  }

  async init() { if (!this.party.keys) this.party.keys = await makeKeys(); this.set(this.state); return this; }
  get keys() { return this.party.keys; }
  get known() { return this.party.known; }

  // A new table for this party; whoever is in the party sits in the same order.
  fresh(players) {
    const s = this.game.newGame(this.party.code, players);
    s.banned = [...new Set([...(s.banned || []), ...this.party.banned])];
    return s;
  }
  revive(s) {
    for (const p of s.players) p.connected = false;              // phones will say hello again
    return this.game.resume ? this.game.resume(s, this.now()) : s;
  }
  // Start this game over (same code, same people).
  reset() { this.set(this.fresh(this.state.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })))); }

  set(s) {
    this.state = s;
    const view = this.game.publicView(s);
    this.render(view);
    this.publish({ view, secret: this.game.secrets(s) });
    this.save();
    this.clock();
  }
  save() {
    const s = this.state;
    Object.assign(this.party, {
      roster: s.players.map(p => ({ id: p.id, name: p.name })),
      banned: [...new Set([...this.party.banned, ...(s.banned || [])])],
      known: this.knownNow?.() || this.party.known,
    });
    saveParty(this.party);
    saveGame(this.game.INFO.id, s);
  }

  // Every move goes through here, one at a time.
  dispatch(action) {
    this.queue = this.queue.then(() => {
      const next = this.game.apply(this.state, { ...action, at: this.now() });
      if (next !== this.state) this.set(next);
    }).catch(e => console.error(e));
    return this.queue;
  }

  // The game says when it moves on by itself (a window closing, a reveal finishing). Any change
  // re-arms the clock from the new state, so a timer never fires on a table that has moved on.
  clock() {
    clearTimeout(this.timer);
    const s = this.state, t = this.game.timer?.(s);
    if (!t) return;
    this.timer = setTimeout(() => { if (this.state === s) this.dispatch(t.action); }, Math.max(0, t.at - this.now()));
  }
}
