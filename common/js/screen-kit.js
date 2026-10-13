// Everything the big screens have in common: the page frame, the join panel and QR code, the
// rules, the log, the seats around the felt, the keys, and going back to the game list.
// A game's screen.js supplies its rules module and a draw(view) for its own parts.
import { Host } from './host.js';
import { hostRoom } from './net.js';
import { back } from './cards.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const nameOf = (v, id) => v.players.find(p => p.id === id)?.name || '?';
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

// Phones always join through the public pages, even when a screen is opened from a file.
const PUBLIC_BASE = 'https://potjim80.github.io/bluff/';

// rules: { summary: [html…], full: [html…] }  (the game's rules.js)
// draw(view, kit): the game's own parts: setNow(), drawSeats(), #center outside the lobby
// removeNote(view): what happens to a removed player's things in this game, e.g. ", and their cards go into the pile"
export async function startScreen({ game, rules, draw, removeNote = () => '' }) {
  const { INFO } = game;
  const params = new URLSearchParams(location.search);
  document.title = INFO.name;
  $('screen').innerHTML = `
    <aside id="left">
      <a class="back" id="back" href="../">← All games</a>
      <div class="panel join">
        <div class="label">Join on your phone</div>
        <div id="joinUrl" class="url">…</div>
        <div class="label">Room code</div>
        <div id="code" class="code">····</div>
        <div id="qr" class="qr"></div>
      </div>
      <div class="panel how" id="how"><div class="label">How it goes</div>${rules.summary.map(p => `<p>${p}</p>`).join('')}</div>
      <div class="panel extra" id="extra" hidden></div>
      <ol id="log" class="log"></ol>
    </aside>
    <section id="table-wrap">
      <div id="now" class="now"><span class="what"></span><span class="who"></span><button id="nowBtn" class="skip" hidden></button></div>
      <div id="table">
        <div id="felt"></div>
        <div id="seats"></div>
        <div id="center"></div>
      </div>
      <div id="keys" class="keys"></div>
    </section>`;

  let view = null, qrFor = null, lobbyKey = null, nowAction = null;
  const kit = {
    view: () => view,
    // The line above the table, and an optional button at its end (e.g. Skip turn).
    setNow(what, who = '', button = null) {
      $('now').querySelector('.what').textContent = what;
      $('now').querySelector('.who').textContent = who;
      $('nowBtn').hidden = !button;
      if (button) { $('nowBtn').textContent = button.label; nowAction = button.onClick; }
    },
    // Seats around the felt, first seat at the bottom, going clockwise. seat(p, i) returns
    // { cls, sub, fan } — fan: how many card backs to show above the name (0 for none).
    drawSeats(v, seat) {
      const n = v.players.length;
      $('seats').innerHTML = v.players.map((p, i) => {
        const a = Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
        const x = 50 + 47 * Math.cos(a), y = 50 + 44 * Math.sin(a);
        const { cls = '', sub = '', fan = 0, badge = '' } = seat(p, i) || {};
        const shown = Math.min(fan, 6);
        return `<div class="seat ${cls} ${p.connected ? '' : 'away'}" style="left:${x}%;top:${y}%" data-id="${esc(p.id)}" title="Click to remove ${esc(p.name)}">
          ${shown ? `<div class="fan">${Array.from({ length: shown }, (_, k) => back(`f${k}`)).join('')}</div>` : ''}
          ${badge}<div class="name">${esc(p.name)}</div>
          <div class="sub">${sub}${p.connected ? '' : `${sub ? ' · ' : ''}away`}</div>
        </div>`;
      }).join('');
    },
    // A panel on the left under the rules (scores, teams…). html = null hides it.
    setExtra(html) { $('extra').hidden = html == null; if (html != null) $('extra').innerHTML = html; },
    dispatch: (a) => host.dispatch(a),
    esc, nameOf, plural,
  };

  function renderJoin(v) {
    $('code').textContent = v.code;
    const local = !location.protocol.startsWith('http') || ['localhost', '127.0.0.1'].includes(location.hostname);
    const base = local ? `${PUBLIC_BASE}${INFO.id}/play.html` : location.origin + location.pathname.replace(/[^/]*$/, '') + 'play.html';
    $('joinUrl').textContent = base.replace(/^https:\/\//, '');
    const link = `${base}?code=${v.code}`;
    if (qrFor !== link && globalThis.qrcode) {
      qrFor = link;
      const q = qrcode(0, 'M'); q.addData(link); q.make();
      $('qr').innerHTML = q.createSvgTag({ scalable: true, margin: 0 });
    }
    $('qr').parentElement.classList.toggle('small', v.phase !== 'lobby');
    $('how').hidden = v.phase === 'lobby';           // the lobby shows the whole rules in the middle
  }

  // The lobby: the game's name, its full rules, and who's sitting down.
  function renderLobby(v) {
    const key = JSON.stringify([v.players.map(p => [p.name, p.connected])]);
    if (key === lobbyKey) return;
    lobbyKey = key;
    $('center').className = 'phase-lobby';
    $('center').innerHTML = `<div class="big-line">${esc(INFO.name)}</div>
      <div class="rules-card"><div class="label">Rules</div><ol>${rules.full.map(r => `<li>${r}</li>`).join('')}</ol></div>
      <div class="sub-line">${v.players.length ? v.players.map(p => esc(p.name)).join(' · ') : 'Scan the code to sit down'}</div>`;
    if (!rules.full.length) $('center').querySelector('.rules-card').remove();
  }

  function render(v) {
    view = v;
    renderJoin(v);
    $('log').innerHTML = v.log.slice(0, 12).map(e => `<li>${esc(e.t)}</li>`).join('');
    if (v.phase === 'lobby') renderLobby(v); else lobbyKey = null;
    $('keys').textContent = v.phase === 'lobby' ? 'Enter: deal · click a name to remove them · Shift+Esc: start over'
      : v.phase === 'over' ? 'N: play again · click a name to remove them · Shift+Esc: start over'
      : 'click a name to remove them · Shift+Esc: start over';
    draw(v, kit);
  }

  // ---- hosting ----
  const host = new Host({ game, render, code: params.get('code')?.toUpperCase().slice(0, 4), fresh: params.has('new') });
  await host.init();
  const room = hostRoom(host.state.code, {
    game: INFO.id, actions: game.ACTIONS, keys: host.keys, known: host.known,
    onAction: (a) => host.dispatch(a),
    onLeave: (id) => host.dispatch({ type: 'leave', id }),
  });
  host.publish = room.publish;
  host.knownNow = room.known;
  room.ready.then(() => host.set(host.state)).catch(() => kit.setNow('Could not reach any game server', 'check the internet connection, then reload'));
  window.party = { host, room };   // for poking from the console

  $('nowBtn').onclick = () => nowAction?.();
  $('seats').addEventListener('click', (e) => {
    const s = e.target.closest('.seat'); if (!s) return;
    const p = view.players.find(p => p.id === s.dataset.id);
    const mid = view.phase !== 'lobby' && view.phase !== 'over';
    if (p && confirm(`Remove ${p.name}? They can't sit down again until you start a new party${mid ? removeNote(view) : ''}.`)) host.dispatch({ type: 'remove', id: p.id });
  });
  $('back').onclick = async (e) => {
    e.preventDefault();
    const mid = view && view.phase !== 'lobby' && view.phase !== 'over';
    if (mid && !confirm(`Leave ${INFO.name} for now? This game is kept — open ${INFO.name} again to carry on.`)) return;
    clearTimeout(host.timer);
    await room.leaveTo((view?.players || []).map(p => ({ id: p.id, name: p.name, connected: p.connected })));
    location.href = '../';
  };
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'Escape' && e.shiftKey) { if (confirm(`Start ${INFO.name} over? Everyone stays at the table, with the same code.`)) host.reset(); return; }
    if (e.key === 'Enter' && view?.phase === 'lobby') host.dispatch({ type: 'start', byScreen: true });
    if ((e.key === 'n' || e.key === 'N') && view?.phase === 'over') host.dispatch({ type: 'start', byScreen: true });
  });
  return { host, room, kit };
}
