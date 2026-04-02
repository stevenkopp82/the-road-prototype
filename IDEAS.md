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
| **Soldier** | +1 base STR in all battles. Starts with the handgun. |
| **Medic** | Gain +1 extra Health whenever a gather card heals you. Starts with +2 health. |
| **Survivalist** | Gain +1 extra food whenever a food card heals you. Starts with the Backpack. |
| **Psychologist** | Gain +1 extra Sanity whenver a gather card increases sanity. Starts with +2 sanity |
| **Hunter** | Gain +2 whenever he wins a battle. Starts with the bow and arrow |

### Implementation Notes
- Eliminate the gear selection dialog, since some characters start with gear.
- Character selection appears on `index.html` before difficulty.
- The chosen character is saved to `sessionStorage` and read in `game.html` on load.
- Most benefits are passive modifiers applied at known hook points (gather resolution, battle STR calc, cost modifiers) — no new architecture needed.
- Starting gear bonuses (e.g. Ranger starts with Binoculars) can be handled in the starting gear dialog by pre-equipping the item rather than offering it as a choice.
