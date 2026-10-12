# Bluff

The card game (also called Cheat or I Doubt It) as a party game: one big screen, everyone plays
from their phone. Built the same way as [Nomic](https://github.com/potJim80/nomic): plain
HTML/JS, no server, no installs.

- **Screen:** open `index.html` (on GitHub Pages: `https://potjim80.github.io/bluff/`).
  It shows a room code and a QR code.
- **Phones:** scan the QR code, or open `play.html` and type the code.

## Rules

The claim walks Aces, Twos, Threes … Kings, then round again. On your turn you put down one to
four cards face down (up to eight with two decks); they count as the rank it's your turn to
claim, true or not. Everyone else has ten seconds to call **Bluff**, or tap *Let it go*.
If any card isn't that rank, the player who put them down takes the pile; if they were all true,
the caller takes it. First to run out of cards — and survive the call on their last play — wins.
One deck for up to six players, two decks for seven to ten.

## On the screen

Enter deals (or the first player taps *Deal*) · N deals again after a win · click a name to
remove that player (their cards go into the pile) · *Skip turn* appears when the player whose
turn it is has gone away · Shift+Esc clears the table. Reloading the screen resumes the game.

## How it fits together

- `js/game.js` — the rules, a pure reducer. `npm test` (needs Node, nothing else).
- `js/net.js` — public MQTT brokers over websockets, the Nomic transport.
- `js/seal.js` — hands and moves are encrypted per phone (ECDH + AES-GCM), so nobody listening
  on the public broker can read a hand or move for someone else.
- `js/host.js` — the screen holds the whole game, runs the clocks.
- `test/sim.html?view=screen|phone&step=lobby|theirs|window|reveal|mine|over[&live]` — a whole
  table in one page with pretend players, for looking at each moment. Serve the folder over
  http first (`python3 -m http.server`).
