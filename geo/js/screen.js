// The big screen: hosts the game, shows the photo, and after each round the map with every pin.
import * as game from './game.js';
import { RULES } from './rules.js';
import { ROUNDS } from './game.js';
import { startScreen, $, esc } from '../../common/js/screen-kit.js';
import { colorOf, fmt, kmText, tiles, truthIcon, near } from './map.js';

let centerKey = null, seatsKey = null, map = null;
const here = (v) => v.players.filter(p => p.connected);
const last = (v) => v.results[v.results.length - 1];
const ranked = (v) => v.players.slice().sort((a, b) => b.score - a.score);

function draw(v, kit) {
  switch (v.phase) {
    case 'lobby': {
      const n = here(v).length;
      kit.setNow(n ? 'Ready when you are' : 'Waiting for players', n ? `${here(v)[0].name} presses Start, or press Enter here` : 'one is enough — more is better');
      break;
    }
    case 'guess': {
      const locked = v.players.filter(p => p.locked).length;
      kit.setNow(`Round ${v.n} of ${ROUNDS} — where is this?`, `${locked} of ${here(v).length} locked in`,
        { label: 'Show the answer', onClick: () => kit.dispatch({ type: 'skip' }) });
      break;
    }
    case 'reveal':
      kit.setNow(`It was ${last(v).where}`, v.n >= ROUNDS ? 'Enter: final scores' : 'Enter: next round',
        { label: v.n >= ROUNDS ? 'Final scores' : 'Next round', onClick: () => kit.dispatch({ type: 'next', byScreen: true }) });
      break;
    case 'over': {
      const top = ranked(v)[0];
      kit.setNow(top ? `${top.name} wins` : 'Game over', 'press N to play again');
      break;
    }
  }
  drawSeats(v, kit);
  kit.setExtra(v.phase === 'lobby' ? null : `<div class="label">Scores</div>${ranked(v).map(p => `<div class="row"><span><i class="dot" style="background:${colorOf(v, p.id)}"></i>${esc(p.name)}</span><b>${fmt(p.score)}</b></div>`).join('')}`);
  if (v.phase !== 'lobby') drawCenter(v); else { dropMap(); centerKey = null; }
}

// The players, as a strip under the photo: who has locked in, and what they scored.
function drawSeats(v, kit) {
  const key = JSON.stringify([v.players, v.phase, v.n]);
  if (key === seatsKey) return;
  seatsKey = key;
  const r = v.phase === 'reveal' ? last(v) : null;
  const kms = r ? v.players.map(p => r.guesses[p.id]?.km).filter(d => d != null) : [];
  const best = kms.length ? Math.min(...kms) : null;
  kit.drawSeats(v, (p) => {
    const g = r?.guesses[p.id];
    const sub = v.phase === 'lobby' ? 'here'
      : v.phase === 'guess' ? (p.locked ? 'locked in' : 'thinking…')
      : v.phase === 'reveal' ? (g?.km == null ? 'no pin' : `${kmText(g.km)} · +${fmt(g.pts)}`)
      : `${fmt(p.score)} points`;
    return {
      cls: [v.phase === 'guess' && p.locked ? 'locked' : '', v.phase === 'reveal' && g?.km != null && g.km === best ? 'won' : ''].join(' '),
      badge: `<i class="dot" style="background:${colorOf(v, p.id)}"></i>`,
      sub,
    };
  });
}

function photoHTML(v) {
  const left = v.until ? Math.max(0, v.until - Date.now()) : 0;
  return `<div class="photo">
      <div class="bg" style="background-image:url('${esc(v.photo.img)}')"></div>
      <img src="${esc(v.photo.img)}" alt="">
      <div class="chip">Round ${v.n} of ${ROUNDS}</div>
      <div class="timer"><i style="animation-duration:${left}ms"></i></div>
    </div>`;
}

function revealHTML(v) {
  const r = last(v);
  const rows = v.players.slice().sort((a, b) => (r.guesses[a.id]?.km ?? 1e9) - (r.guesses[b.id]?.km ?? 1e9));
  return `<div class="reveal">
      <div id="map" class="map"></div>
      <div class="answer">
        <div class="kicker">Round ${v.n} of ${ROUNDS} · it was</div>
        <div class="where">${esc(r.where)}</div>
        <img class="thumb" src="${esc(r.img)}" alt="">
        <ol class="results">${rows.map(p => {
          const g = r.guesses[p.id];
          return `<li><i class="dot" style="background:${colorOf(v, p.id)}"></i><span class="who">${esc(p.name)}</span>
            <span class="off">${g?.km == null ? 'no pin' : kmText(g.km)}</span><b>+${fmt(g?.pts || 0)}</b></li>`;
        }).join('')}</ol>
        <div class="credit">${esc(r.credit)}</div>
      </div>
    </div>`;
}

function overHTML(v) {
  const order = ranked(v);
  return `<div class="final">
      <div class="kicker">After ${ROUNDS} places</div>
      <div class="big-line">${order[0] ? esc(order[0].name) + (order[1] && order[1].score === order[0].score ? ' and ' + esc(order[1].name) + ' tie' : ' wins') : 'Game over'}</div>
      <ol class="standings">${order.map((p, i) => `<li><span class="pos">${i + 1}</span><i class="dot" style="background:${colorOf(v, p.id)}"></i>
        <span class="who">${esc(p.name)}</span>${v.results.map(r => `<span class="rp">${fmt(r.guesses[p.id]?.pts || 0)}</span>`).join('')}<b>${fmt(p.score)}</b></li>`).join('')}</ol>
      <div class="strip">${v.results.map((r, i) => `<figure><img src="${esc(r.img)}" alt=""><figcaption>${i + 1}. ${esc(r.where)}</figcaption></figure>`).join('')}</div>
      <div class="sub-line">Press N to play five more.</div>
    </div>`;
}

function dropMap() { if (map) { map.remove(); map = null; } }

// The answer on a world map: a marker where it was, each pin in its player's colour, a line between.
function drawMap(v) {
  const r = last(v);
  if (!globalThis.L || !$('map')) return;
  map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: false });
  tiles(map);
  const truth = [r.lat, r.lon];
  const pts = [truth];
  L.marker(truth, { icon: truthIcon(), zIndexOffset: 1000 }).addTo(map);
  for (const p of v.players) {
    const g = r.guesses[p.id];
    if (g?.km == null) continue;
    const at = [g.lat, near(g.lon, r.lon)];        // the short way round, across the date line if need be
    pts.push(at);
    L.polyline([at, truth], { color: colorOf(v, p.id), weight: 2.5, dashArray: '6 6', opacity: .9 }).addTo(map);
    L.circleMarker(at, { radius: 9, color: '#15161a', weight: 2, fillColor: colorOf(v, p.id), fillOpacity: 1 })
      .bindTooltip(esc(p.name), { permanent: true, direction: 'top', offset: [0, -8], className: 'pin-name' }).addTo(map);
  }
  if (pts.length === 1) map.setView(truth, 5);
  else map.fitBounds(pts, { padding: [70, 70], maxZoom: 9 });
}

function drawCenter(v) {
  const key = JSON.stringify([v.phase, v.n, v.round, v.phase === 'guess' ? v.until : v.results.length, v.phase === 'over' ? v.players : null]);
  if (key === centerKey) return;
  centerKey = key;
  dropMap();
  $('center').innerHTML = v.phase === 'guess' ? photoHTML(v) : v.phase === 'reveal' ? revealHTML(v) : overHTML(v);
  $('center').className = 'phase-' + v.phase;
  if (v.phase === 'reveal') drawMap(v);
}

const { host } = await startScreen({ game, rules: RULES, draw, removeNote: () => ', and their points go with them' });
// Enter or Space moves on from an answer (the screen-kit keys deal and redeal).
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if ((e.key === 'Enter' || e.key === ' ') && host.state.phase === 'reveal') host.dispatch({ type: 'next', byScreen: true });
});
