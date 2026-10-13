// Everything the phone pages have in common: who you are (kept across games), the join form,
// the connection line, following the screen to another game, and the lobby with the rules.
// A game's play.js supplies draw(ctx) for everything once the cards are dealt.
import { joinRoom } from './net.js';
import { makeKeys } from './seal.js';
import { GAMES } from './party.js';

export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One identity per phone for every game: the same id, keys and name.
const store = {
  get(k) { try { return localStorage.getItem('party.' + k) ?? localStorage.getItem('bluff.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('party.' + k, v); } catch {} },
};

export function flash(t) { const d = document.createElement('div'); d.className = 'flash'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

// rules: { full: [html…] } (the game's rules.js)
// draw(ctx): the game's views once the table is past the lobby. ctx has:
//   state, secret, me (my id), player (my seat), view (#view element), send(action), rerender(),
//   setTitle(text), others(): the list of players and counts, isDealer
// lobbyNote(state, me): optional extra html in the lobby (teams, scores…)
// count(player): optional, what to show beside each name in the players list
export function startPhone({ game, rules, draw, lobbyNote = () => '', count = () => '' }) {
  const { INFO } = game;
  document.title = INFO.name;
  const me = store.get('id') || Math.random().toString(36).slice(2, 10);
  store.set('id', me);
  let keys = null;
  try { keys = JSON.parse(store.get('keys')); } catch {}
  if (keys) store.set('keys', JSON.stringify(keys));

  let room = null, state = null, secret = null, sending = false, code = null, leaving = false;
  const params = new URLSearchParams(location.search);
  const startCode = (params.get('code') || store.get('code') || '').toUpperCase();
  let formCode = startCode;

  function joinForm(err) {
    $('#me').textContent = INFO.name;
    $('#view').innerHTML = `
      <h1>${esc(INFO.name)}</h1>
      <p>Type the code on the big screen.</p>
      <div><label>Room code</label><input id="code" class="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(formCode)}"></div>
      <div><label>Your name</label><input id="name" maxlength="16" autocomplete="off" value="${esc(store.get('name') || '')}"></div>
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
      <button class="big" id="go">Sit down</button>
      ${rulesBlock(false)}`;
    $('#go').onclick = () => {
      const c = $('#code').value.trim().toUpperCase(), name = $('#name').value.trim();
      formCode = c;
      if (c.length !== 4) return joinForm('The code is four letters.');
      if (!name) return joinForm('You need a name at the table.');
      store.set('code', c); store.set('name', name);
      connect(c, name);
    };
  }

  const rulesBlock = (open) => rules.full.length ? `<details class="rules" ${open ? 'open' : ''}><summary>How to play ${esc(INFO.name)}</summary><ol>${rules.full.map(r => `<li>${r}</li>`).join('')}</ol></details>` : '';

  async function connect(c, name) {
    if (room) room.close();
    code = c;
    if (!globalThis.crypto?.subtle) return joinForm('This browser can’t keep your cards private here. Open the link from the screen (it starts with https).');
    if (!keys) { keys = await makeKeys(); store.set('keys', JSON.stringify(keys)); }
    $('#view').innerHTML = `<h2>Finding the table…</h2><p>Code ${esc(c)}</p><p class="hint">If this takes more than a few seconds: is the screen still open?</p>`;
    room = joinRoom(c, {
      id: me, name, keys,
      onState: (s, sec) => { state = s; secret = sec; try { render(); } catch (e) { console.error('render failed', e); } },
      onStatus: (st, detail) => {
        $('#status').textContent = ({ connecting: 'connecting', open: 'connected', closed: 'reconnecting…', error: 'error: ' + (detail || '?'), 'no-room': 'no table with that code' }[st] || st);
        $('#status').className = 'status ' + (st === 'open' ? 'open' : '');
        if (st === 'no-room' && !state) joinForm('No table is open with that code. Check the screen, then try again.');
      },
    });
  }

  async function send(a) {
    if (sending) return;
    sending = true;
    try { if (!(await room?.send(a))) flash('Not connected — try again in a moment.'); } finally { sending = false; }
  }

  // The screen opened another game: go to that game's page. If two screens are fighting over the
  // same code, the phone would bounce between them forever, so after a few quick hops it stops.
  function follow(to) {
    let hops = [];
    try { hops = JSON.parse(sessionStorage.getItem('party.hops') || '[]').filter(t => Date.now() - t < 30000); } catch {}
    if (hops.length >= 5) {
      $('#view').innerHTML = `<h1>Two screens?</h1><p>The code ${esc(code)} keeps switching between games. Close the extra screen, then reload this page.</p>`;
      return;
    }
    try { sessionStorage.setItem('party.hops', JSON.stringify([...hops, Date.now()])); } catch {}
    leaving = true;
    $('#view').innerHTML = `<h2>Off to the next game…</h2>`;
    room.quietClose().then(() => location.replace(`../${to}/play.html`));
  }

  const isDealer = () => state.players.find(p => p.connected)?.id === me;
  const others = () => `<ol class="others">${state.players.map(q => `<li class="${q.id === me ? 'me' : ''} ${q.connected ? '' : 'away'}"><span>${esc(q.name)}</span><b>${state.game !== INFO.id || state.phase === 'lobby' ? '' : esc(count(q, state) ?? '')}</b></li>`).join('')}</ol>`;

  function render() {
    if (!state || leaving) return;
    const v = $('#view');
    if (state.game && state.game !== INFO.id) {
      if (GAMES.includes(state.game)) return follow(state.game);
      if (state.game === 'ended') {
        v.innerHTML = `<h1>That party is over.</h1><p>The screen started a new party with a new code.</p><button class="big" id="again">Join with the new code</button>`;
        $('#again').onclick = () => { room?.close(); room = null; state = null; formCode = ''; joinForm(); };
        return;
      }
      if (state.game === 'menu') {
        $('#me').textContent = state.players.find(p => p.id === me)?.name || INFO.name;
        v.innerHTML = `<h1>Picking the next game…</h1><p>The screen is choosing. This page moves on by itself when it does.</p>${others()}`;
        return;
      }
      return;
    }
    const player = state.players.find(p => p.id === me);
    $('#me').textContent = player ? player.name : INFO.name;
    if (state.banned?.includes(me)) { v.innerHTML = `<h1>You were removed from this table.</h1>`; return; }
    if (!player) {
      const full = state.players.length >= INFO.max;
      v.innerHTML = state.phase === 'lobby' || state.phase === 'over'
        ? (full ? `<h1>The table is full.</h1><p>${esc(INFO.name)} takes ${INFO.max} at most. You'll be in the next game.</p>` : `<h2>Sitting down…</h2>`)
        : `<h1>A game is on.</h1><p>You'll be dealt in when the next game starts. Keep this page open.</p>`;
      return;
    }
    const ctx = { state, secret, me, player, view: v, send, rerender: render, setTitle: (t) => { $('#me').textContent = t; }, others, isDealer: isDealer(), esc, flash, rulesBlock };
    if (state.phase === 'lobby') {
      const here = state.players.filter(p => p.connected).length;
      const need = Math.max(0, INFO.min - here);
      // A game can say why it can't deal yet beyond the head count (Kemps needs an even number).
      const problem = need ? `${INFO.name} needs ${need} more.` : (game.dealProblem?.(state) || '');
      v.innerHTML = `<h1>You're in.</h1><p>${here} at the table.${problem ? ` ${esc(problem)}` : ''}</p>${others()}${lobbyNote(state, me)}
        ${isDealer() ? `<button class="big" id="start" ${problem ? 'disabled' : ''}>Deal the cards</button><p class="hint">You're first at the table, so you deal. Wait until everyone's in.</p>`
          : `<p class="hint">${esc(state.players.find(p => p.connected)?.name || 'The first player')} deals when everyone's in.</p>`}
        ${rulesBlock(true)}`;
      $('#start') && ($('#start').onclick = () => send({ type: 'start' }));
      return;
    }
    draw(ctx);
  }

  if (startCode && store.get('name') && store.get('code') === startCode && !params.has('code')) connect(startCode, store.get('name'));
  else joinForm();
}
