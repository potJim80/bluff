// The phone: one player's hand and buttons. Shows whatever the moment asks of them.
import * as game from './game.js';
import { RULES } from './rules.js';
import { plural, claimText, rankOf } from './game.js';
import { startPhone, esc, flash } from '../../common/js/phone-kit.js';
import { face } from '../../common/js/cards.js';

let selected = new Set(), handKey = '', deadline = null, deadlineFor = null;

function draw(ctx) {
  const { state, secret: hand, me, view: v, send } = ctx;
  const nameOf = (id) => state.players.find(p => p.id === id)?.name || '?';
  ctx.setTitle(`${ctx.player.name}${hand ? ` · ${hand.length} card${hand.length === 1 ? '' : 's'}` : ''}`);
  // A new hand (dealt, or the pile came our way): forget what was selected.
  const hk = (hand || []).join();
  if (hk !== handKey) { handKey = hk; selected.clear(); }

  const cur = state.players[state.turn];
  const mine = cur?.id === me;
  const counts = `<ol class="others">${state.players.map((q, i) => `<li class="${i === state.turn && state.phase !== 'over' ? 'cur' : ''} ${q.id === me ? 'me' : ''}"><span>${esc(q.name)}</span><b>${q.cards}</b></li>`).join('')}</ol>
    ${state.phase !== 'over' ? `<p class="hint pilenote">${state.pile} in the pile</p>` : ''}`;

  // mark: a rank to outline (the one being claimed), so you can see what you hold of it.
  const handHTML = (pickable, mark = -1) => !hand ? `<p class="hint">Your cards are on their way…</p>`
    : `<div class="hand ${pickable ? 'pick' : ''}">${hand.map((c, i) => face(c, `${selected.has(i) ? 'sel' : ''} ${rankOf(c) === mark ? 'mark' : ''}`).replace('class="card', `data-i="${i}" class="card`)).join('')}</div>`;

  switch (state.phase) {
    case 'turn':
      if (mine) {
        const n = selected.size, max = 4 * state.decks;
        v.innerHTML = `<div class="ask"><div class="kicker">Your turn · put down</div><div class="rank">${plural(state.rank, 2)}</div></div>
          ${handHTML(true, state.rank)}
          <div class="dock"><button class="big" id="play" ${n ? '' : 'disabled'}>${n ? `Put down ${n} — “${claimText(state.rank, n)}”` : `Pick 1 to ${max} cards`}</button></div>`;
        for (const el of v.querySelectorAll('.hand.pick .card')) el.onclick = () => {
          const i = +el.dataset.i;
          if (selected.has(i)) selected.delete(i);
          else if (selected.size < max) selected.add(i);
          else return flash(`At most ${max} at a time.`);
          ctx.rerender();
        };
        v.querySelector('#play').onclick = () => { if (selected.size) send({ type: 'play', cards: [...selected].map(i => hand[i]) }); };
      } else {
        v.innerHTML = `<div class="ask"><div class="kicker">${esc(cur.name)} puts down</div><div class="rank dim">${plural(state.rank, 2)}</div></div>${handHTML(false, state.rank)}${counts}`;
      }
      return;

    case 'window': {
      const pl = state.play;
      if (deadlineFor !== pl.until) { deadlineFor = pl.until; deadline = Date.now() + Math.max(0, pl.until - (state.stamp || Date.now())); }
      const left = Math.max(0, deadline - Date.now());
      const timer = `<div class="timer"><i style="animation-duration:${left}ms"></i></div>`;
      if (pl.by === me) {
        v.innerHTML = `<div class="ask"><div class="kicker">You said</div><div class="rank">${claimText(pl.rank, pl.count)}</div>${timer}</div><h2 class="center">Will anyone call it?</h2>${handHTML(false)}`;
      } else if (pl.passes.includes(me)) {
        v.innerHTML = `<div class="ask"><div class="kicker">${esc(nameOf(pl.by))} says</div><div class="rank">${claimText(pl.rank, pl.count)}</div>${timer}</div><h2 class="center">You let it go.</h2>${handHTML(false, pl.rank)}`;
      } else {
        v.innerHTML = `<div class="ask"><div class="kicker">${esc(nameOf(pl.by))} says</div><div class="rank">${claimText(pl.rank, pl.count)}</div>${timer}</div>
          <button class="huge call" id="call">Bluff!</button>
          <button class="big ghost" id="pass">Let it go</button>
          ${handHTML(false, pl.rank)}
          <p class="hint">A gold line marks your ${plural(pl.rank, 2)}, if you have any.</p>`;
        v.querySelector('#call').onclick = () => send({ type: 'call' });
        v.querySelector('#pass').onclick = () => send({ type: 'pass' });
      }
      return;
    }

    case 'reveal': {
      const r = state.reveal;
      const verdict = r.truthful ? 'It was true.' : 'Caught bluffing!';
      const you = r.taker === me ? `You take the pile — ${r.took} card${r.took === 1 ? '' : 's'}.` : `${esc(nameOf(r.taker))} takes the pile.`;
      v.innerHTML = `<div class="ask"><div class="kicker">${esc(nameOf(r.caller))} called it on ${esc(r.by === me ? 'you' : nameOf(r.by))}</div></div>
        <div class="revealed">${r.cards.map(c => face(c)).join('')}</div>
        <h1 class="center ${r.truthful ? 'true' : 'lie'}">${verdict}</h1><p class="center">${you}</p>`;
      return;
    }

    case 'over': {
      const won = state.winner === me;
      v.innerHTML = `<h1>${won ? 'You win.' : esc(nameOf(state.winner)) + ' wins.'}</h1><p>${won ? 'Out of cards, and nobody caught you.' : 'Out of cards first.'}</p>${counts}
        ${ctx.isDealer ? `<button class="big" id="again">Deal again</button>` : `<p class="hint">${esc(state.players.find(p => p.connected)?.name || '')} deals the next game.</p>`}`;
      v.querySelector('#again') && (v.querySelector('#again').onclick = () => send({ type: 'start' }));
      return;
    }
  }
}

startPhone({ game, rules: RULES, draw, count: (q) => q.cards });
