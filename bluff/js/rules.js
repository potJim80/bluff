// The rules, as the screen and the phones show them. summary: the short version beside the table
// during a game; full: the whole thing, on the screen and the phones before the deal.
export const RULES = {
  summary: [
    "Put down one to four cards face down and say they're the rank it's your turn to claim — Aces, then Twos, and on up to Kings.",
    'Anyone can call <b>Bluff</b>. Caught lying? You take the pile. Told the truth? The caller takes it.',
    'First to run out of cards wins.',
  ],
  full: [
    'The whole deck is dealt out. Two to six players use one deck; seven to ten use two.',
    'The claim walks up the ranks: the first player puts down Aces, the next Twos, then Threes, on up to Kings and round again.',
    "On your turn put down one to four cards face down (up to eight with two decks). They count as the rank it's your turn to claim — true or not.",
    'Everyone else has ten seconds to call <b>Bluff</b>, or tap <i>Let it go</i>.',
    'When someone calls, the cards are turned over. If any of them is not the claimed rank, the player who put them down takes the whole pile. If they were all true, the caller takes it.',
    'First to run out of cards — and survive the call on their last play — wins.',
  ],
};
