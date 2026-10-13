// The big screen: hosts the game and draws the table. It never shows anyone's hand.
import * as game from './game.js';
import { RULES } from './rules.js';
import { plural, claimText } from './game.js';
import { startScreen, $, esc, nameOf } from '../../common/js/screen-kit.js';
import { face, back } from '../../common/js/cards.js';

let centerKey = null, seatsKey = null;
const cur = (v) => v.players[v.turn];
const dealing = (v) => v.players.find(p => p.connected);

function draw(v, kit) {
  const c = cur(v);
  switch (v.phase) {
    case 'lobby': {
      const here = v.players.filter(p => p.connected).length;
      kit.setNow(here < 2 ? 'Waiting for players' : 'Ready to deal', here < 2 ? `${here} here — two or more to play` : `${dealing(v).name} presses Deal, or press Enter here`);
      break;
    }
    case 'turn': kit.setNow(`${c.name}'s turn`, `putting down ${plural(v.rank, 2)}${c.connected ? '' : ' · their phone is away'}`,
      c.connected ? null : { label: 'Skip turn', onClick: () => kit.dispatch({ type: 'skip' }) }); break;
    case 'window': kit.setNow(`${nameOf(v, v.play.by)} says ${claimText(v.play.rank, v.play.count)}`, 'anyone can call Bluff'); break;
    case 'reveal': kit.setNow(v.reveal.truthful ? 'It was true' : 'Caught bluffing', `${nameOf(v, v.reveal.taker)} takes the pile`); break;
    case 'over': kit.setNow(v.winner ? `${nameOf(v, v.winner)} wins` : 'Game over', 'press N to play again'); break;
  }
  drawSeats(v, kit);
  if (v.phase !== 'lobby') drawCenter(v); else centerKey = null;
}

function drawSeats(v, kit) {
  const key = JSON.stringify([v.players, v.turn, v.phase, v.play?.passes, v.play?.by, v.reveal?.taker]);
  if (key === seatsKey) return;
  seatsKey = key;
  const playing = v.phase !== 'lobby' && v.phase !== 'over';
  kit.drawSeats(v, (p, i) => ({
    fan: v.phase === 'lobby' ? 0 : p.cards,
    cls: [playing && i === v.turn ? 'cur' : '', v.winner === p.id ? 'won' : '', v.reveal?.taker === p.id ? 'takes' : ''].join(' '),
    sub: (v.phase === 'lobby' ? (p === dealing(v) ? 'deals' : 'seated') : `${p.cards} card${p.cards === 1 ? '' : 's'}`)
      + (v.phase === 'window' && v.play.by !== p.id && v.play.passes.includes(p.id) ? ' · let it go' : ''),
  }));
}

function pileHTML(count, top = 0) {
  const shown = Math.min(count, 14);
  // Fixed little offsets per position, so the pile doesn't jitter on every redraw.
  const jitter = (k) => `transform: translate(${((k * 37) % 9) - 4}px, ${-k * 1.5}px) rotate(${((k * 53) % 15) - 7}deg)`;
  return `<div class="pile">${Array.from({ length: shown }, (_, k) => back(k >= shown - top ? 'fresh' : '').replace('class="card', `style="${jitter(k)}" class="card`)).join('')}</div>
    <div class="pilecount">${count ? `${count} card${count === 1 ? '' : 's'} in the pile` : 'The pile is empty'}</div>`;
}

function drawCenter(v) {
  const key = JSON.stringify([v.phase, v.rank, v.pile, v.play?.until, v.reveal, v.winner, v.players.length, v.round]);
  if (key === centerKey) return;
  centerKey = key;
  const c = cur(v);
  let html = '';
  switch (v.phase) {
    case 'turn':
      html = `${pileHTML(v.pile)}<div class="claim"><div class="kicker">${esc(c.name)} puts down</div><div class="rank">${plural(v.rank, 2)}</div></div>`;
      break;
    case 'window': {
      const left = Math.max(0, v.play.until - Date.now());
      html = `${pileHTML(v.pile, v.play.count)}<div class="claim"><div class="kicker">${esc(nameOf(v, v.play.by))} says</div><div class="rank">${claimText(v.play.rank, v.play.count)}</div>
        <div class="timer"><i style="animation-duration:${left}ms"></i></div></div>`;
      break;
    }
    case 'reveal': {
      const r = v.reveal;
      html = `<div class="revealed">${r.cards.map((card, k) => face(card, 'flip').replace('class="card', `style="animation-delay:${k * 140}ms" class="card`)).join('')}</div>
        <div class="stamp ${r.truthful ? 'true' : 'lie'}">${r.truthful ? 'True' : 'Bluff!'}</div>
        <div class="sub-line">${esc(nameOf(v, r.caller))} called it on ${esc(nameOf(v, r.by))}. ${esc(nameOf(v, r.taker))} takes ${r.took} card${r.took === 1 ? '' : 's'}.</div>`;
      break;
    }
    case 'over':
      html = `<div class="kicker">Out of cards</div><div class="big-line">${esc(nameOf(v, v.winner))} wins</div><div class="sub-line">Press N to deal again</div>`;
      break;
  }
  $('center').innerHTML = html;
  $('center').className = 'phase-' + v.phase;
}

await startScreen({ game, rules: RULES, draw, removeNote: () => ', and their cards go into the pile' });
