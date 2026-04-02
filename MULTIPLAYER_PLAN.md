# Multiplayer Implementation Plan — The Road

## Overview

Add 1–4 player cooperative multiplayer to the existing solo game. Solo mode is unchanged. Co-op uses Firebase Realtime Database as the single source of truth, with each player connecting from their own browser via a shared game code.

---

## Tools & Dependencies

| Tool | Purpose |
|---|---|
| **Firebase Realtime Database** | Live game state sync across all clients |
| **Firebase Hosting** (optional) | Host the game publicly so players don't need a local server |
| **Firebase SDK (CDN)** | Add via `<script>` tag — no npm/build needed |

You already have Firebase access. You will need:
- A Firebase project with Realtime Database enabled
- The project's `firebaseConfig` object (from Firebase Console → Project Settings)
- Database rules set to allow read/write (start open for prototype, lock down later)

No authentication is required. Players are identified by their browser session only.

---

## Architecture Overview

```
Browser A (Host/Player 1)          Firebase Realtime DB
   game.html  ──── write ────▶  /games/{gameCode}/
                 ◀─── listen ──    state/
                                   players/
Browser B (Player 2)               turnOrder/
   game.html  ──── write ────▶     round/
                 ◀─── listen ──    chat/ (optional)
```

**Host responsibilities**: The first player to create the game is the host. The host is the only writer for shared game state (deck, slotCards, drawPile, threat resolution). Other players write only their own `playerState`. This prevents race conditions without needing a server.

For a prototype, "host = creator" is the simplest viable pattern. A more robust future approach would use Firebase Cloud Functions to run game logic server-side.

---

## Firebase Data Structure

```
/games/{gameCode}/
  meta/
    hostId: "uuid-of-creator"
    created: timestamp
    status: "lobby" | "active" | "gameover"
    location: 0               ← deckPass (0=Road, 1=Sprawl, 2=Hive)

  players/
    {playerId}/
      name: "Player 1"
      food: 7
      health: 7
      sanity: 7
      mutation: 1
      armor: { head: null, body: null, accessory: null }
      weapons: []
      items: []
      character: "Scavenger"
      eliminated: false
      hasPickedThisRound: false
      slotPickedThisRound: null    ← slot index or null

  sharedState/                    ← host writes, all read
    slotCards: [...]              ← 5-card array (full card objects)
    drawPile: [...]
    discardPile: [...]
    injuredMonsters: [...]
    retainedSlot: null

  round/
    number: 1
    turnOrder: ["p1id","p2id","p3id"]   ← rotates each round
    activePlayerId: "p1id"
    phase: "picking" | "battle" | "ally_request" | "draft" | "end"
    allyRequest/
      requesterId: null
      battleSlot: null
      allies: []                  ← player IDs who have responded
      resolved: false

  log/
    {pushId}: "Player 1 picked Machete from Slot 2"
```

---

## Implementation Phases

### Phase 0 — Firebase Setup (1–2 hours)

1. Add Firebase SDK to `game.html` and `index.html` via CDN `<script>` tags.
2. Create a `firebase-config.js` file with your `firebaseConfig` object. Load it before game logic.
3. Set Realtime Database rules to open for prototype:
   ```json
   { "rules": { ".read": true, ".write": true } }
   ```
4. Write a small `db.js` module (or inline functions) for: `set`, `get`, `onValue`, `push`, `update`. All game code will call these wrappers rather than the Firebase SDK directly — this keeps Firebase calls contained and easy to swap out.

---

### Phase 1 — Lobby & Game Code (2–3 hours)

**On `index.html`:**
- Add a "Multiplayer" option alongside difficulty selection.
- **Create Game**: Generate a 6-character alphanumeric code (e.g., `XK4R9M`). Write a new record to `/games/{code}/meta`. Store `gameCode` and `playerId` (a UUID you generate) in `sessionStorage`. Show a waiting room with the code displayed prominently ("Share this code with your friends").
- **Join Game**: Input field for game code. Validate it exists in Firebase. Add self to `/games/{code}/players/`. Show the waiting room.
- Waiting room shows all connected players with a "Start Game" button (host only, enabled when ≥1 player joined).

**On game start:**
- Host writes initial `sharedState` (shuffled deck, first 5 `slotCards`).
- Host writes initial `round/turnOrder` (shuffle player IDs) and sets `round/activePlayerId`.
- Host writes `meta/status = "active"`.
- All clients detect `status = "active"` and redirect to `game.html`.

---

### Phase 2 — Lift Game State to Firebase (3–5 hours)

This is the heaviest phase. The current game stores everything in JavaScript variables. For multiplayer, all shared state must live in Firebase.

**Strategy**: Keep solo mode completely intact. Gate all Firebase logic behind a `const isMultiplayer = sessionStorage.getItem('multiplayer') === 'true'` flag. When false, the game runs exactly as today.

**Changes needed in `game.html`:**

1. On load, if `isMultiplayer`, read `gameCode` and `playerId` from `sessionStorage`.
2. Replace the `playerState` object with a proxy that syncs to `/games/{code}/players/{playerId}/` on every write. A simple wrapper function `setPlayerStat(key, value)` handles this.
3. The host's `onCardSelected()` writes the resulting `sharedState` (new slotCards, updated drawPile/discardPile) back to Firebase after resolving a pick.
4. All clients `onValue`-listen to `/games/{code}/sharedState/` and update their local display when it changes.
5. All clients `onValue`-listen to `/games/{code}/round/` to know whose turn it is and what the current phase is.

**Key rule**: Non-host clients disable the card-picking UI (slots appear grayed out) except when it is their turn AND the phase is `"picking"`.

---

### Phase 3 — Turn Order & Round Flow (2–3 hours)

**Turn order rotation:**
- `round/turnOrder` is an array of player IDs.
- Each round, the array rotates left by 1: `[A,B,C,D]` → `[B,C,D,A]`.
- `round/activePlayerId` always points to the next player who hasn't picked yet.
- After each pick, the host advances `activePlayerId` to the next player in `turnOrder` who has `hasPickedThisRound: false`.
- When all players have picked (`hasPickedThisRound: true` for all), the round ends:
  - Host resets all `hasPickedThisRound` to `false` and `slotPickedThisRound` to `null`.
  - Host deals new `slotCards`.
  - Host rotates `turnOrder`.
  - Host sets new `activePlayerId`.

**Slot exclusivity:**
- When a player picks a slot, the host writes that slot index to `round/claimedSlots` (an array).
- The UI reads `claimedSlots` in real time and disables/grays claimed slots for all other players.

**Waiting UI:**
- When `round/activePlayerId !== myPlayerId`, show an overlay or banner: *"Waiting for [Player Name]…"* with a subtle animation.
- Display all other players' stats (health, food, sanity, mutation) in a sidebar panel — reading live from `/games/{code}/players/`.

---

### Phase 4 — Cooperative Game Mechanics (3–4 hours)

#### Food Sharing

After a player resolves a gather card that pushes their food above their maximum:
- Show a modal: *"You have excess food. Share with allies?"*
- List available players with a `+1` button for each. They can distribute the overflow.
- Write the delta directly to the recipient's `/players/{id}/food`.

#### Ally System (Battle Assist)

When a player loses a battle (host detects `playerSTR < monsterSTR`):
- In solo: existing die-roll continue prompt — **unchanged**.
- In co-op: host writes to `round/allyRequest` with `requesterId`, `battleSlot`, and the monster's STR.
- All players who have `hasPickedThisRound: false` see an "Ally Needed!" banner with the monster details and an "Answer the Call" button.
- Each ally who clicks sends their `playerId` to `round/allyRequest/allies`.
- The host combines original requester's STR + all ally STRs (each ally uses their full `getPlayerStrength()`).
- If combined STR > monster STR: battle won. Only the requester gets the loot card/benefits.
- If still not enough: request stays open until no more eligible allies or combined STR exceeds monster.
- Answering as an ally consumes that player's turn (`hasPickedThisRound = true`, they skip their card pick this round).
- Host resolves `allyRequest/resolved = true`, clears the request, continues the requester's flow.

#### Player Elimination

- When any player's health ≤ 0, sanity ≤ 0, or mutation ≥ 10: host writes `meta/status = "gameover"`.
- All clients detect this and show the game-over screen with the cause and the eliminated player's name.
- The game ends for everyone — there is no mechanism to continue without all players.

---

### Phase 5 — Draft Phase in Co-op (1–2 hours)

When the deck is exhausted (`onDeckExhausted()`):
- Each player independently runs their own draft (picks 5 from 7 offered cards).
- The host generates draft offers per player and writes them to `/games/{code}/players/{id}/draftOffer`.
- Each client shows their own draft dialog.
- When a player confirms their picks, they write chosen cards to `/games/{code}/players/{id}/draftPicks`.
- The host waits for all players to submit `draftPicks`, then assembles each player's personal deck additions and rebuilds the shared drawPile.
- Host writes updated `sharedState/drawPile` and sets `round/phase = "picking"`.

---

### Phase 6 — Polish & Edge Cases (2–3 hours)

- **Reconnection**: On page load, if `gameCode` exists in `sessionStorage` and `meta/status === "active"`, skip the lobby and rejoin. Re-attach all Firebase listeners.
- **Host migration** (optional, hard): If the host disconnects, elect the next player in `turnOrder` as host. Use Firebase's `onDisconnect()` to detect. For prototype, it's acceptable to end the game if the host leaves.
- **Game log**: Append to `/games/{code}/log/` after every significant event. All clients subscribe and display in a scrollable log panel.
- **Stale game cleanup**: Write a `meta/created` timestamp and advise setting up a Firebase scheduled function (or cron) to delete games older than 24 hours. For prototype, manual cleanup is fine.

---

## File Changes Summary

| File | Change |
|---|---|
| `index.html` | Add multiplayer lobby UI (create/join game code) |
| `game.html` | Add Firebase listeners, multiplayer mode gate, ally/food-share UI |
| `firebase-config.js` | New file — Firebase project config (do not commit to public repo) |
| `db.js` | New file — thin wrappers around Firebase Realtime DB operations |
| `style.css` | Waiting overlay, ally banner, multiplayer sidebar styles |

Solo mode: **zero changes** to existing game logic paths. All multiplayer code runs only when `isMultiplayer === true`.

---

## Recommended Implementation Order

1. Firebase setup + `db.js` wrappers
2. Lobby (game code create/join) on `index.html`
3. Shared state sync for host — get cards showing on all screens
4. Turn order + waiting UI
5. Slot exclusivity
6. Ally system
7. Food sharing
8. Draft phase sync
9. Reconnection + edge cases

---

## Rough Effort Estimate

| Phase | Effort |
|---|---|
| Firebase setup | 1–2 hrs |
| Lobby | 2–3 hrs |
| State lift | 3–5 hrs |
| Turn order | 2–3 hrs |
| Co-op mechanics | 3–4 hrs |
| Draft sync | 1–2 hrs |
| Polish | 2–3 hrs |
| **Total** | **~14–22 hrs** |

The state-lift phase is the riskiest — `game.html` has ~4,000 lines of tightly coupled state. The key to keeping it manageable is the `isMultiplayer` flag: never touch solo paths, only add parallel branches.
