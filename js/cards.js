// Card faces and backs, as HTML. Shared by the screen and the phone.
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const label = (r) => r === 'T' ? '10' : r;

export function face(card, extra = '') {
  const red = card[1] === 'H' || card[1] === 'D';
  return `<div class="card ${red ? 'red' : ''} ${extra}" data-card="${card}"><span class="r">${label(card[0])}</span><span class="s">${SUIT[card[1]]}</span><span class="big">${SUIT[card[1]]}</span></div>`;
}

export const back = (extra = '') => `<div class="card back ${extra}"></div>`;
