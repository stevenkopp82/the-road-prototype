# The Road Prototype — CLAUDE.md

## Project Overview

**The Road** is a post-apocalyptic survival board game prototype implemented as a self-contained web application. Players navigate three locations (The Road → The Sprawl → The Hive), manage resources, gather loot, battle threats, and acquire mutant abilities.

## Tech Stack

- **Pure vanilla HTML/CSS/JavaScript** — no frameworks, no build tools, no npm
- **Data**: JSON files for card definitions
- **Server**: Python HTTP server for local development

## Running the Project

```bash
python3 -m http.server
# Open http://localhost:8000/index.html
```

No build step required.

## Project Structure

```
index.html          # Entire game — HTML, CSS (~3,800 lines), and JS (~3,500 lines) in one file
loot-deck.json      # 70 loot cards (weapons, armor, items, vehicles, gather)
threat-deck.json    # 36 threat cards (break/setback/monster) across 3 locations
mutant-deck.json    # 9 mutant ability cards
the_road_components.pdf  # Game design reference document
README.md
```

## Key Architecture Notes

`index.html` is the single source of truth — all game logic, state, and UI live here. There is no separate build output or compiled artifact.

**Game state** is managed in JavaScript variables (no localStorage, no backend).

**Game over conditions**: health ≤ 0, sanity ≤ 0, or mutation ≥ 10.

### Card Data Format

All three JSON decks follow a similar schema:

```json
{
  "name": "Machete",
  "location": "road",          // road | sprawl | hive
  "type": "weapon",            // gather | weapon | vehicle | item | armor
  "effects": { "food": 0, "health": 0, "sanity": 0, "mutation": 0 },
  "strength": 4,               // weapons only
  "uses": 3,                   // weapons/vehicles
  "value": 12,                 // balance weight
  "icon": "🔪"
}
```

## Editing Guidelines

- **All game logic changes go in `index.html`** — search for JavaScript function names with Grep to locate them quickly.
- **Card balance changes go in the JSON files** — each card has a `value` field for tracking relative power.
- When adding new cards, follow the existing schema exactly; the game engine reads specific property names.
- The three locations have intentionally escalating difficulty — keep that in mind when adding/adjusting cards.

## Common Tasks

**Add a new loot card**: Edit `loot-deck.json`, follow the existing schema for the appropriate type.

**Change game stats or balancing**: Search `index.html` for the relevant mechanic (e.g., `starvation`, `battleResult`, `threatCost`).

**Find a specific game mechanic**: Use Grep on `index.html` — the JS starts around line 3,806.

## No Tests

There is no automated test suite. Verification is done by running the game in a browser.
