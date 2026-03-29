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
index.html          # Welcome screen: lore, difficulty selection, links to game/rules
game.html           # Full game: all dialogs, boards, game JS (~4,000 lines)
style.css           # All CSS shared by index.html and game.html (~3,100 lines)
catalog.html        # Card catalog viewer (reads from JSON, no game logic)
loot-deck.json      # Loot cards (weapons, armor, items, gather)
threat-deck.json    # 36 threat cards (break/setback/monster) across 3 locations
mutant-deck.json    # 9 mutant ability cards
SVGs/               # Card icons
the_road_components.pdf  # Game design reference document
README.md
```

## Key Architecture Notes

`index.html` is the welcome screen. On difficulty selection it saves settings to `sessionStorage` and navigates to `game.html`. `game.html` reads those settings on load, immediately shows the starting gear dialog, then starts the game. All styling lives in `style.css`. There is no build output or compiled artifact.

**Game state** is managed in JavaScript variables (no localStorage, no backend).

**Game over conditions**: health ≤ 0, sanity ≤ 0, or mutation ≥ 10.

**Armor mode only** — the vehicle/movement variant has been removed. Three armor slots (Head, Body, Accessory) absorb incoming damage. Sanity modifies combat STR instead of SPD.

### Card Data Format

All three JSON decks follow a similar schema:

```json
{
  "name": "Machete",
  "location": "road",          // road | sprawl | hive
  "type": "weapon",            // gather | weapon | item | armor
  "effects": { "food": 0, "health": 0, "sanity": 0, "mutation": 0 },
  "strength": 4,               // weapons only
  "uses": 3,                   // weapons only
  "value": 12,                 // balance weight
  "icon": "SVGs/machete.svg"   // or emoji fallback
}
```

Item cards also carry a `mechanism` field that drives all item special behavior — see the MECHANISM ENGINE block in `game.html`.

## Editing Guidelines

- **CSS changes go in `style.css`** — the file mirrors the structure of the HTML so sections are easy to find.
- **Game logic changes go in `game.html`** — use Grep on function names to locate them quickly.
- **Card balance changes go in the JSON files** — each card has a `value` field for tracking relative power.
- When adding new cards, follow the existing schema exactly; the game engine reads specific property names.
- The three locations have intentionally escalating difficulty — keep that in mind when adding/adjusting cards.

## Common Tasks

**Add a new loot card**: Edit `loot-deck.json`, follow the existing schema for the appropriate type.

**Change game stats or balancing**: Search `game.html` for the relevant mechanic (e.g., `starvation`, `battleResult`, `threatCost`).

**Find a specific game mechanic**: Use Grep on `game.html` — the JS starts around line 640.

**Browse all cards visually**: Open `catalog.html` via the local server.

## No Tests

There is no automated test suite. Verification is done by running the game in a browser.
