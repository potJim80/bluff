// The phone: one player's hand, grouped by good, with a number to tap for each. Speed matters:
// one tap makes an offer. Above the hand: your open offer, and who is waiting with how many.
import * as game from './game.js';
import { RULES } from './rules.js';
import { GOODS, MAX_OFFER, isGood, goodOf, goodInfo } from './game.js';
import { startPhone, esc } from '../../common/js/phone-kit.js';
import { goodCard, cardName, describe } from './goods.js';

// The Bull and the Bear can ride along with the next offer: these are the two toggles.
const riders = { bull: false, bear: false };
let lastHand = null, lastRound = null, ticking = null, deadline = null, deadlineFor = null;
const num = (n) => n < 0 ? `−${-n}` : `${n}`;
const cardsWord = (n) => `${n} card${n === 1 ? '' : 's'}`;

// "Traded! You got 3 Coffee", big and clear, at the bottom of the screen.
function tradeFlash(html) {
  for (const old of document.querySelectorAll('.flash.traded')) old.remove();
  const d = document.createElement('div');
  d.className = 'flash traded';
  d.innerHTML = html;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

// Our hand changed in the middle of a round: that was a trade. Say what came in.
function noticeTrade(v, hand) {
  if (hand && lastHand && v.round === lastRound && hand.join() !== lastHand.join()) {
    const got = hand.filter(c => !lastHand.includes(c));
    if (got.length) tradeFlash(`<b>Traded!</b> You got ${esc(describe(got))}`);
  }
  lastHand = hand ? hand.slice() : null;
  lastRound = v.round;
}

function draw(ctx) {
  const { state: v, secret, me, view, send } = ctx;
  const hand = secret?.hand || null, mine = secret?.offer || null;
  const nameOf = (id) => v.players.find(p => p.id === id)?.name || '?';
  ctx.setTitle(`${ctx.player.name} · ${num(ctx.player.score)} pts`);
  noticeTrade(v, hand);
  for (const x of ['bull', 'bear']) if (!hand?.includes(x)) riders[x] = false;
  if (v.phase !== 'open') { clearInterval(ticking); ticking = null; }

  // Who is waiting with how many: so you know which number trades at once.
  const waiting = (n) => v.market.find(o => o.count === n && o.by !== me);
  const marketHTML = () => `<div><div class="kicker">Waiting to trade</div><div class="pmarket">${[1, 2, 3, 4].map(n => {
    const o = v.market.find(m => m.count === n);
    return `<div class="pm ${o ? (o.by === me ? 'me' : 'busy') : ''}"><b>${n}</b><span>${o ? (o.by === me ? 'you' : esc(nameOf(o.by))) : '—'}</span></div>`;
  }).join('')}</div></div>`;

  // One row per good: the card, how many, and a number to tap for each count you can offer.
  // live = false before trading starts: the numbers are there but can't be tapped yet.
  const rowsHTML = (live) => {
    if (!hand) return `<p class="hint">Your cards are on their way…</p>`;
    const extra = (riders.bull ? 1 : 0) + (riders.bear ? 1 : 0);
    const rows = [];
    for (const g of GOODS) {
      const cards = hand.filter(c => isGood(c) && goodOf(c) === g.id);
      if (!cards.length) continue;
      const can = Math.min(cards.length, MAX_OFFER - extra);
      const chips = [1, 2, 3, 4].map(n => n > cards.length ? '<span class="chip-gap"></span>'
        : `<button class="chip ${live && n <= can && waiting(n + extra) ? 'hot' : ''}" data-good="${g.id}" data-n="${n}" ${live && n <= can ? '' : 'disabled'}>${n}${extra && live && n <= can ? `<small>+${extra}</small>` : ''}</button>`).join('');
      rows.push(`<div class="grow">${goodCard(cards[0], 'mini')}<div class="ginfo"><div class="gn">${g.name}</div><div class="gc"><b>×${cards.length}</b> · worth ${g.value}</div></div><div class="chips">${chips}</div></div>`);
    }
    for (const x of ['bull', 'bear']) {
      if (!hand.includes(x)) continue;
      const other = x === 'bull' ? 'bear' : 'bull';
      const alone = 1 + (riders[other] ? 1 : 0);
      rows.push(`<div class="grow special">${goodCard(x, 'mini')}<div class="ginfo"><div class="gn">${cardName(x)}</div><div class="gc">${x === 'bear' ? 'stops your corner · −20' : 'eight and the Bull corner · −20'}</div></div>
        <div class="chips"><button class="toggle ${riders[x] ? 'on' : ''}" data-rider="${x}" ${live ? '' : 'disabled'}>+ ${cardName(x)}</button>
        <button class="chip ${live && waiting(alone) ? 'hot' : ''}" data-alone="${x}" ${live ? '' : 'disabled'}>${alone}</button></div></div>`);
    }
    const along = describe(['bull', 'bear'].filter(x => riders[x]));
    const note = extra ? `<p class="hint rider-note">${along[0].toUpperCase() + along.slice(1)} ride${extra > 1 ? '' : 's'} along with your next offer.</p>` : '';
    return `${note}<div class="rows">${rows.join('')}</div>`;
  };

  switch (v.phase) {
    case 'open': {
      if (deadlineFor !== v.until) { deadlineFor = v.until; deadline = Date.now() + Math.max(0, v.until - (v.stamp || Date.now())); }
      view.innerHTML = `<div class="ask"><div class="kicker">Round ${v.round} · get ready</div><div class="rank" id="count"></div></div>
        <p class="hint center">Trading starts in a moment. Look at your cards.</p>${rowsHTML(false)}`;
      const show = () => { const el = view.querySelector('#count'); if (!el) return; const left = Math.ceil((deadline - Date.now()) / 1000); el.textContent = left > 0 ? `Ready… ${left}` : 'Trade!'; };
      show();
      clearInterval(ticking); ticking = setInterval(show, 200);
      return;
    }

    case 'trading': {
      const box = mine
        ? `<div class="offerbox live"><div class="obtop"><div><div class="kicker">Your offer</div><div class="oline">${cardsWord(mine.length)} · ${esc(describe(mine))}</div></div>
            <button class="ghost small" id="cancel">Cancel</button></div><p>Waiting for someone else to offer ${mine.length}.</p></div>`
        : `<div class="offerbox"><div class="kicker">Tap a number to offer that many</div><p>A gold number trades at once: someone is already waiting with that many.</p></div>`;
      view.innerHTML = `${box}${marketHTML()}${rowsHTML(true)}`;
      const offer = (cards) => { riders.bull = riders.bear = false; send({ type: 'offer', cards }); };
      const ride = () => ['bull', 'bear'].filter(x => riders[x]);
      for (const b of view.querySelectorAll('.chip[data-good]')) b.onclick = () => {
        const cards = hand.filter(c => isGood(c) && goodOf(c) === b.dataset.good).slice(0, +b.dataset.n);
        offer([...cards, ...ride()]);
      };
      for (const b of view.querySelectorAll('.chip[data-alone]')) b.onclick = () => {
        const x = b.dataset.alone, other = x === 'bull' ? 'bear' : 'bull';
        offer(riders[other] ? [x, other] : [x]);
      };
      for (const b of view.querySelectorAll('[data-rider]')) b.onclick = () => { riders[b.dataset.rider] = !riders[b.dataset.rider]; ctx.rerender(); };
      view.querySelector('#cancel') && (view.querySelector('#cancel').onclick = () => send({ type: 'cancel' }));
      return;
    }

    case 'scored': {
      const r = v.result, won = r.winner === me, g = goodInfo(r.good).name;
      const mid = (r.cards.length - 1) / 2;
      const lost = r.penalties[me];
      const why = [r.bear === me ? 'the Bear' : '', r.bull === me ? 'the Bull' : ''].filter(Boolean).join(' and ');
      view.innerHTML = `<div class="ask"><div class="kicker">Round ${v.round} · ${r.double ? 'double corner' : 'corner'}</div>
          <h1 class="center ${won ? 'true' : ''}">${won ? `You cornered ${g}!` : `${esc(nameOf(r.winner))} cornered ${g}`}</h1></div>
        <div class="minihand">${r.cards.map((c, k) => goodCard(c).replace('class="card', `style="--o:${k - mid}" class="card`)).join('')}</div>
        <p class="center you">${won ? `+${r.points} for you.` : `${esc(nameOf(r.winner))} scores ${r.points}. ${lost ? `You lose ${-lost} for holding ${why}.` : 'You lose nothing.'}`}</p>
        ${ctx.others()}
        <p class="hint center">The next round deals itself in a moment.</p>`;
      return;
    }

    case 'over': {
      const won = v.winner === me;
      const r = v.result;
      const last = r ? ` Last round: ${r.winner === me ? 'you' : esc(nameOf(r.winner))} cornered ${goodInfo(r.good).name}, +${r.points}.` : '';
      view.innerHTML = `<h1>${won ? 'You win.' : esc(nameOf(v.winner)) + ' wins.'}</h1><p>First to ${v.target} points.${last}</p>${ctx.others()}
        ${ctx.isDealer ? `<button class="big" id="again">Deal again</button>` : `<p class="hint">${esc(v.players.find(p => p.connected)?.name || '')} deals the next game.</p>`}`;
      view.querySelector('#again') && (view.querySelector('#again').onclick = () => send({ type: 'start' }));
      return;
    }
  }
}

startPhone({ game, rules: RULES, draw, count: (q) => `${num(q.score)}` });
