// The phone: your four cards, the spread above them, and the two calls. Tap one of yours and one
// in the spread (either order) to swap them.
import * as game from './game.js';
import { RULES } from './rules.js';
import { WORD, IDLE_MS, isKemps, rightCount, pairUp, teamName } from './game.js';
import { startPhone, esc, flash } from '../../common/js/phone-kit.js';
import { face } from '../../common/js/cards.js';

let sel = null;          // the card picked first: { from: 'hand' | 'spread', card }
let pending = null;      // a swap sent but not seen back yet: { give, takeCard, at }
let picking = false;     // the Stop! list of opponents is open
let deadline = null, deadlineFor = null;   // the spread's ten seconds, on this phone's clock
let handFor = '';        // which hand we're on, to forget the picks when new cards come

const badge = (k) => `<span class="team-badge t${k + 1}">${teamName(k)}</span>`;
const letters = (score) => `<span class="letters">${[...WORD].map((L, i) => `<i class="${i < score ? 'lit' : ''}">${L}</i>`).join('')}</span>`;

function draw(ctx) {
  const { state, secret, me, view: v, send } = ctx;
  const nameOf = (id) => state.players.find(p => p.id === id)?.name || '?';
  const myTeam = state.players.find(p => p.id === me)?.team;
  ctx.setTitle(ctx.player.name);

  // New hand or new game: start clean.
  const hf = `${state.round}.${state.handNo}`;
  if (hf !== handFor) { handFor = hf; sel = null; pending = null; picking = false; }
  if (state.phase !== 'swap') { sel = null; picking = false; }

  // Your team and partner, and the letters: yours beside the best of the others.
  const teamLine = () => {
    if (myTeam == null) return '';
    const partner = secret?.partner ?? state.teams[myTeam].members.find(id => id !== me);
    const rivals = state.teams.map((t, k) => ({ k, score: t.score })).filter(t => t.k !== myTeam).sort((a, b) => b.score - a.score);
    const lead = rivals[0];
    return `<div class="teamline">
      <div class="mate">${badge(myTeam)}<span>Partner: <b>${esc(nameOf(partner))}</b></span></div>
      <div class="scores"><div><span class="who">You</span>${letters(state.teams[myTeam].score)}</div>
        ${lead ? `<div class="them"><span class="who">${teamName(lead.k)}</span>${letters(lead.score)}</div>` : ''}</div>
    </div>`;
  };

  switch (state.phase) {
    case 'swap': {
      if (!secret?.hand) { v.innerHTML = `${teamLine()}<p class="hint">Your cards are on their way…</p>`; return; }
      let hand = secret.hand.slice(), spread = state.spread.slice();
      // A swap we sent: did it go through, did someone beat us to the card, or is it still on its way?
      if (pending) {
        if (hand.includes(pending.takeCard)) pending = null;
        else if (!spread.includes(pending.takeCard) || !hand.includes(pending.give) || Date.now() - pending.at > 3000) {
          if (!spread.includes(pending.takeCard)) flash('Someone got that card first.');
          pending = null;
        } else {           // show it swapped already, so the tap feels instant
          hand[hand.indexOf(pending.give)] = pending.takeCard;
          spread[spread.indexOf(pending.takeCard)] = pending.give;
        }
      }
      if (sel && !(sel.from === 'hand' ? hand : spread).includes(sel.card)) sel = null;   // that card has gone

      if (deadlineFor !== state.idleUntil) { deadlineFor = state.idleUntil; deadline = Date.now() + Math.max(0, state.idleUntil - (state.stamp || Date.now())); }
      const left = Math.max(0, Math.min(IDLE_MS, deadline - Date.now()));
      const meDone = state.players.find(p => p.id === me)?.done;
      const partnerName = esc(nameOf(secret.partner));
      const row = (cards, from) => cards.map(c => face(c, sel?.from === from && sel.card === c ? 'sel' : '').replace('class="card', `data-from="${from}" data-c="${c}" class="card`)).join('');
      const hint = isKemps(hand) ? `<p class="signal">Got four of a kind? Signal ${partnerName} — don’t say it.</p>`
        : sel ? `<p class="hint center">${sel.from === 'hand' ? 'Now tap a card in the spread to take it.' : 'Now tap one of yours to give for it.'}</p>`
        : meDone ? `<p class="hint center">Done with these. Swap again any time.</p>`
        : `<p class="hint center">Tap one of yours, then one in the spread, to swap.</p>`;
      const opponents = state.players.filter(p => p.team != null && p.team !== myTeam).sort((a, b) => a.team - b.team);
      const dock = picking
        ? `<div class="picker"><div class="kicker">Stop! Who has four of a kind?</div>
            ${opponents.map(p => `<button class="big pick" data-t="${esc(p.id)}">${badge(p.team)}<span>${esc(p.name)}</span></button>`).join('')}
            <button class="big ghost" id="cancel">Cancel</button></div>`
        : `<div class="calls"><button class="huge kemps" id="kemps">Kemps!</button><button class="huge call" id="stop">Stop!</button></div>`;
      v.innerHTML = `${teamLine()}
        <div class="block"><div class="kicker">The spread · ${state.spreadNo}</div><div class="row spread">${row(spread, 'spread')}</div>
          <div class="timer"><i style="animation-duration:${IDLE_MS}ms;animation-delay:-${IDLE_MS - left}ms"></i></div></div>
        <div class="block"><div class="kicker">Your cards</div><div class="row mine">${row(hand, 'hand')}</div></div>
        ${hint}
        <div class="dock">${picking ? '' : `<button class="big ghost done ${meDone ? 'is-done' : ''}" id="done" ${meDone ? 'disabled' : ''}>${meDone ? 'Done — waiting for new cards' : 'Done with these'}</button>`}${dock}</div>`;

      for (const el of v.querySelectorAll('.row .card')) el.onclick = () => {
        const from = el.dataset.from, card = el.dataset.c;
        if (sel && sel.from !== from) {                    // one from each row: swap them
          const give = from === 'hand' ? card : sel.card, takeCard = from === 'spread' ? card : sel.card;
          sel = null;
          pending = { give, takeCard, at: Date.now() };
          send({ type: 'swap', give, takeCard });
        } else sel = sel?.card === card ? null : { from, card };
        ctx.rerender();
      };
      const on = (id, f) => { const b = v.querySelector('#' + id); if (b) b.onclick = f; };
      on('done', () => send({ type: 'done' }));
      on('kemps', () => send({ type: 'kemps' }));
      on('stop', () => { picking = true; ctx.rerender(); });
      on('cancel', () => { picking = false; ctx.rerender(); });
      for (const b of v.querySelectorAll('.picker .pick')) b.onclick = () => { picking = false; send({ type: 'stop', target: b.dataset.t }); };
      return;
    }

    case 'reveal': {
      const c = state.call, cls = c.correct ? 'true' : 'lie';
      const word = c.kind === 'kemps' ? 'Kemps' : 'Stop';
      const who = (id) => id === me ? 'you' : esc(nameOf(id));
      const ours = c.team === myTeam;
      const score = state.teams[c.team].score;
      const result = c.delta > 0 ? `${ours ? 'Your team gets' : teamName(c.team) + ' gets'} ${WORD[score - 1]}.`
        : c.delta < 0 ? `${ours ? 'Your team loses' : teamName(c.team) + ' loses'} a letter.` : `${ours ? 'Your team' : teamName(c.team)} had no letters to lose.`;
      v.innerHTML = `${teamLine()}
        <div class="ask"><div class="kicker">${c.by === me ? 'You' : esc(nameOf(c.by))} called ${word} on ${who(c.target)}</div></div>
        <div class="revealed">${c.cards.map(card => face(card)).join('')}</div>
        <h1 class="center ${cls}">${c.correct ? 'Right!' : 'Wrong.'}</h1><p class="center">${result}</p>
        <p class="hint center">New cards in a moment.</p>`;
      return;
    }

    case 'over': {
      const w = state.winner;
      const won = w != null && w === myTeam;
      const list = `<ol class="others teams">${state.teams.map((t, k) => `<li class="${k === myTeam ? 'me-team' : ''}"><span>${badge(k)}<span class="names">${t.members.map(id => esc(nameOf(id))).join(' &amp; ')}</span></span>${letters(t.score)}</li>`).join('')}</ol>`;
      v.innerHTML = `<h1>${w == null ? 'Game over.' : won ? 'Your team wins.' : `${teamName(w)} wins.`}</h1>
        <p>${w == null ? '' : `${state.teams[w].members.map(id => esc(nameOf(id))).join(' &amp; ')} spelled KEMPS.`}</p>${list}
        ${ctx.isDealer ? `<button class="big" id="again">Deal again</button>` : `<p class="hint">${esc(state.players.find(p => p.connected)?.name || '')} deals the next game.</p>`}`;
      v.querySelector('#again') && (v.querySelector('#again').onclick = () => send({ type: 'start' }));
      return;
    }
  }
}

// In the lobby: who'd be on which team if the cards were dealt now.
function lobbyNote(state, me) {
  const here = state.players.filter(p => p.connected);
  if (!rightCount(here.length)) return '';
  const name = (id) => esc(state.players.find(p => p.id === id)?.name);
  return `<div class="lobby-teams"><div class="kicker">Teams if dealt now</div>
    <ol class="others teams">${pairUp(here).map((t, k) => `<li class="${t.includes(me) ? 'me-team' : ''}"><span>${badge(k)}<span class="names">${t.map(name).join(' &amp; ')}</span></span></li>`).join('')}</ol>
    <p class="hint">Your partner sits straight across from you.</p></div>`;
}

startPhone({ game, rules: RULES, draw, lobbyNote, count: (q) => q.team != null ? teamName(q.team) : '' });
