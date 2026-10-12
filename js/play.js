// The phone: one player's hand and buttons. Shows whatever the moment asks of them.
import { joinRoom } from './net.js';
import { makeKeys } from './seal.js';
import { plural, claimText, rankOf } from './game.js';
import { face } from './cards.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: (k) => { try { return localStorage.getItem('bluff.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('bluff.' + k, v); } catch {} } };

const me = store.get('id') || Math.random().toString(36).slice(2, 10);
store.set('id', me);
let keys = null;
try { keys = JSON.parse(store.get('keys')); } catch {}

let room = null, state = null, hand = null, selected = new Set(), handKey = '', deadline = null, deadlineFor = null, sending = false;
const params = new URLSearchParams(location.search);
const startCode = (params.get('code') || store.get('code') || '').toUpperCase();

function renderJoinForm(err) {
  $('#view').innerHTML = `
    <h1>Bluff</h1>
    <p>Type the code on the big screen.</p>
    <div><label>Room code</label><input id="code" class="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(startCode)}"></div>
    <div><label>Your name</label><input id="name" maxlength="16" autocomplete="off" value="${esc(store.get('name') || '')}"></div>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <button class="big" id="go">Sit down</button>`;
  $('#go').onclick = () => {
    const code = $('#code').value.trim().toUpperCase(), name = $('#name').value.trim();
    if (code.length !== 4) return renderJoinForm('The code is four letters.');
    if (!name) return renderJoinForm('You need a name at the table.');
    store.set('code', code); store.set('name', name);
    connect(code, name);
  };
}

async function connect(code, name) {
  if (room) room.close();
  if (!globalThis.crypto?.subtle) return renderJoinForm('This browser can’t keep your cards private here. Open the link from the screen (it starts with https).');
  if (!keys) { keys = await makeKeys(); store.set('keys', JSON.stringify(keys)); }
  $('#view').innerHTML = `<h2>Finding the table…</h2><p>Code ${esc(code)}</p><p class="hint">If this takes more than a few seconds: is the screen still open?</p>`;
  room = joinRoom(code, {
    id: me, name, keys,
    onState: (s, h) => { state = s; hand = h; try { render(); } catch (e) { console.error('render failed', e); } },
    onStatus: (st, detail) => {
      $('#status').textContent = ({ connecting: 'connecting', open: 'connected', closed: 'reconnecting…', error: 'error: ' + (detail || '?'), 'no-room': 'no table with that code' }[st] || st);
      $('#status').className = 'status ' + (st === 'open' ? 'open' : '');
      if (st === 'no-room' && !state) renderJoinForm('No table is open with that code. Check the screen, then try again.');
    },
  });
}

async function send(a) {
  if (sending) return;
  sending = true;
  try { if (!(await room?.send(a))) flash('Not connected — try again in a moment.'); } finally { sending = false; }
}
function flash(t) { const d = document.createElement('div'); d.className = 'flash'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

const nameOf = (id) => state.players.find(p => p.id === id)?.name || '?';

function render() {
  if (!state) return;
  const p = state.players.find(p => p.id === me);
  const v = $('#view');
  $('#me').textContent = p ? `${p.name}${hand ? ` · ${hand.length} card${hand.length === 1 ? '' : 's'}` : ''}` : 'Bluff';
  // A new hand (dealt, or the pile came our way): forget what was selected.
  const hk = (hand || []).join();
  if (hk !== handKey) { handKey = hk; selected.clear(); }

  if (state.banned?.includes(me)) { v.innerHTML = `<h1>You were removed from this table.</h1>`; return; }
  if (!p) {
    v.innerHTML = state.phase === 'lobby' || state.phase === 'over' ? `<h2>Sitting down…</h2>` : `<h1>A game is on.</h1><p>You'll be dealt in when the next game starts. Keep this page open.</p>`;
    return;
  }
  const cur = state.players[state.turn];
  const mine = cur?.id === me;
  const counts = `<ol class="others">${state.players.map((q, i) => `<li class="${i === state.turn && state.phase !== 'lobby' && state.phase !== 'over' ? 'cur' : ''} ${q.id === me ? 'me' : ''}"><span>${esc(q.name)}</span><b>${state.phase === 'lobby' ? '' : q.cards}</b></li>`).join('')}</ol>
    ${state.phase !== 'lobby' && state.phase !== 'over' ? `<p class="hint pilenote">${state.pile} in the pile</p>` : ''}`;

  switch (state.phase) {
    case 'lobby':
      v.innerHTML = `<h1>You're in.</h1><p>${state.players.length} at the table.${state.players.length < 2 ? ' Waiting for one more.' : ''}</p>${counts}
        ${state.players[0].id === me ? `<button class="big" id="start" ${state.players.length < 2 ? 'disabled' : ''}>Deal the cards</button><p class="hint">You sat down first, so you deal. Wait until everyone's in.</p>` : `<p class="hint">${esc(state.players[0].name)} deals when everyone's in.</p>`}`;
      $('#start') && ($('#start').onclick = () => send({ type: 'start' }));
      return;

    case 'turn':
      if (mine) {
        const n = selected.size, max = 4 * state.decks;
        v.innerHTML = `<div class="ask"><div class="kicker">Your turn · put down</div><div class="rank">${plural(state.rank, 2)}</div></div>
          ${handHTML(true, state.rank)}
          <div class="dock"><button class="big" id="play" ${n ? '' : 'disabled'}>${n ? `Put down ${n} — “${claimText(state.rank, n)}”` : `Pick 1 to ${max} cards`}</button></div>`;
        bindHand(max);
        $('#play').onclick = () => { if (selected.size) send({ type: 'play', cards: [...selected].map(i => hand[i]) }); };
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
        $('#call').onclick = () => send({ type: 'call' });
        $('#pass').onclick = () => send({ type: 'pass' });
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
        ${state.players[0].id === me ? `<button class="big" id="again">Deal again</button>` : `<p class="hint">${esc(state.players[0].name)} deals the next game.</p>`}`;
      $('#again') && ($('#again').onclick = () => send({ type: 'start' }));
      return;
    }
  }
}

// mark: a rank to outline (the one being claimed), so you can see what you hold of it.
function handHTML(pickable, mark = -1) {
  if (!hand) return `<p class="hint">Your cards are on their way…</p>`;
  return `<div class="hand ${pickable ? 'pick' : ''}">${hand.map((c, i) => face(c, `${selected.has(i) ? 'sel' : ''} ${rankOf(c) === mark ? 'mark' : ''}`).replace('class="card', `data-i="${i}" class="card`)).join('')}</div>`;
}

function bindHand(max) {
  for (const el of document.querySelectorAll('.hand.pick .card')) el.onclick = () => {
    const i = +el.dataset.i;
    if (selected.has(i)) selected.delete(i);
    else if (selected.size < max) selected.add(i);
    else return flash(`At most ${max} at a time.`);
    render();
  };
}

if (startCode && store.get('name') && store.get('code') === startCode && !params.has('code')) connect(startCode, store.get('name'));
else renderJoinForm();
