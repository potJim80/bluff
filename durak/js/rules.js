// The rules, as the screen and the phones show them. summary: the short version beside the table
// during a game; full: the whole thing, on the screen and the phones before the deal.
export const RULES = {
  summary: [
    'The attacker leads a card. The defender must beat it: a higher card of the same suit, or any trump.',
    'Everyone else may throw in cards of ranks already on the table. Beat them all and they’re thrown away; give up and you <b>take</b> the lot.',
    'Nobody wins. The last player still holding cards is the <b>durak</b> — Russian for “fool”.',
  ],
  full: [
    '36 cards, Sixes up to Aces. Everyone gets six. The next card is turned face up: its suit is <b>trumps</b> for the whole game. It goes under the stock and is drawn last.',
    'Whoever holds the lowest trump attacks first, against the next player clockwise — the defender. The attacker leads any one card.',
    'The defender covers each attack card with a higher card of the same suit, or with any trump. A trump can only be beaten by a higher trump.',
    'Anyone but the defender may throw in more cards, but only of ranks already on the table — at most six attack cards, and never more than the defender held at the start.',
    'Beat everything and the cards are thrown away; the defender attacks next. Or tap <b>Take the cards</b>: you pick up the whole table and lose your turn to attack.',
    'After each round everyone draws back up to six — attacker first, defender last. Once the stock is gone, anyone who runs out of cards is out and safe.',
    'Nobody wins. The last player left holding cards is the <b>durak</b> — Russian for “fool”.',
  ],
};
