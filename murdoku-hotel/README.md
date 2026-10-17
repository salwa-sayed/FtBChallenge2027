# Late Checkout

A co-op hotel murder mystery for phones. Everyone joins a room with a 4-letter code and solves **one shared floor plan** together, live. The rooms are hotel areas (lobby, kitchen, spa, pool deck...) and the suspects are hotel staff.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

To play from other phones on the same wifi, open `http://<your-computer-ip>:3000`. To play from different networks, deploy it (below).

Set your hotel's name shown in the game:

```bash
HOTEL_NAME="Seaview Hotel" npm start
```

## How the game works

- 6 staff, 6x6 floor plan: each staff member stands on a **different row and column**. Nobody stands on the 💀 square.
- Clues place people by room, item ("at the piano", "beside the sofa"), column/row, compass direction, diagonal contact, who shares a room, and how many staff are in a room.
- The culprit is the **only staff member in the same room as the victim**.
- Everyone edits the same board and the same clue list. Tokens show which player placed them.
- To win you need the **correct board and the correct suspect**. A wrong accusation costs a strike (3 strikes and the culprit escapes), and never says which part was wrong, so guessing among six names doesn't work.

## Project layout

| Path | What it does |
| --- | --- |
| `server.js` | Express + Socket.IO. Thin layer that routes events to the game logic. |
| `lib/game.js` | Rooms, players, board, accusations. The answer never leaves the server until a case ends. |
| `lib/puzzle.js` | Clue types, solver (counts solutions), generator. |
| `lib/layouts.js` | The three floor plans. **Edit this to add your own rooms and items.** |
| `data/puzzles.json` | 45 pre-generated puzzles, each verified to have exactly one solution. |
| `scripts/generate.js` | Makes more puzzles: `npm run generate -- 10` (10 per floor per difficulty). |
| `public/` | The mobile web client (plain HTML/CSS/JS, no build step). |
| `test/` | `npm test` checks every puzzle and plays a full 3-player game over real sockets. |

## Make it yours

- **Rooms and items:** edit `lib/layouts.js`. Each floor is a 6x6 grid of room letters plus items with emoji. Keep every room one connected area and run `npm run generate` (it validates the layouts).
- **Staff and victims:** edit `STAFF_POOL` and `VICTIMS` at the top of `lib/puzzle.js`.
- **Colours and look:** `public/style.css` (variables at the top).
- **Difficulty:** Easy/Medium/Hard differ by how many extra clues are added on top of the minimum needed.

## Deploy (so friends on any network can play)

It's a single Node process with state in memory, so any Node host works (Render, Railway, Fly.io...).

1. Push this folder to GitHub.
2. Create a web service from the repo: build `npm install`, start `npm start`.
3. Set `HOTEL_NAME` if you want. The host provides `PORT` automatically.
4. Share the link. The invite button in the lobby shares `?room=CODE` so friends land on the join screen.

Keep it to **one instance**: rooms live in that process's memory. If the server restarts, in-progress games are lost (finished puzzles and the puzzle bank are unaffected).

## Reconnecting

Each phone stores its room and player id in `localStorage`. Refreshing, locking the screen or losing signal drops you back into your seat. If the host goes offline for 20 seconds, the host role passes to someone online.

## Ideas for next steps

Voice/text chat, a "ping this square" tap for pointing things out, QR code join, sound effects, a daily shared puzzle, saving solve times, home-screen app icons in PNG.
