// The phone: one player's hand and buttons. Shows whatever the moment asks of them.
//   Attacking: tap a card and it goes on the table.
//   Defending: tap one of your cards, then the attack card it covers (if it can only cover one,
//   the first tap is enough).
import * as game from './game.js';
import { RULES } from './rules.js';
import { beats, sortHand, rankOf, plural, place, SUIT_SIGNS } from './game.js';
import { startPhone, esc, flash } from '../../common/js/phone-kit.js';
import { face } from '../../common/js/cards.js';

let picked = null, pickKey = '', deadline = null, deadlineFor = null;

// "Sevens or Kings", "Sevens, Tens or Kings"
const orList = (words) => words.length < 2 ? words.join('') : words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];

function draw(ctx) {
  const { state: v, me, view, send } = ctx;
  const hand = ctx.secret?.hand ? sortHand(ctx.secret.hand, v.trumpSuit) : null;
  const nameOf = (id) => v.players.find(p => p.id === id)?.name || '?';
  const mine = v.players.find(p => p.id === me);
  ctx.setTitle(`${ctx.player.name}${hand?.length && v.phase !== 'over' ? ` · ${hand.length} card${hand.length === 1 ? '' : 's'}` : ''}`);

  // A change on the table or in the hand drops a half-made defence.
  const pk = JSON.stringify([hand, v.table, v.phase]);
  if (pk !== pickKey) { pickKey = pk; picked = null; }

  // The running throw-in timer, measured against this phone's own clock.
  let timer = '';
  if (v.until) {
    if (deadlineFor !== v.until) { deadlineFor = v.until; deadline = Date.now() + Math.max(0, v.until - (v.stamp || Date.now())); }
    timer = `<div class="timer"><i style="animation-duration:${Math.max(0, deadline - Date.now())}ms"></i></div>`;
  }

  const sign = SUIT_SIGNS[v.trumpSuit] || '';
  const red = v.trumpSuit === 'H' || v.trumpSuit === 'D';
  const info = `<p class="hint trumpline">Trumps <b class="${red ? 'red' : ''}">${sign}</b> · ${v.stock ? `${v.stock} in the stock` : 'stock gone'}</p>`;
  const counts = `<ol class="others">${v.players.map(q => `<li class="${q.id === v.attacker && v.phase !== 'over' ? 'cur' : ''} ${q.id === me ? 'me' : ''} ${q.connected ? '' : 'away'}">
      <span>${esc(q.name)}${q.id === v.defender && v.phase !== 'over' ? ' <i>defends</i>' : ''}</span>
      <b>${q.place ? `out (${place(q.place)})` : v.durak === q.id ? 'durak' : q.cards}</b></li>`).join('')}</ol>`;

  if (v.phase === 'over') {
    const youDurak = v.durak === me;
    const head = v.durak ? (youDurak ? 'You’re the durak.' : `${esc(nameOf(v.durak))} is the durak.`) : v.ending === 'short' ? 'Game over.' : 'No durak — a draw.';
    const line = youDurak ? 'Last one holding cards. Durak means “fool”.'
      : mine?.place ? `You got out ${place(mine.place)} — safe.`
      : v.ending === 'short' ? 'Not enough players left to carry on.' : 'Everyone ran out of cards at once.';
    view.innerHTML = `<h1 class="${youDurak ? 'lie' : ''}">${head}</h1><p>${line}</p>${counts}
      ${ctx.isDealer ? `<button class="big" id="again">Deal again</button>` : `<p class="hint">${esc(v.players.find(p => p.connected)?.name || '')} deals the next game.</p>`}`;
    view.querySelector('#again') && (view.querySelector('#again').onclick = () => send({ type: 'start' }));
    return;
  }

  // Which of my cards may go down now, and what tapping one does.
  const iDefend = v.defender === me, iAttack = v.attacker === me;
  const out = !!mine?.place;
  const open = v.table.map((t, i) => t.beat ? -1 : i).filter(i => i >= 0);
  const targetsFor = (c) => open.filter(i => beats(c, v.table[i].attack, v.trumpSuit));
  const ranks = new Set(v.table.flatMap(t => t.beat ? [t.attack[0], t.beat[0]] : [t.attack[0]]));
  const room = v.table.length < v.limit;
  const mayThrow = (c) => (v.phase === 'attack' || v.phase === 'taking') && !iDefend && !out && room && ranks.has(c[0]);
  let playable = () => false;
  if (v.phase === 'attack' && !v.table.length) playable = () => iAttack;
  else if (v.phase === 'attack' && iDefend) playable = (c) => targetsFor(c).length > 0;
  else playable = mayThrow;

  // The table, small: attack cards with their covers on top. While a defender has a card picked,
  // the attack cards it can cover light up and can be tapped.
  const pickTargets = picked ? targetsFor(picked) : [];
  const tableHTML = v.table.length ? `<div class="pairs mini">${v.table.map((t, i) => `<div class="pair ${t.beat ? 'beaten' : 'open'} ${pickTargets.includes(i) ? 'target' : ''}" data-t="${i}">
      ${face(t.attack, 'att')}${t.beat ? face(t.beat, 'cover') : ''}</div>`).join('')}</div>` : '';

  const handHTML = !hand ? `<p class="hint">Your cards are on their way…</p>`
    : hand.length ? `<div class="hand pick">${hand.map(c => face(c, `${playable(c) ? 'mark' : 'off'} ${c === picked ? 'sel' : ''}`)).join('')}</div>`
    : '';

  // What this player is being asked, in one line.
  let kicker = '', head = '', note = '', dock = '';
  const att = nameOf(v.attacker), def = nameOf(v.defender);
  if (out) {
    kicker = 'Out'; head = 'Out — you’re safe';
    note = `You got out ${place(mine.place)}. Watch who ends up the durak.`;
  } else if (v.phase === 'taking') {
    if (iDefend) { kicker = 'You take'; head = 'You’re picking up the cards'; note = 'The others can still throw in a few more.'; }
    else {
      const mine2 = hand ? [...new Set(hand.filter(mayThrow).map(c => rankOf(c)))].sort((a, b) => a - b) : [];
      kicker = `${esc(def)} takes the cards`;
      head = mine2.length ? `You can throw in ${orList(mine2.map(plural))}` : room ? 'Nothing to throw in' : 'The table is full';
      note = mine2.length ? 'Whatever you add, they pick up too.' : '';
      dock = v.done.includes(me) ? `<p class="hint center">Waiting for the others…</p>` : `<button class="big ghost" id="done">Done</button>`;
    }
  } else if (!v.table.length) {
    if (iAttack) { kicker = `You attack ${esc(def)}`; head = 'Lead any card'; note = 'Tap a card to put it on the table.'; }
    else if (iDefend) { kicker = `${esc(att)} attacks`; head = `You’re defending against ${esc(att)}`; note = `Waiting for ${esc(att)} to lead.`; }
    else { kicker = 'Waiting'; head = `${esc(att)} attacks ${esc(def)}`; note = 'Once a card is down you can throw in more of the same rank.'; }
  } else if (iDefend) {
    if (open.length) {
      kicker = `${open.length} card${open.length === 1 ? '' : 's'} to beat`; head = `You’re defending against ${esc(att)}`;
      note = picked ? 'Now tap the card on the table to cover.' : hand?.some(playable) ? 'Tap a card, then the card it covers. Same suit and higher, or a trump.' : 'Nothing in your hand can beat that.';
      dock = `<button class="big ghost takebtn" id="take">Take the cards</button>`;
    } else { kicker = 'All beaten'; head = 'You beat everything'; note = 'Waiting to see if they throw in more.'; }
  } else {
    const mine2 = hand ? [...new Set(hand.filter(mayThrow).map(c => rankOf(c)))].sort((a, b) => a - b) : [];
    kicker = `${esc(att)} attacks ${esc(def)}`;
    head = mine2.length ? `You can throw in ${orList(mine2.map(plural))}` : room ? 'Nothing to throw in' : 'The table is full';
    if (open.length) note = `${esc(def)} is defending. Tap a card to add it.`;
    else {
      note = `${esc(def)} beat everything. Add more, or tap Done.`;
      dock = v.done.includes(me) ? `<p class="hint center">Waiting for the others…</p>` : `<button class="big ghost" id="done">Done</button>`;
    }
  }

  view.innerHTML = `<div class="ask"><div class="kicker">${kicker}</div><h2 class="role-line">${head}</h2>${timer}</div>
    ${tableHTML}${info}${handHTML}<p class="hint">${note}</p>
    ${dock ? `<div class="dock">${dock}</div>` : counts}`;

  // ---- taps ----
  for (const el of view.querySelectorAll('.hand .card')) el.onclick = () => {
    const c = el.dataset.card;
    if (!playable(c)) return flash(iDefend && v.phase === 'attack' && v.table.length ? 'That card can’t beat anything on the table.' : 'You can’t play that card now.');
    if (iDefend && v.phase === 'attack' && v.table.length) {
      const ts = targetsFor(c);
      if (ts.length === 1) { picked = null; return send({ type: 'beat', card: c, target: ts[0] }); }
      picked = picked === c ? null : c;
      return ctx.rerender();
    }
    send({ type: 'attack', card: c });
  };
  for (const el of view.querySelectorAll('.pairs.mini .pair')) el.onclick = () => {
    if (!picked) return;
    const i = +el.dataset.t;
    if (!pickTargets.includes(i)) return flash('Your card can’t cover that one.');
    const c = picked; picked = null;
    send({ type: 'beat', card: c, target: i });
  };
  view.querySelector('#take') && (view.querySelector('#take').onclick = () => send({ type: 'take' }));
  view.querySelector('#done') && (view.querySelector('#done').onclick = () => send({ type: 'done' }));
}

startPhone({ game, rules: RULES, draw, count: (q) => q.place ? `out (${place(q.place)})` : q.cards });
