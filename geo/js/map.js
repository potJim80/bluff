// What the screen and the phones share for drawing: player colours, numbers, and the map tiles.
// Leaflet (globalThis.L) is loaded by the page.

// One colour per seat, easy to tell apart on the map.
export const COLORS = ['#e0645c', '#5b9bd5', '#6fbf7a', '#e8a33d', '#b07cd8', '#46c1c1', '#e57fb0', '#c9c94a', '#8d7b6a', '#f2f2f2', '#3f7d4e', '#7b8cff'];
export const colorOf = (v, id) => COLORS[Math.max(0, v.players.findIndex(p => p.id === id)) % COLORS.length];

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const kmText = (d) => d < 1 ? 'right there' : `${fmt(d)} km`;

// A longitude moved by whole turns so it sits within 180° of `ref`: lines then take the short way.
export const near = (lon, ref) => lon + 360 * Math.round((ref - lon) / 360);

// OpenStreetMap's own tiles: free, no key, credit shown in the corner. (CARTO's now want a key.)
export function tiles(map) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, minZoom: 1,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}

// Where the photo really was.
export const truthIcon = () => L.divIcon({ className: 'truth', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15] });
// A player's own pin on their phone.
export const pinIcon = (color) => L.divIcon({ className: 'mypin', html: `<span style="background:${color}"></span>`, iconSize: [26, 34], iconAnchor: [13, 32] });
