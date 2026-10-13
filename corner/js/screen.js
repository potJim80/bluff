// The big screen: hosts the game and draws the table. The middle of the felt is the market: who
// is waiting to trade how many cards, and the trades as they happen. It never shows a hand, except
// the winning one once a round is over.
import * as game from './game.js';
import { RULES } from './rules.js';
import { goodInfo } from './game.js';
import { startScreen, $, esc, nameOf } from '../../common/js/screen-kit.js';
import { goodCard, colourOf } from './goods.js';

let centerKey = null, seatsKey = null, extraKey = null, ticking = null, goShown = null;
const seen = new Set();                 // trades already on screen, so only new ones light up
const dealing = (v) => v.players.find(p => p.connected);
const goodName = (id) => goodInfo(id)?.name || '?';
const signed = (n) => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';      // a real minus sign
const num = (n) => n < 0 ? `−${-n}` : `${n}`;

function draw(v, kit) {
  switch (v.phase) {
    case 'lobby': {
      const here = v.players.filter(p => p.connected).length;
      kit.setNow(here < 3 ? 'Waiting for players' : 'Ready to deal', here < 3 ? `${here} here — three or more to play` : `${dealing(v).name} presses Deal, or press Enter here`);
      break;
    }
    case 'open': kit.setNow(`Round ${v.round}`, 'get ready to trade'); break;
    case 'trading': kit.setNow('Trade!', 'offer the same number as someone else, and you swap'); break;
    case 'scored': kit.setNow(`${nameOf(v, v.result.winner)} cornered ${goodName(v.result.good)}`, 'the next round deals itself in a moment'); break;
    case 'over': kit.setNow(`${nameOf(v, v.winner)} wins`, 'press N to play again'); break;
  }
  drawSeats(v, kit);
  drawExtra(v, kit);
  if (v.phase !== 'lobby') drawCenter(v); else centerKey = null;
  countdown(v);
}

// Seats: name, card count and score; a badge when they're waiting to trade, or what the round
// just did to their score.
function drawSeats(v, kit) {
  const key = JSON.stringify([v.players, v.phase, v.result?.winner, v.winner]);
  if (key === seatsKey) return;
  seatsKey = key;
  const done = v.phase === 'scored' || v.phase === 'over';
  kit.drawSeats(v, (p) => {
    let badge = '';
    if (v.phase === 'trading' && p.offer) badge = `<span class="obadge">offers ${p.offer}</span>`;
    if (done && v.result) {
      const d = v.result.winner === p.id ? v.result.points : v.result.penalties[p.id] || 0;
      if (d) badge = `<span class="obadge ${d > 0 ? 'plus' : 'minus'}">${signed(d)}</span>`;
    }
    return {
      fan: v.phase === 'lobby' ? 0 : p.cards,
      cls: [v.phase === 'trading' && p.offer ? 'offering' : '', (v.phase === 'over' ? v.winner : done && v.result?.winner) === p.id ? 'won' : ''].join(' '),
      sub: v.phase === 'lobby' ? (p === dealing(v) ? 'deals' : 'seated') : `${p.cards} cards · ${num(p.score)} pts`,
      badge,
    };
  });
}

// The panel on the left: scores, and the goods in play with what each is worth.
function drawExtra(v, kit) {
  const key = JSON.stringify([v.phase === 'lobby', v.players.map(p => [p.name, p.score]), v.goods]);
  if (key === extraKey) return;
  extraKey = key;
  if (v.phase === 'lobby') return kit.setExtra(null);
  const rows = v.players.slice().sort((a, b) => b.score - a.score)
    .map(p => `<div class="row"><span>${esc(p.name)}</span><b>${num(p.score)}</b></div>`).join('');
  const goods = v.goods.map(g => `<div class="gi ${colourOf(g.id)}"><i></i><span>${g.name}</span><b>${g.value}</b></div>`).join('');
  // A big table gets its scores in two columns, so the goods still fit below them.
  kit.setExtra(`<div class="label">Scores · first to ${v.target}</div><div class="scores ${v.players.length > 5 ? 'two' : ''}">${rows}</div>
    <div class="label goods-label">Goods in play</div><div class="goods-list">${goods}</div>`);
}

// "Ready… 3, 2, 1": the big number counts down by itself between publishes.
function countdown(v) {
  clearInterval(ticking); ticking = null;
  if (v.phase !== 'open') return;
  const show = () => {
    const el = $('count'); if (!el) return;
    const left = Math.ceil((v.until - Date.now()) / 1000);
    el.textContent = left > 0 ? left : 'Trade!';
  };
  show();
  ticking = setInterval(show, 200);
}

function marketHTML(v) {
  const slots = [1, 2, 3, 4].map(n => {
    const o = v.market.find(m => m.count === n);
    return `<div class="slot ${o ? 'busy' : ''}"><div class="num">${n}</div><div class="unit">${n === 1 ? 'card' : 'cards'}</div>
      <div class="who">${o ? `<span class="chip-name">${esc(nameOf(v, o.by))}</span>` : '<span class="none">nobody waiting</span>'}</div></div>`;
  }).join('');
  const trades = v.trades.slice(0, 4).map(t => `<div class="trade ${seen.has(t.n) ? '' : 'fresh'}">${esc(nameOf(v, t.a))}<span class="x">⇄</span>${esc(nameOf(v, t.b))}<b>· ${t.count}</b></div>`).join('');
  for (const t of v.trades) seen.add(t.n);
  // "Trade!" flashes up once, when a round's trading starts.
  const go = goShown !== v.round ? '<div class="go-stamp">Trade!</div>' : '';
  goShown = v.round;
  return `${go}<div class="kicker">The market · who is waiting to trade</div><div class="market">${slots}</div>
    <div class="ticker">${trades || '<div class="trade none">No trades yet. Same number, and you swap.</div>'}</div>`;
}

// Who lost points for the Bull and the Bear, in words.
function penaltiesText(v, r) {
  if (r.bull && r.bull === r.bear) return `${esc(nameOf(v, r.bull))} loses 40 for holding the Bull and the Bear.`;
  const parts = [];
  if (r.bear) parts.push(`${esc(nameOf(v, r.bear))} loses 20 for the Bear`);
  if (r.bull) parts.push(`${esc(nameOf(v, r.bull))} loses 20 for the Bull`);
  return parts.length ? parts.join(' · ') + '.' : '';
}

function drawCenter(v) {
  const key = JSON.stringify([v.phase, v.round, v.market, v.trades.map(t => t.n), v.result, v.winner, v.until, v.players.map(p => [p.id, p.name])]);
  if (key === centerKey) return;
  centerKey = key;
  let html = '';
  switch (v.phase) {
    case 'open':
      html = `<div class="kicker">Round ${v.round} · ready…</div><div class="count" id="count"></div>
        <div class="inplay" style="--cw:${Math.min(50, Math.floor((470 - (v.goods.length + 1) * 6) / (v.goods.length + 2)))}px">${v.goods.map(g => goodCard(`${g.id}-1`)).join('')}${goodCard('bull')}${goodCard('bear')}</div>
        <div class="sub-line">${v.goods.length} goods in play, nine of each, plus the Bull and the Bear.</div>`;
      break;
    case 'trading': html = marketHTML(v); break;
    case 'scored': {
      const r = v.result;
      const mid = (r.cards.length - 1) / 2;
      html = `<div class="stamp corner">${r.double ? 'Double corner!' : 'Corner!'}</div>
        <div class="result-line">${esc(nameOf(v, r.winner))} cornered ${goodName(r.good)} <b>+${r.points}</b></div>
        <div class="winhand">${r.cards.map((c, k) => goodCard(c).replace('class="card', `style="--o:${k - mid}" class="card`)).join('')}</div>
        <div class="sub-line">${penaltiesText(v, r)}</div>
        <div class="timer"><i style="animation-duration:${Math.max(0, v.until - Date.now())}ms"></i></div>`;
      break;
    }
    case 'over': {
      const r = v.result;
      const rows = v.players.slice().sort((a, b) => b.score - a.score)
        .map(p => `<span class="${p.id === v.winner ? 'top' : ''}">${esc(p.name)}</span><b class="${p.id === v.winner ? 'top' : ''}">${num(p.score)}</b>`).join('');
      html = `<div class="kicker">First to ${v.target}</div><div class="big-line">${esc(nameOf(v, v.winner))} wins</div>
        <div class="standings">${rows}</div>
        <div class="sub-line">${r ? `Last round: ${esc(nameOf(v, r.winner))} cornered ${goodName(r.good)}${r.double ? ' twice over' : ''}, +${r.points}. ` : ''}Press N to deal again.</div>`;
      break;
    }
  }
  $('center').innerHTML = html;
  $('center').className = 'phase-' + v.phase;
}

await startScreen({ game, rules: RULES, draw, removeNote: () => ', and this round is dealt again without them' });
