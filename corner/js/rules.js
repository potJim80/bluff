// The rules, as the screen and the phones show them. summary: the short version beside the table
// during a game; full: the whole thing, on the screen and the phones before the deal.
export const RULES = {
  summary: [
    'No turns: everyone trades at once. Offer one to four cards of one good; everyone sees how many, not what.',
    'When someone else offers the same number, you swap.',
    'All nine of a good <b>corners</b> it. Dump the Bear. First to 500 wins.',
  ],
  full: [
    'One good per player (five players use the first five), nine cards of each, plus the <b>Bull</b> and the <b>Bear</b>. Everyone gets nine cards; two players get ten.',
    'No turns: when the screen says <b>Trade</b>, everyone trades at once.',
    'Offer one to four cards of one good. Everyone sees how many you offer, not what. A new offer replaces your old one.',
    'When someone else offers the same number, you swap cards on the spot.',
    'Hold all nine of a good, or eight and the Bull, to <b>corner</b> it: the round ends and you score its value, Wheat 100 down to Oranges 50. Nine and the Bull scores double.',
    'You can’t corner while you hold the Bear: slip it into an offer. When someone corners, anyone else holding the Bear or the Bull loses 20 for each.',
    'Rounds keep coming until someone reaches 500 points.',
  ],
};
