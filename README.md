# Games

Party card games for one big screen, played from phones. Open
[potjim80.github.io/bluff](https://potjim80.github.io/bluff/) on the screen and pick a game; everyone
scans the code and plays from their phone. Plain HTML/JS, no server, no installs.

| Game | Players | What it is |
|---|---|---|
| [Bluff](bluff/) | 2–10 | Put cards down face down and claim the rank. Call it if you think they're lying. |
| [Corner](corner/) | 3–8 | Everyone trades at once. First to hold all nine of one good corners the market. |
| [Kemps](kemps/) | 4, 6 or 8 | Teams of two. Collect four of a kind and signal your partner without a word. |
| [Durak](durak/) | 2–6 | Attack and defend. Nobody wins — the last one holding cards is the fool. |

The full rules of each game are on its start screen (and on the phones) before the deal.

## The party

The room code belongs to the party, not to one game. Go back to *All games* on the screen and open
another game: the code, the people and their seats carry over, and every phone follows the screen
by itself. A game left half-way picks up where it was when you open it again. Anyone removed stays
out. *New party* on the game list sends everyone away and gives the next game a new code.

On the screen: Enter deals (or the first player taps *Deal*) · N deals again after a game · click a
name to remove that player · Shift+Esc starts the current game over with the same people.

## How it fits together

- `common/` — what every game shares.
  - `js/net.js` — public MQTT brokers over websockets; one topic per party, every table says which game it is.
  - `js/seal.js` — hands and moves are encrypted per phone (ECDH + AES-GCM), so nobody listening on the
    public broker can read a hand or move for someone else.
  - `js/host.js` — the screen holds the whole game and runs the clocks; the list of what a game module
    must export is at the top. `js/party.js` keeps the party across games.
  - `js/screen-kit.js`, `js/phone-kit.js` — the screen frame (join panel, QR code, rules, log, seats) and
    the phone side (join form, lobby, following the screen to another game).
  - `js/table.js`, `js/cards.js`, `css/` — small shared rules helpers, card faces, the look.
- One folder per game: `index.html` (screen), `play.html` (phones), `js/game.js` (the rules as a pure
  function: state + move → new state), `js/rules.js` (the rules as shown to players), `js/screen.js`,
  `js/play.js`, and `test/`.
- `npm test` runs every test (needs Node, nothing else). Each game's `test/sim.html?view=screen|phone&step=…`
  shows one moment of a game with pretend players — serve the folder first (`python3 -m http.server`).

### Adding a game

Copy a game folder, rewrite `js/game.js` and `js/rules.js`, then the screen and phone drawing. Add the
folder name to `GAMES` in `common/js/party.js` and a card for it in the top-level `index.html`.
