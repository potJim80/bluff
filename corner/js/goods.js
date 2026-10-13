// Goods cards, as HTML. Shared by the screen and the phone. Same cream card as the playing cards
// (common/css/cards.css); the colour band and the marks for the Bull and the Bear are in css/game.css.
import { isGood, goodOf, goodInfo } from './game.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The name of what a card is: 'Coffee', 'Bull', 'Bear'.
export const cardName = (card) => isGood(card) ? goodInfo(goodOf(card))?.name || '?' : card === 'bull' ? 'Bull' : 'Bear';
// The colour class for a card or a good id: 'g-coffee', 'g-bull'…
export const colourOf = (cardOrGood) => 'g-' + (isGood(cardOrGood) ? goodOf(cardOrGood) : cardOrGood);

// One card. The Bull and the Bear carry an up or a down mark on their band instead of a value.
export function goodCard(card, extra = '') {
  const value = isGood(card) ? goodInfo(goodOf(card))?.value ?? '' : '';
  const mark = card === 'bull' ? '<i class="mark up"></i>' : card === 'bear' ? '<i class="mark down"></i>' : '';
  return `<div class="card good ${colourOf(card)} ${extra}" data-card="${esc(card)}"><span class="gname">${cardName(card)}</span><span class="band">${mark}</span><span class="gval">${value}</span></div>`;
}

// "3 Coffee", "the Bear", "2 Wheat and the Bull": what a handful of cards is, in words.
export function describe(cards) {
  const parts = [];
  const counts = new Map();
  for (const c of cards) if (isGood(c)) counts.set(goodOf(c), (counts.get(goodOf(c)) || 0) + 1);
  for (const [g, n] of counts) parts.push(`${n} ${goodInfo(g)?.name || '?'}`);
  if (cards.includes('bull')) parts.push('the Bull');
  if (cards.includes('bear')) parts.push('the Bear');
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || 'nothing';
}
