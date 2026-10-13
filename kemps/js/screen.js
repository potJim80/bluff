// The big screen: hosts the game and draws the table. It shows the spread (face up, everyone can
// see it) but never anyone's hand, except the called player's cards after a call.
import * as game from './game.js';
import { RULES } from './rules.js';
import { WORD, IDLE_MS, EVEN_NOTE, rightCount, pairUp, teamName } from './game.js';
import { startScreen, $, esc, nameOf } from '../../common/js/screen-kit.js';
import { face } from '../../common/js/cards.js';

let centerKey = null, seatsKey = null, extraKey = null;
let lastSpread = [], lastSpreadId = '';      // to animate only the cards that just arrived

const here = (v) => v.players.filter(p => p.connected);
const dealing = (v) => v.players.find(p => p.connected);
// A team's members by name (anyone removed since is left out).
const members = (v, k) => v.teams[k].members.filter(id => v.players.some(p => p.id === id)).map(id => esc(nameOf(v, id))).join(' &amp; ');
const badge = (k) => `<span class="team-badge t${k + 1}">${teamName(k)}</span>`;
// K-E-M-P-S, the first `score` letters lit.
const letters = (score) => `<span class="letters">${[...WORD].map((L, i) => `<i class="${i < score ? 'lit' : ''}">${L}</i>`).join('')}</span>`;
const callWord = (c) => c.kind === 'kemps' ? 'Kemps' : 'Stop';

function draw(v, kit) {
  switch (v.phase) {
    case 'lobby': {
      const n = here(v).length;
      if (n < 4) kit.setNow('Waiting for players', `${n} here — ${EVEN_NOTE}`);
      else if (!rightCount(n)) kit.setNow(EVEN_NOTE, `${n} here — one more, or one fewer`);
      else kit.setNow('Ready to deal', `${dealing(v).name} presses Deal, or press Enter here`);
      break;
    }
    case 'swap': {
      const away = v.players.filter(p => !p.connected);
      const playing = v.players.filter(p => p.connected);
      const doneCount = playing.filter(p => p.done).length;
      const note = away.length
        ? ` · ${away.map(p => p.name).join(', ')} ${away.length === 1 ? 'is' : 'are'} away — ${[...new Set(away.map(p => teamName(p.team)))].join(', ')} ${away.length === 1 ? 'plays' : 'play'} on`
        : '';
      kit.setNow('Swap with the spread', `${doneCount ? `${doneCount} of ${playing.length} done` : 'everyone at once'}${note}`);
      break;
    }
    case 'reveal': {
      const c = v.call;
      const score = v.teams[c.team].score;
      kit.setNow(`${nameOf(v, c.by)} called ${callWord(c)} on ${nameOf(v, c.target)} — ${c.correct ? 'right!' : 'wrong'}`,
        c.delta > 0 ? `${teamName(c.team)} gets ${WORD[score - 1]}` : c.delta < 0 ? `${teamName(c.team)} loses a letter` : `${teamName(c.team)} had no letters to lose`);
      break;
    }
    case 'over': kit.setNow(v.winner != null ? `${teamName(v.winner)} wins` : 'Game over', 'press N to play again'); break;
  }
  drawSeats(v, kit);
  drawExtra(v, kit);
  if (v.phase !== 'lobby') drawCenter(v); else { centerKey = null; lastSpread = []; lastSpreadId = ''; }
}

function drawSeats(v, kit) {
  const key = JSON.stringify([v.players, v.phase, v.call?.target, v.call?.by, v.winner]);
  if (key === seatsKey) return;
  seatsKey = key;
  kit.drawSeats(v, (p) => {
    let sub = '', cls = '';
    if (v.phase === 'lobby') sub = p === dealing(v) ? 'deals' : 'seated';
    else if (v.phase === 'swap') sub = p.done ? '<span class="tick">&#10003;</span> done' : 'swapping';
    else if (v.phase === 'reveal') {
      if (p.id === v.call.target) { sub = 'cards turned over'; cls = 'cur'; }
      else if (p.id === v.call.by) sub = `called ${callWord(v.call)}`;
    } else if (v.phase === 'over' && p.team != null && p.team === v.winner) { sub = 'wins'; cls = 'won'; }
    return {
      fan: v.phase === 'swap' || v.phase === 'reveal' ? 4 : 0,
      badge: p.team != null && v.phase !== 'lobby' ? badge(p.team) : '',
      cls: `${cls} ${p.team != null ? 'team t' + (p.team + 1) : ''}`, sub,
    };
  });
}

// The left panel: each team, its members and its letters. In the lobby: the teams if dealt now.
function drawExtra(v, kit) {
  const key = JSON.stringify([v.phase, v.teams, v.players.map(p => [p.id, p.name, p.connected])]);
  if (key === extraKey) return;
  extraKey = key;
  if (v.phase === 'lobby') {
    const ps = here(v);
    if (!rightCount(ps.length)) return kit.setExtra(null);
    const teams = pairUp(ps);
    return kit.setExtra(`<div class="label">Teams if dealt now</div>
      ${teams.map((t, k) => `<div class="team-row">${badge(k)}<div class="who">${t.map(id => esc(nameOf(v, id))).join(' &amp; ')}</div><span></span></div>`).join('')}`);
  }
  kit.setExtra(`<div class="label">Teams</div>
    ${v.teams.map((t, k) => `<div class="team-row ${v.winner === k ? 'won' : ''}">${badge(k)}<div class="who">${members(v, k)}</div>${letters(t.score)}</div>`).join('')}`);
}

function drawCenter(v) {
  const key = JSON.stringify([v.phase, v.spread, v.spreadNo, v.idleUntil, v.stock, v.call, v.winner, v.handNo, v.round]);
  if (key === centerKey) return;
  centerKey = key;
  let html = '';
  switch (v.phase) {
    case 'swap': {
      // A new spread deals in one card after another; a single swapped-in card just settles in.
      const spreadId = `${v.round}.${v.handNo}.${v.spreadNo}`, fresh = spreadId !== lastSpreadId;
      const cards = v.spread.map((card, k) => {
        const cls = fresh ? 'dealt' : lastSpread.includes(card) ? '' : 'swapped';
        return face(card, cls).replace('class="card', `style="animation-delay:${fresh ? k * 90 : 0}ms" class="card`);
      }).join('');
      lastSpread = v.spread.slice(); lastSpreadId = spreadId;
      // The bar shows how much of the ten seconds is left; a swap starts it again.
      const left = Math.max(0, Math.min(IDLE_MS, v.idleUntil - Date.now()));
      html = `<div class="kicker">The spread</div>
        <div class="spread">${cards}</div>
        <div class="pilecount">spread ${v.spreadNo} · ${v.stock} in the stock</div>
        <div class="timer"><i style="animation-duration:${IDLE_MS}ms;animation-delay:-${IDLE_MS - left}ms"></i></div>`;
      break;
    }
    case 'reveal': {
      const c = v.call, cls = c.correct ? 'true' : 'lie';
      html = `<div class="kicker">${esc(nameOf(v, c.target))}’s cards</div>
        <div class="revealed">${c.cards.map((card, k) => face(card, 'flip').replace('class="card', `style="animation-delay:${k * 140}ms" class="card`)).join('')}</div>
        <div class="stamp ${cls}">${callWord(c)}!</div>
        <div class="verdict ${cls}">${c.correct ? 'Right' : 'Wrong'}</div>
        <div class="sub-line">${esc(nameOf(v, c.by))} called it on ${esc(nameOf(v, c.target))}. ${c.delta > 0 ? `${teamName(c.team)} gets ${WORD[v.teams[c.team].score - 1]}.` : c.delta < 0 ? `${teamName(c.team)} loses a letter.` : `${teamName(c.team)} had no letters to lose.`} New cards in a moment.</div>`;
      break;
    }
    case 'over':
      html = v.winner != null
        ? `<div class="kicker">${members(v, v.winner)}</div><div class="big-line">${teamName(v.winner)} wins</div>
           <div class="over-letters">${letters(WORD.length)}</div><div class="sub-line">Press N to deal again</div>`
        : `<div class="big-line">Game over</div><div class="sub-line">Press N to deal again</div>`;
      lastSpread = []; lastSpreadId = '';
      break;
  }
  $('center').innerHTML = html;
  $('center').className = 'phase-' + v.phase;
}

await startScreen({ game, rules: RULES, draw, removeNote: () => '. That breaks up their team, so the game goes back to the start' });
