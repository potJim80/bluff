// The phone: the photo, small, and a world map to drop a pin on. After each round, where it was.
//   Guessing: tap the map to drop your pin (tap again to move it), then Lock in.
//   Tap the photo to see it full screen; tap it there to zoom in, and drag around.
import * as game from './game.js';
import { RULES } from './rules.js';
import { ROUNDS } from './game.js';
import { startPhone, esc, flash } from '../../common/js/phone-kit.js';
import { colorOf, fmt, kmText, tiles, truthIcon, pinIcon, near } from './map.js';

// The map lives across table updates (others locking in shouldn't reset your view), so it is only
// rebuilt when the moment changes: a new round, the reveal, the end.
let built = null, map = null, marker = null, draft = null, draftFor = null, deadline = null, deadlineFor = null;

function timerHTML(v) {
  if (!v.until) return '';
  if (deadlineFor !== v.until) { deadlineFor = v.until; deadline = Date.now() + Math.max(0, v.until - (v.stamp || Date.now())); }
  return `<div class="timer"><i style="animation-duration:${Math.max(0, deadline - Date.now())}ms"></i></div>`;
}

function newMap(el, opts = {}) {
  if (map) { map.remove(); map = null; marker = null; }
  map = L.map(el, { zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: 1, ...opts });
  tiles(map);
  return map;
}

function draw(ctx) {
  const { state: v, me, view, send } = ctx;
  const mine = v.players.find(p => p.id === me);
  ctx.setTitle(`${ctx.player.name}${v.phase === 'over' ? '' : ` · ${fmt(mine?.score || 0)}`}`);
  const key = `${v.round}:${v.n}:${v.phase}`;
  const fresh = built !== key || !view.querySelector('.geo');
  built = key;
  if (v.phase === 'guess') return guess(ctx, fresh);
  if (v.phase === 'reveal') return reveal(ctx, fresh);
  if (map) { map.remove(); map = null; }
  over(ctx);
}

// ---- guessing ----
function guess(ctx, fresh) {
  const { state: v, me, view, send } = ctx;
  const locked = ctx.secret?.pin || null;
  if (draftFor !== `${v.round}:${v.n}`) { draftFor = `${v.round}:${v.n}`; draft = null; }
  const color = colorOf(v, me);
  if (fresh) {
    view.innerHTML = `<div class="geo guess">
        <div class="ask"><div class="kicker">Round ${v.n} of ${ROUNDS}</div><h2 class="role-line">Where is this?</h2><div id="t"></div></div>
        <button class="photo-sm" id="photo"><img src="${esc(v.photo.img)}" alt="The photo"><span>Tap to look closer</span></button>
        <div id="pmap" class="pmap"></div>
        <p class="hint" id="note"></p>
        <div class="dock" id="dock"></div>
      </div>`;
    view.querySelector('#photo').onclick = () => zoom(v.photo.img);
    newMap(view.querySelector('#pmap')).setView([20, 10], 1);
    map.on('click', (e) => {
      if (ctx.secret?.pin || built !== `${v.round}:${v.n}:guess`) return;
      draft = { lat: e.latlng.lat, lon: e.latlng.wrap().lng };
      placePin(e.latlng, color);
      ctx.rerender();
    });
  }
  const at = locked || draft;
  if (at && !marker) placePin([at.lat, at.lon], color);
  if (locked && marker) marker.setLatLng([locked.lat, locked.lon]);
  view.querySelector('#t').innerHTML = timerHTML(v);

  const waiting = v.players.filter(p => p.connected && !p.locked && p.id !== me).length;
  view.querySelector('#note').textContent = locked ? (waiting ? `Locked in. Waiting for ${waiting} more…` : 'Locked in.')
    : draft ? 'Tap somewhere else to move it, or lock it in.' : 'Tap the map to drop your pin. Pinch to zoom.';
  const dock = view.querySelector('#dock');
  const want = locked ? 'locked' : draft ? 'ready' : 'none';
  if (dock.dataset.want !== want) {
    dock.dataset.want = want;
    dock.innerHTML = locked ? `<button class="big ghost" disabled>Locked in</button>` : `<button class="big" id="lock" ${draft ? '' : 'disabled'}>Lock in</button>`;
    const btn = dock.querySelector('#lock');
    if (btn) btn.onclick = () => { if (draft) send({ type: 'guess', lat: draft.lat, lon: draft.lon }); };
  }
}

function placePin(latlng, color) {
  if (!map) return;
  if (marker) marker.setLatLng(latlng);
  else marker = L.marker(latlng, { icon: pinIcon(color), interactive: false }).addTo(map);
}

// The photo full screen. Tap to zoom in and drag around; × to close.
function zoom(src) {
  const z = document.createElement('div');
  z.className = 'zoom';
  z.innerHTML = `<div class="pane"><img src="${esc(src)}" alt=""></div><button class="close" aria-label="Close">×</button><p class="hint">Tap the photo to zoom</p>`;
  document.body.appendChild(z);
  z.querySelector('.close').onclick = () => z.remove();
  z.querySelector('img').onclick = (e) => {
    const pane = z.querySelector('.pane'), on = !pane.classList.contains('in');
    const fx = e.offsetX / e.target.clientWidth, fy = e.offsetY / e.target.clientHeight;
    pane.classList.toggle('in', on);
    if (on) { pane.scrollLeft = fx * pane.scrollWidth - pane.clientWidth / 2; pane.scrollTop = fy * pane.scrollHeight - pane.clientHeight / 2; }
  };
}

// ---- the answer ----
function reveal(ctx, fresh) {
  const { state: v, me, view, send } = ctx;
  const r = v.results[v.results.length - 1];
  const g = r.guesses[me];
  if (fresh) {
    document.querySelector('.zoom')?.remove();
    const rows = v.players.slice().sort((a, b) => (r.guesses[a.id]?.km ?? 1e9) - (r.guesses[b.id]?.km ?? 1e9));
    view.innerHTML = `<div class="geo reveal">
        <div class="ask"><div class="kicker">Round ${v.n} of ${ROUNDS} · it was</div><h2 class="role-line">${esc(r.where)}</h2></div>
        <div class="mine ${g?.km == null ? 'none' : ''}">${g?.km == null ? 'No pin this round' : `<span>${kmText(g.km)} off</span><b>+${fmt(g.pts)}</b>`}</div>
        <div id="pmap" class="pmap short"></div>
        <ol class="others">${rows.map(p => `<li class="${p.id === me ? 'me' : ''}"><span><i class="dot" style="background:${colorOf(v, p.id)}"></i>${esc(p.name)}</span>
          <b>${r.guesses[p.id]?.km == null ? '—' : `${kmText(r.guesses[p.id].km)} · +${fmt(r.guesses[p.id].pts)}`}</b></li>`).join('')}</ol>
        <div class="dock" id="dock"></div>
      </div>`;
    newMap(view.querySelector('#pmap'), { worldCopyJump: false });
    const truth = [r.lat, r.lon], pts = [truth];
    L.marker(truth, { icon: truthIcon(), zIndexOffset: 1000 }).addTo(map);
    for (const p of v.players) {
      const q = r.guesses[p.id];
      if (q?.km == null) continue;
      const at = [q.lat, near(q.lon, r.lon)];
      pts.push(at);
      L.polyline([at, truth], { color: colorOf(v, p.id), weight: 2, dashArray: '5 5' }).addTo(map);
      L.circleMarker(at, { radius: p.id === me ? 8 : 6, color: '#15161a', weight: 2, fillColor: colorOf(v, p.id), fillOpacity: 1 }).addTo(map);
    }
    if (pts.length === 1) map.setView(truth, 4); else map.fitBounds(pts, { padding: [30, 30], maxZoom: 8 });
  }
  const dock = view.querySelector('#dock');
  const last = v.n >= ROUNDS;
  dock.innerHTML = ctx.isDealer ? `<button class="big" id="next">${last ? 'Final scores' : 'Next round'}</button>`
    : `<p class="hint center">${last ? 'Final scores' : 'Next round'} in a moment…</p>`;
  const btn = dock.querySelector('#next');
  if (btn) btn.onclick = () => send({ type: 'next' });
}

// ---- the end ----
function over(ctx) {
  const { state: v, me, view, send } = ctx;
  const order = v.players.slice().sort((a, b) => b.score - a.score);
  const top = order[0], youWon = top && top.id === me && !(order[1] && order[1].score === top.score);
  const myPlace = order.findIndex(p => p.id === me) + 1;
  view.innerHTML = `<div class="geo over">
      <h1 class="${youWon ? 'true' : ''}">${youWon ? 'You win!' : top ? `${esc(top.name)} wins.` : 'Game over.'}</h1>
      <p>${myPlace ? `You came ${myPlace}${['st', 'nd', 'rd'][myPlace - 1] || 'th'} with ${fmt(v.players.find(p => p.id === me)?.score || 0)} points.` : ''}</p>
      <ol class="others">${order.map(p => `<li class="${p.id === me ? 'me' : ''}"><span><i class="dot" style="background:${colorOf(v, p.id)}"></i>${esc(p.name)}</span><b>${fmt(p.score)}</b></li>`).join('')}</ol>
      <ol class="places">${v.results.map((r, i) => `<li><span>${i + 1}. ${esc(r.where)}</span><b>+${fmt(r.guesses[me]?.pts || 0)}</b></li>`).join('')}</ol>
      ${ctx.isDealer ? `<button class="big" id="again">Play again</button>` : `<p class="hint">${esc(v.players.find(p => p.connected)?.name || '')} starts the next game.</p>`}
    </div>`;
  view.querySelector('#again') && (view.querySelector('#again').onclick = () => send({ type: 'start' }));
}

startPhone({ game, rules: RULES, draw, count: (q) => fmt(q.score || 0), start: { button: 'Start', verb: 'start', verbs: 'starts' } });
