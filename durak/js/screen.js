// The big screen: hosts the game and draws the table. It never shows anyone's hand.
import * as game from './game.js';
import { RULES } from './rules.js';
import { SUIT_SIGNS, place } from './game.js';
import { startScreen, $, esc, nameOf } from '../../common/js/screen-kit.js';
import { face, back } from '../../common/js/cards.js';

let centerKey = null, seatsKey = null;
const dealing = (v) => v.players.find(p => p.connected);
const playerOf = (v, id) => v.players.find(p => p.id === id);
const openCount = (v) => v.table.filter(t => !t.beat).length;
const cardsWord = (n) => `${n} card${n === 1 ? '' : 's'}`;

function draw(v, kit) {
  const att = playerOf(v, v.attacker), def = playerOf(v, v.defender);
  switch (v.phase) {
    case 'lobby': {
      const here = v.players.filter(p => p.connected).length;
      kit.setNow(here < 2 ? 'Waiting for players' : 'Ready to deal', here < 2 ? `${here} here — two to six to play` : `${dealing(v).name} presses Deal, or press Enter here`);
      break;
    }
    case 'attack':
      if (!v.table.length) {
        // Nothing on the table yet: the attacker leads. If their phone is gone, the screen can move on.
        kit.setNow(`${att.name} attacks ${def.name}`, att.connected ? 'leading the first card' : 'their phone is away',
          att.connected ? null : { label: 'Skip', onClick: () => kit.dispatch({ type: 'skip' }) });
      } else if (openCount(v)) {
        kit.setNow(`${att.name} attacks ${def.name}`, `${def.name} has ${cardsWord(openCount(v))} to beat${def.connected ? '' : ' · their phone is away'}`,
          def.connected ? null : { label: 'They take', onClick: () => kit.dispatch({ type: 'forcetake' }) });
      } else {
        kit.setNow(`${def.name} beat everything — throw in more?`, 'tap Done on your phone if you have nothing');
      }
      break;
    case 'taking': kit.setNow(`${def.name} takes the cards`, 'the others can still throw in'); break;
    case 'over':
      kit.setNow(v.durak ? `${nameOf(v, v.durak)} is the durak` : v.ending === 'short' ? 'Game over' : 'No durak — a draw', 'press N to play again');
      break;
  }
  drawSeats(v, kit);
  if (v.phase !== 'lobby') drawCenter(v); else centerKey = null;
}

function drawSeats(v, kit) {
  const key = JSON.stringify([v.players, v.attacker, v.defender, v.phase, v.durak, v.done]);
  if (key === seatsKey) return;
  seatsKey = key;
  const playing = v.phase === 'attack' || v.phase === 'taking';
  kit.drawSeats(v, (p) => {
    const role = !playing ? '' : p.id === v.attacker ? 'attacks' : p.id === v.defender ? (v.phase === 'taking' ? 'takes' : 'defends') : '';
    let sub = v.phase === 'lobby' ? (p === dealing(v) ? 'deals' : 'seated')
      : p.place ? `out (${place(p.place)})`
      : v.durak === p.id ? 'the durak'
      : cardsWord(p.cards);
    if (playing && v.done.includes(p.id)) sub += ' · done';
    return {
      fan: v.phase === 'lobby' ? 0 : p.cards,
      cls: [p.id === v.attacker && playing ? 'cur' : '', role === 'defends' ? 'def' : '', role === 'takes' || v.durak === p.id ? 'takes' : '', p.place ? 'won' : ''].join(' '),
      badge: role ? `<div class="role ${role}">${role}</div>` : '',
      sub,
    };
  });
}

// The stock: a few backs, with the trump card turned sideways underneath. Once the stock is gone,
// only the trump suit is left to name.
function stockHTML(v) {
  const sign = SUIT_SIGNS[v.trumpSuit], red = v.trumpSuit === 'H' || v.trumpSuit === 'D';
  const backs = Math.min(Math.max(v.stock - 1, 0), 5);
  return `<div class="stock">
      ${v.stock ? `<div class="stack">
        ${face(v.trump, 'trumpcard')}
        ${Array.from({ length: backs }, (_, k) => back().replace('class="card', `style="transform: translate(${-k * 1.5}px, ${-k * 1.5}px)" class="card`)).join('')}
      </div>` : `<div class="bigsuit ${red ? 'red' : ''}">${sign}</div>`}
      <div class="trumps">Trumps <span class="${red ? 'red' : ''}">${sign}</span></div>
      <div class="pilecount">${v.stock ? `${v.stock} in the stock` : 'The stock is gone'}${v.discard ? `<br>${v.discard} thrown away` : ''}</div>
    </div>`;
}

// Each attack card with the card that beat it lying on top, a little down and to the right.
// An empty table names who leads against whom.
function pairsHTML(v) {
  const left = v.until ? Math.max(0, v.until - Date.now()) : 0;
  const timer = v.until ? `<div class="timer"><i style="animation-duration:${left}ms"></i></div>` : '';
  if (!v.table.length) {
    return `<div class="tablecol"><div class="claim"><div class="kicker">${esc(nameOf(v, v.attacker))} leads against</div><div class="rank">${esc(nameOf(v, v.defender))}</div>
      <div class="pilecount">up to ${v.limit} attack card${v.limit === 1 ? '' : 's'} this round</div></div></div>`;
  }
  return `<div class="tablecol"><div class="pairs">${v.table.map(t => `<div class="pair ${t.beat ? 'beaten' : 'open'}">
      ${face(t.attack, 'att')}${t.beat ? face(t.beat, 'cover') : ''}</div>`).join('')}</div>
      <div class="pilecount">${v.table.length} of ${v.limit} attack card${v.limit === 1 ? '' : 's'}</div>${timer}</div>`;
}

function drawCenter(v) {
  const key = JSON.stringify([v.phase, v.table, v.attacker, v.defender, v.limit, v.stock, v.trump, v.until, v.durak, v.ending, v.out, v.discard, v.round, v.players.length]);
  if (key === centerKey) return;
  centerKey = key;
  let html = '';
  if (v.phase === 'over') {
    const order = v.out.map(id => esc(nameOf(v, id))).join(', ');
    html = v.durak
      ? `<div class="kicker">Last one holding cards</div><div class="big-line">${esc(nameOf(v, v.durak))} is the durak</div>
         <div class="sub-line">Durak is Russian for “fool”.${order ? ` Out, in order: ${order}.` : ''} Press N to deal again.</div>`
      : `<div class="kicker">${v.ending === 'short' ? 'Not enough players left' : 'The last cards went at once'}</div>
         <div class="big-line">${v.ending === 'short' ? 'Game over' : 'No durak'}</div>
         <div class="sub-line">${v.ending === 'short' ? '' : 'A draw. '}${order ? `Out, in order: ${order}. ` : ''}Press N to deal again.</div>`;
  } else {
    html = `<div class="board">${stockHTML(v)}${pairsHTML(v)}</div>`;
  }
  $('center').innerHTML = html;
  $('center').className = 'phase-' + v.phase;
}

await startScreen({ game, rules: RULES, draw, removeNote: (v) => ', and their cards are thrown away' + (v.phase === 'attack' || v.phase === 'taking' ? ' (if they’re attacking or defending, this round is called off)' : '') });
