# Ideas for Future Implementation

## Shuffled Slot Environments

Currently, the five gather slots always map to the same environments in order:
`Exposed → Ruin → Water → Dark → Nest`

**Idea:** Randomly assign environments to slots each game (or each round) for more replayability.

**Extended version:** Define a larger pool of environments — more than 5 — so that not all five appear every game. For example, a pool of 8–10 environments drawn down to 5 each round means the board is different every time and players can't build fixed strategies around a known slot order.

Potential additional environments beyond the current five:
- **Ash** — burned-out area, fire damage theme
- **Rot** — decay, disease, organic hazard
- **Wire** — industrial, electrical, fortified
- **Fog** — limited visibility, unpredictable threats
- **Bones** — aftermath of past violence, scavenging theme

**Trade-off:** Locked slots are simpler to teach and allow items/mutations to reference specific environments consistently. Shuffled slots require players to read the board each turn but add significant replayability. A hybrid (shuffle once per location, then lock for that leg) could balance both.

---

## Character Selection

Player selects a character at the start of the game. Each character has a passive benefit (or set of benefits) that shapes their playstyle for the entire run. Selected at the welcome screen alongside difficulty, stored in sessionStorage alongside other starting stats.

### Suggested Characters and Mechanics

| Character | Benefit |
|-----------|---------|
| **Soldier** | +2 base STR in all battles. Starts with a melee weapon. |
| **Medic** | Gain +1 extra Health whenever a gather card heals you. Starts with a First Aid Kit. |
| **Psychologist** | Sanity floor of 2 — cannot drop below 2 Sanity from any source. Starts with a higher Sanity. |
| **Engineer** | Item cards cost 0 food to pick up. Starts with the Backpack already equipped. |
| **Ranger** | −1 threat in Exposed and Ruin slots (stacks with items). Starts with Binoculars. |
| **Scavenger** | When a gather card is discarded without being picked, +1 food (scavenges as the board clears). |
| **Survivalist** | Starvation never costs Sanity — only Health. Starts with extra food. |
| **Cultist** | Mutation cap raised to 12. Each mutation card grants +1 STR instead of penalties. High risk / high reward. |
| **Medic** | Heal 1 extra Health per gather card with a health effect. |
| **Ghost** | Once per location, may skip all threats on a pick for free (no Walkie-Talkie needed). |
| **Brute** | Melee weapons gain +2 STR. Ranged weapons cost +1 extra threat to pick up. |
| **Trader** | Once per location, may swap one card on the board before picking (reroll one slot). |

### Implementation Notes
- Character selection appears on `index.html` before difficulty, or as a second step after difficulty.
- The chosen character is saved to `sessionStorage` and read in `game.html` on load.
- Most benefits are passive modifiers applied at known hook points (gather resolution, battle STR calc, cost modifiers) — no new architecture needed.
- Starting gear bonuses (e.g. Ranger starts with Binoculars) can be handled in the starting gear dialog by pre-equipping the item rather than offering it as a choice.
