# Late Checkout

A co-op **Murdoku** spinoff for hotels. Six staff members were working the floor when a guest turned up dead. Everyone joins a room with a 4-letter code and solves **one shared floor plan** together, live, each on their own phone.

**Play it now: [hotel-murdoku.onrender.com](https://hotel-murdoku.onrender.com)**

> On the free tier the server sleeps when idle — the first visit can take up to a minute to wake it up.

The rooms are hotel areas (lobby, kitchen, spa, pool deck...) and the suspects are hotel staff.

## Play with friends

1. Open **[hotel-murdoku.onrender.com](https://hotel-murdoku.onrender.com)** on your phone.
2. One person taps **Start a new case** and shares the 4-letter room code (or taps **Invite friends** to send a link that joins directly).
3. Everyone else enters the code and taps **Join**. The host picks a difficulty and opens the case.

Everyone can pick their own language on the home screen, so a mixed-language group can play together.

## How the game works

Murdoku-style logic, co-op: a 6x6 floor plan, six suspects, one solution.

- 6 staff, 6x6 floor plan: each staff member stands on a **different row and column**. Nobody stands on the 💀 square.
- Clues place people by room, item ("at the piano", "beside the sofa"), column/row, compass direction, diagonal contact, who shares a room, and how many staff are in a room.
- The culprit is the **only staff member in the same room as the victim**.
- Everyone edits the same board and the same clue list. Tokens show which player placed them.
- To win you need the **correct board and the correct suspect**. A wrong accusation costs a strike (3 strikes and the culprit escapes), and never says which part was wrong, so guessing among six names doesn't work.

The twist over solo Murdoku is that there's no single solver: the board and the crossed-off clues are shared, so you have to talk to each other, split the clues, and agree on an accusation.

(we will add a chat feature in the near future)

## Languages

The UI, clues, room names, item names, staff roles, victim titles, and server error messages are all translated per player — each phone can pick its own language, and mixed-language groups work fine.

Currently available:

- **English** (`locales/en.json`)
- **French** (`locales/fr.json`)

Players pick a language on the home screen; the choice is remembered in `localStorage`. Staff first names and victim names are kept as-is (they're character names, not vocabulary).

### Add a language

1. Copy `locales/en.json` to `locales/<code>.json` (e.g. `es.json`) and translate the values.
2. In `public/app.js`, add the language to the `LANGS` map:
   ```js
   const LANGS = { en: 'English', fr: 'Français', es: 'Español' };
