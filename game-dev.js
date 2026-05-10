/**
 * game-dev.js — Browser console helpers (window.DEV)
 *
 * Loaded before the main game.html inline script.
 * All methods reference globals lazily — safe to load in <head>.
 *
 * Depends on: game-inventory.js (inventory, armorSlots, itemSlots, itemUsesArr,
 *               passiveItems, setInventorySlot, refreshArmorSlot, equipPassiveItem,
 *               updateItemBars, firstEmptyItemSlot, setItemSlot, applyCapacityMechanism)
 *             game-combat.js (_THREAT_LOCS, threatDrawPiles, threatDiscardPiles, threatFull)
 *             game-multiplayer.js (mpSyncInventorySlots)
 *             game-logic.js (setRngSeed)
 * Requires globals from game.html: playerState, deckPass, drawPile, discardPile,
 *   sprawlPool, hivePool, fullDeck, mutantFull, mutantCards, renderMutantPanel,
 *   updateSlotCosts, onMutantCardSpot, gameLog, _rngSeed, maxFood,
 *   survivorCards, renderSurvivorPanel
 */

/* ════════════════════════════════════════════
   DEV CONSOLE HELPERS  (window.DEV)
   Manipulate game state from the browser console.
   Type DEV.help() for a list of commands.
════════════════════════════════════════════ */
window.DEV = {
  help() {
    console.log(
      'DEV helpers:\n' +
      '  DEV.state()                          — current stats, location, deck sizes\n' +
      '  DEV.set({health,sanity,food,mutation}) — set any stats\n' +
      '  DEV.god()                            — max stats, reset mutation to 1\n' +
      '  DEV.deck()                           — list draw pile cards\n' +
      '  DEV.discard()                        — list discard pile cards\n' +
      '  DEV.forceCard(name)                  — move a loot card to front of draw pile\n' +
      '  DEV.forceThreat(name)                — move a threat card to front of threat pile\n' +
      '  DEV.give(name)                       — add a card directly to inventory by name\n' +
      '  DEV.giveSurvivor(name)               — add a survivor card by name (no food cost)\n' +
      '  DEV.giveMutation()                   — trigger the mutant card pick dialog\n' +
      '  DEV.win()                            — trigger victory screen (score tagged dev, hidden from leaderboard)\n' +
      '  DEV.setLocation(name)                — jump to road | sprawl | hive\n' +
      '  DEV.inventory()                      — list all currently held inventory cards\n' +
      '  DEV.seed()                           — show current RNG seed\n' +
      '  DEV.seed(n)                          — reseed RNG (replay a run with ?seed=N)\n' +
      '\nDEV.db helpers (Firebase):\n' +
      '  DEV.db.listGames()                   — list all game sessions with age\n' +
      '  DEV.db.cleanGames(hours=24)          — delete game sessions older than N hours\n' +
      '  DEV.db.nukeGames()                   — delete ALL game sessions\n' +
      '  DEV.db.listScores()                  — list all high scores (including dev-tagged)\n' +
      '  DEV.db.nukeScores()                  — delete ALL high scores\n'
    );
  },

  state() {
    const s = {
      location: ['Road', 'Sprawl', 'Hive', 'Sanctuary'][Math.min(deckPass, 3)],
      stats: {
        health:   playerState.health.value,
        sanity:   playerState.sanity.value,
        food:     playerState.food.value,
        mutation: playerState.mutation.value,
      },
      drawPile:    drawPile.length,
      discardPile: discardPile.length,
      weapon:      inventory.weapon?.name ?? null,
      armor: Object.fromEntries(
        Object.entries(armorSlots).map(([k, v]) => [k, v?.card?.name ?? null])
      ),
      rngSeed: _rngSeed,
    };
    console.log('[DEV] state:', s);
    return s;
  },

  set(obj) {
    ['health', 'sanity', 'food', 'mutation'].forEach(stat => {
      if (obj[stat] !== undefined && playerState[stat]?.set) {
        playerState[stat].set(obj[stat]);
        console.log(`[DEV] ${stat} → ${obj[stat]}`);
      }
    });
  },

  god() {
    this.set({ health: 10, sanity: 10, food: maxFood, mutation: 1 });
    console.log('[DEV] God mode');
  },

  deck() {
    if (!drawPile.length) { console.log('[DEV] Draw pile is empty'); return []; }
    console.table(drawPile.map((c, i) => ({ '#': i, name: c.name, type: c.type })));
    return drawPile;
  },

  discard() {
    if (!discardPile.length) { console.log('[DEV] Discard pile is empty'); return []; }
    console.table(discardPile.map((c, i) => ({ '#': i, name: c.name, type: c.type })));
    return discardPile;
  },

  forceCard(name) {
    const q = name.toLowerCase();
    // Search drawPile, then discardPile, then location pools
    for (const [label, arr] of [
      ['draw pile',    drawPile],
      ['discard pile', discardPile],
      ['sprawl pool',  sprawlPool],
      ['hive pool',    hivePool],
    ]) {
      const idx = arr.findIndex(c => c.name.toLowerCase().includes(q));
      if (idx >= 0) {
        const [card] = arr.splice(idx, 1);
        drawPile.unshift(card);
        console.log(`[DEV] '${card.name}' from ${label} → front of draw pile`);
        return card;
      }
    }
    // Fall back to master deck (covers road cards set aside during initial deal)
    const master = fullDeck.find(c => c.name.toLowerCase().includes(q));
    if (master) {
      drawPile.unshift({ ...master });
      console.log(`[DEV] '${master.name}' injected from master deck → front of draw pile`);
      return master;
    }
    console.warn(`[DEV] No loot card found matching '${name}'`);
    return null;
  },

  forceThreat(name) {
    const q   = name.toLowerCase();
    const loc = _THREAT_LOCS[Math.min(deckPass, 2)];
    const pile = threatDrawPiles[loc] ?? [];
    const idx  = pile.findIndex(c => c.name.toLowerCase().includes(q));
    if (idx >= 0) {
      const [card] = pile.splice(idx, 1);
      pile.unshift(card);
      console.log(`[DEV] Threat '${card.name}' → front of ${loc} draw pile`);
      return card;
    }
    // Inject a fresh copy from the master list
    const card = threatFull.find(c => c.name.toLowerCase().includes(q));
    if (card) {
      pile.unshift({ ...card });
      console.log(`[DEV] Threat '${card.name}' injected at front of ${loc} draw pile`);
      return card;
    }
    console.warn(`[DEV] No threat found matching '${name}'`);
    return null;
  },

  threatDeck(loc) {
    const target = loc
      ? _THREAT_LOCS.find(l => l.toLowerCase().includes(loc.toLowerCase())) ?? _THREAT_LOCS[Math.min(deckPass, 2)]
      : _THREAT_LOCS[Math.min(deckPass, 2)];
    const draw    = threatDrawPiles[target]    ?? [];
    const discard = threatDiscardPiles[target] ?? [];
    console.log(`[DEV] Threat deck — ${target}`);
    console.log(`  Draw (${draw.length}):`, draw.map(c => c.name));
    console.log(`  Discard (${discard.length}):`, discard.map(c => c.name));
    return { location: target, draw, discard };
  },

  threatDeckAll() {
    for (const loc of _THREAT_LOCS) {
      const draw    = threatDrawPiles[loc]    ?? [];
      const discard = threatDiscardPiles[loc] ?? [];
      console.log(`[DEV] ${loc} — draw (${draw.length}): [${draw.map(c => c.name).join(', ')}]  |  discard (${discard.length}): [${discard.map(c => c.name).join(', ')}]`);
    }
  },

  seed(n) {
    if (n === undefined) {
      console.log(`[DEV] Current RNG seed: ${_rngSeed}  (replay: ?seed=${_rngSeed})`);
      return _rngSeed;
    }
    const s = setRngSeed(n);
    console.log(`[DEV] RNG seed set to: ${s}`);
    return s;
  },

  give(name) {
    if (!name) { console.warn('[DEV] Usage: DEV.give("card name")'); return null; }
    const q = name.toLowerCase();
    const card = fullDeck.find(c => c.name.toLowerCase().includes(q));
    if (!card) { console.warn(`[DEV] No card found matching '${name}'`); return null; }
    const c = { ...card };
    if (c.type === 'weapon') {
      setInventorySlot('weapon', c);
      console.log(`[DEV] ${c.name} equipped as weapon`);
    } else if (c.type === 'armor') {
      const slotKey = c.armor_slot ?? 'misc';
      armorSlots[slotKey] = { card: c, pips: { ...c.absorb } };
      refreshArmorSlot(slotKey);
      mpSyncInventorySlots();
      console.log(`[DEV] ${c.name} equipped in armor slot: ${slotKey}`);
    } else if (c.mechanism?.passive || c.mechanism?.type === 'capacity' && c.mechanism.passive) {
      equipPassiveItem(c);
      updateItemBars();
      console.log(`[DEV] ${c.name} added as passive item`);
    } else {
      const slot = firstEmptyItemSlot();
      if (slot < 0) { console.warn(`[DEV] No empty item slot — discard something first`); return null; }
      setItemSlot(slot, c);
      if (c.mechanism?.type === 'capacity') applyCapacityMechanism(c, true);
      updateItemBars();
      console.log(`[DEV] ${c.name} added to item slot ${slot}`);
    }
    gameLog.add(`[DEV] Added: ${c.name}`, 'gold');
    return c;
  },

  giveMutation(name) {
    if (name) {
      const q = name.toLowerCase();
      const card = mutantFull.find(c => c.name.toLowerCase().includes(q));
      if (!card) {
        console.warn(`[DEV] No mutant card found matching '${name}'. Available:`, mutantFull.map(c => c.name));
        return null;
      }
      mutantCards.push(card);
      renderMutantPanel();
      updateSlotCosts();
      console.log(`[DEV] Mutation added: ${card.name}`);
      gameLog.add(`[DEV] Mutation: ${card.name}`, 'gold');
      return card;
    }
    console.log('[DEV] Triggering mutant card pick dialog');
    onMutantCardSpot().then(() => {
      console.log('[DEV] Mutation picked — current mutants:', mutantCards.map(c => c.name));
    });
  },

  giveSurvivor(name) {
    if (!name) { console.warn('[DEV] Usage: DEV.giveSurvivor("card name")'); return null; }
    const q = name.toLowerCase();
    const card = fullDeck.find(c => c.type === 'survivor' && c.name.toLowerCase().includes(q));
    if (!card) {
      const available = fullDeck.filter(c => c.type === 'survivor').map(c => c.name);
      console.warn(`[DEV] No survivor card matching '${name}'. Available:`, available);
      return null;
    }
    const c = { ...card };
    survivorCards.push(c);
    renderSurvivorPanel();
    console.log(`[DEV] ${c.name} added — +${c.points ?? 0} VP (no food cost applied)`);
    gameLog.add(`[DEV] Survivor: ${c.name}`, 'gold');
    return c;
  },

  win() {
    console.log('[DEV] Triggering win condition (score will be tagged dev — hidden from leaderboard)');
    window._DEV_WIN = true;
    triggerYouWin();
  },

  setLocation(name) {
    if (!name) { console.warn('[DEV] Usage: DEV.setLocation("road"|"sprawl"|"hive")'); return; }
    const n = name.toLowerCase();
    const map = { road: 0, sprawl: 1, swarm: 1, hive: 2 };
    const key = Object.keys(map).find(k => n.includes(k) || k.includes(n));
    if (key === undefined) {
      console.warn(`[DEV] Unknown location '${name}'. Use: road, sprawl, hive`);
      return;
    }
    deckPass = map[key];
    const label = ['Road', 'Sprawl', 'Hive'][deckPass];
    console.log(`[DEV] Location → ${label} (deckPass=${deckPass})`);
    gameLog.add(`[DEV] Location: ${label}`, 'gold');
  },

  inventory() {
    const inv = {
      weapon: inventory.weapon?.name ?? null,
      items:  itemSlots.map((c, i) => c ? `[${i}] ${c.name} (${itemUsesArr[i]} uses)` : `[${i}] empty`),
      armor:  Object.fromEntries(Object.entries(armorSlots).map(([k, v]) => [k, v ? `${v.card.name} ${JSON.stringify(v.pips)}` : null])),
      passive: passiveItems.map(c => c.name),
    };
    console.log('[DEV] inventory:', inv);
    return inv;
  },

  db: {
    async listGames() {
      const games = await dbGet('games');
      if (!games) { console.log('[DEV.db] No game sessions in database'); return []; }
      const now = Date.now();
      const rows = Object.entries(games).map(([code, g]) => {
        const created = g.meta?.created ?? 0;
        const ageMin  = Math.round((now - created) / 60000);
        return { code, status: g.meta?.status ?? '?', players: Object.keys(g.players ?? {}).length, ageMin };
      });
      console.table(rows);
      return rows;
    },

    async cleanGames(olderThanHours = 24) {
      const games = await dbGet('games');
      if (!games) { console.log('[DEV.db] No game sessions to clean'); return; }
      const cutoff  = Date.now() - olderThanHours * 3600000;
      const toDelete = Object.entries(games)
        .filter(([, g]) => (g.meta?.created ?? 0) < cutoff)
        .map(([code]) => code);
      if (!toDelete.length) { console.log(`[DEV.db] No games older than ${olderThanHours}h`); return; }
      await Promise.all(toDelete.map(code => dbRemove(gamePath(code))));
      console.log(`[DEV.db] Removed ${toDelete.length} game(s): ${toDelete.join(', ')}`);
    },

    async nukeGames() {
      await dbRemove('games');
      console.log('[DEV.db] All game sessions removed');
    },

    async listScores() {
      const raw = await dbGet('highscores');
      if (!raw) { console.log('[DEV.db] No scores in database'); return []; }
      const rows = Object.entries(raw).map(([key, s]) => ({
        key, name: s.name, score: s.score, difficulty: s.difficulty, mode: s.mode, dev: s.dev ?? false, date: s.date,
      }));
      rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      console.table(rows);
      return rows;
    },

    async nukeScores() {
      await dbRemove('highscores');
      console.log('[DEV.db] All high scores removed');
    },
  },
};
console.log('[DEV] helpers ready — type DEV.help() for commands');
