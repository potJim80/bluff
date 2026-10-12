// The big screen: hosts the game and draws the table. It never shows anyone's hand.
import { Host } from './host.js';
import { hostRoom } from './net.js';
import { plural, claimText } from './game.js';
import { face, back } from './cards.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);
let view = null, centerKey = null, seatsKey = null;

const nameOf = (v, id) => v.players.find(p => p.id === id)?.name || '?';
const cur = (v) => v.players[v.turn];

function render(v) {
  view = v;
  renderJoin(v); renderNow(v); renderLog(v); renderSeats(v); renderCenter(v);
}

// Phones always join through the public page, even when this screen is opened from a file.
const PUBLIC_PLAY_URL = 'https://potjim80.github.io/bluff/play.html';
let qrFor = null;
function renderJoin(v) {
  $('code').textContent = v.code;
  const local = !location.protocol.startsWith('http') || ['localhost', '127.0.0.1'].includes(location.hostname);
  const base = local ? PUBLIC_PLAY_URL : location.origin + location.pathname.replace(/[^/]*$/, '') + 'play.html';
  $('joinUrl').textContent = base.replace(/^https:\/\//, '');
  const link = `${base}?code=${v.code}`;
  if (qrFor !== link && globalThis.qrcode) {
    qrFor = link;
    const q = qrcode(0, 'M'); q.addData(link); q.make();
    $('qr').innerHTML = q.createSvgTag({ scalable: true, margin: 0 });
  }
  $('qr').parentElement.classList.toggle('small', v.phase !== 'lobby');
}

function renderNow(v) {
  const c = cur(v);
  let what = '', who = '';
  switch (v.phase) {
    case 'lobby': what = v.players.length < 2 ? 'Waiting for players' : 'Ready to deal'; who = v.players.length < 2 ? `${v.players.length} seated — two or more to play` : `${v.players[0].name} presses Start, or press Enter here`; break;
    case 'turn': what = `${c.name}'s turn`; who = `putting down ${plural(v.rank, 2)}${c.connected ? '' : ' · their phone is away'}`; break;
    case 'window': what = `${nameOf(v, v.play.by)} says ${claimText(v.play.rank, v.play.count)}`; who = 'anyone can call Bluff'; break;
    case 'reveal': what = v.reveal.truthful ? 'It was true' : 'Caught bluffing'; who = `${nameOf(v, v.reveal.taker)} takes the pile`; break;
    case 'over': what = v.winner ? `${nameOf(v, v.winner)} wins` : 'Game over'; who = 'press N to play again'; break;
  }
  $('now').querySelector('.what').textContent = what;
  $('now').querySelector('.who').textContent = who;
  $('skip').hidden = !(v.phase === 'turn' && !c.connected);
  $('keys').textContent = v.phase === 'lobby' ? 'Enter: deal · click a name to remove them · Shift+Esc: new table'
    : v.phase === 'over' ? 'N: play again · click a name to remove them · Shift+Esc: new table'
    : 'click a name to remove them · Shift+Esc: new table';
}

function renderLog(v) {
  $('log').innerHTML = v.log.map(e => `<li>${esc(e.t)}</li>`).join('');
}

// Seats around the felt, first seat at the bottom, going clockwise.
function renderSeats(v) {
  const key = JSON.stringify([v.players, v.turn, v.phase, v.play?.passes, v.play?.by, v.reveal?.taker]);
  if (key === seatsKey) return;
  seatsKey = key;
  const n = v.players.length;
  $('seats').innerHTML = v.players.map((p, i) => {
    const a = Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    const x = 50 + 47 * Math.cos(a), y = 50 + 44 * Math.sin(a);
    const fan = Math.min(p.cards, 6);
    const state = v.phase === 'window' && v.play.by !== p.id ? (v.play.passes.includes(p.id) ? 'let it go' : '') : '';
    const cls = [v.phase !== 'lobby' && v.phase !== 'over' && i === v.turn ? 'cur' : '', p.connected ? '' : 'away', v.winner === p.id ? 'won' : '', v.reveal?.taker === p.id ? 'takes' : ''].join(' ');
    return `<div class="seat ${cls}" style="left:${x}%;top:${y}%" data-id="${esc(p.id)}" title="Click to remove ${esc(p.name)}">
      ${v.phase === 'lobby' ? '' : `<div class="fan">${Array.from({ length: fan }, (_, k) => back(`f${k}`)).join('')}</div>`}
      <div class="name">${esc(p.name)}</div>
      <div class="sub">${v.phase === 'lobby' ? (i === 0 ? 'deals' : 'seated') : `${p.cards} card${p.cards === 1 ? '' : 's'}`}${p.connected ? '' : ' · away'}${state ? ' · ' + state : ''}</div>
    </div>`;
  }).join('');
  for (const s of $('seats').children) s.onclick = () => {
    const p = view.players.find(p => p.id === s.dataset.id);
    if (p && confirm(`Remove ${p.name} from the table? They can't sit down again this game${view.phase === 'lobby' ? '' : ', and their cards go into the pile'}.`)) host.dispatch({ type: 'remove', id: p.id });
  };
}

function pileHTML(count, top = 0) {
  const shown = Math.min(count, 14);
  // Fixed little offsets per position, so the pile doesn't jitter on every redraw.
  const jitter = (k) => `transform: translate(${((k * 37) % 9) - 4}px, ${-k * 1.5}px) rotate(${((k * 53) % 15) - 7}deg)`;
  return `<div class="pile">${Array.from({ length: shown }, (_, k) => back(k >= shown - top ? 'fresh' : '').replace('class="card', `style="${jitter(k)}" class="card`)).join('')}</div>
    <div class="pilecount">${count ? `${count} card${count === 1 ? '' : 's'} in the pile` : 'The pile is empty'}</div>`;
}

function renderCenter(v) {
  const key = JSON.stringify([v.phase, v.rank, v.pile, v.play?.until, v.reveal, v.winner, v.players.length, v.round]);
  if (key === centerKey) return;
  centerKey = key;
  const c = cur(v);
  let html = '';
  switch (v.phase) {
    case 'lobby':
      html = `<div class="big-line">Bluff</div><div class="sub-line">${v.players.length ? v.players.map(p => esc(p.name)).join(' · ') : 'Scan the code to sit down'}</div>`;
      break;
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

// ---- hosting ----
const host = new Host({ render, code: params.get('code')?.toUpperCase().slice(0, 4), fresh: params.has('new') });
await host.init();
const room = hostRoom(host.state.code, {
  keys: host.keys, known: host.known,
  onAction: (a) => host.dispatch(a),
  onLeave: (id) => host.dispatch({ type: 'leave', id }),
});
host.publish = room.publish;
host.knownNow = room.known;
room.ready.then(() => host.set(host.state)).catch(() => { $('now').querySelector('.what').textContent = 'Could not reach any game server'; $('now').querySelector('.who').textContent = 'check the internet connection, then reload'; });
window.bluff = { host, room };   // for poking from the console

$('skip').onclick = () => host.dispatch({ type: 'skip' });
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'Escape' && e.shiftKey) { if (confirm('Clear the table and start fresh with a new code?')) { try { localStorage.removeItem('bluff.host'); } catch {} location.search = ''; } return; }
  if (e.key === 'Enter' && view?.phase === 'lobby') host.dispatch({ type: 'start', byScreen: true });
  if ((e.key === 'n' || e.key === 'N') && view?.phase === 'over') host.dispatch({ type: 'start', byScreen: true });
});
