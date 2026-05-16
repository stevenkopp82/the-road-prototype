/**
 * game-multiplayer.js — Multiplayer module (Firebase RTDB co-op)
 *
 * Loaded before the main game.html inline script.
 * All mp variables are declared with `var` so they are accessible
 * as window properties from the main script.
 *
 * Depends on: db.js (Firebase path helpers + dbGet/dbSet/dbUpdate/dbListen etc.)
 * Requires these globals set by game.html's inline script at runtime:
 *   playerState, gameLog, gameOver, slotCards, drawPile, discardPile,
 *   deckPass, gameDealCount, passStartDeckSize, lootZones, cardSelected,
 *   injuredMonsters, inventory, itemSlots, armorSlots, mutantCards, charDef,
 *   DRAW_SLOTS
 */

/* ══════════════════════════════════════════════════════════════
   MULTIPLAYER STATE
   All code in this block is gated on isMultiplayer === true.
   Solo paths are never touched.
══════════════════════════════════════════════════════════════ */

var isMultiplayer  = sessionStorage.getItem('multiplayer') === 'true';
var mpGameCode     = sessionStorage.getItem('gameCode');
var mpPlayerId     = sessionStorage.getItem('playerId');
// Consumed once: true when arriving directly from the lobby (not a browser refresh/reconnect)
var mpFreshStart   = sessionStorage.getItem('mpFreshStart') === 'true';
sessionStorage.removeItem('mpFreshStart');

var mpIsHost    = false;   // true if this client created the game
var mpMyName    = '';      // display name from Firebase
var mpRound     = null;    // latest round snapshot from Firebase
var mpAllPlayers = {};     // all players snapshot from Firebase

// Unsubscribe handles — cleaned up on game over / page unload
var _mpUnsubRound = null, _mpUnsubShared = null,
    _mpUnsubPlayers = null, _mpUnsubMeta = null;

// Holds log-sync helpers set up by mpInit (null until mpInit runs)
var mpGameLog = null;

// ── Overlay helpers ─────────────────────────────────────────────────
function mpShowWaiting(name) {
  document.getElementById('mp-turn-name').textContent = name || 'another player';
  document.getElementById('mp-turn-overlay').classList.remove('mp-hidden');
}
function mpHideWaiting() {
  document.getElementById('mp-turn-overlay').classList.add('mp-hidden');
}
function mpShowYourTurnNotice() {
  const el = document.getElementById('mp-your-turn-badge');
  if (el) el.classList.remove('mp-hidden');
}
function mpHideYourTurnNotice() {
  const el = document.getElementById('mp-your-turn-badge');
  if (el) el.classList.add('mp-hidden');
}

// ── Visual: gray out a slot that was just claimed without clearing others ──
function mpMarkSlotClaimed(slotIndex) {
  const zone = lootZones[slotIndex];
  if (!zone) return;
  slotCards[slotIndex] = null;
  zone.innerHTML = '';
  zone.classList.remove('has-card', 'locked');
  zone.classList.add('slot-disabled');
  const icon = document.createElement('span');
  icon.className = 'loot-icon';
  icon.textContent = '✓';
  zone.appendChild(icon);
  const lbl = document.createElement('div');
  lbl.className = 'loot-label';
  lbl.textContent = 'taken';
  zone.appendChild(lbl);
}

// ── Render a sparse slotCards array (some slots may be null/claimed) ──
function mpApplySlotCards(stateSlotCards) {
  if (!stateSlotCards) return;
  const arr = Array.isArray(stateSlotCards)
    ? stateSlotCards
    : Object.values(stateSlotCards); // Firebase can return objects for arrays
  slotCards = Array(DRAW_SLOTS).fill(null);
  lootZones.slice(0, DRAW_SLOTS).forEach((zone, i) => {
    const card = arr[i] ?? null;
    zone.innerHTML = '';
    zone.classList.remove('has-card', 'locked', 'slot-disabled');
    if (!card) {
      zone.classList.add('slot-disabled');
      const icon = document.createElement('span');
      icon.className = 'loot-icon';
      icon.textContent = '📦';
      zone.appendChild(icon);
    } else {
      slotCards[i] = card;
      zone.classList.add('has-card');
      zone.appendChild(renderCard(card));
      zone.addEventListener('mouseenter', () => showMagnifier(card, zone, i));
      zone.addEventListener('mouseleave', hideMagnifier);
    }
  });
}

// ── Sync this player's stats and inventory to Firebase ──
function mpWriteMyState() {
  if (!isMultiplayer) return Promise.resolve();
  return dbUpdate(playerPath(mpGameCode, mpPlayerId), {
    food:       playerState.food.value,
    health:     playerState.health.value,
    sanity:     playerState.sanity.value,
    mutation:   playerState.mutation.value,
    inv:        typeof serializeInventory === 'function' ? serializeInventory() : null,
    mutantCards: mutantCards ? mutantCards.map(c => ({ ...c })) : [],
  });
}

// ── Write shared board / deck state to Firebase (active player writes this) ──
function mpWriteSharedState(currentSlotCards) {
  if (!isMultiplayer) return Promise.resolve();
  // Ensure no undefined in arrays (Firebase rejects undefined)
  const safeSlots = (currentSlotCards || slotCards).map(c => c ?? null);
  return dbSet(sharedStatePath(mpGameCode), {
    slotCards:          safeSlots,
    drawPile:           drawPile,
    discardPile:        discardPile,
    injuredMonsters:    injuredMonsters,
    deckPass:           deckPass,
    threatDrawPiles:    threatDrawPiles,
    threatDiscardPiles: threatDiscardPiles,
  });
}

// ── Apply threat pile state from Firebase (handles array/object mismatch) ──
function _applyThreatPilesFromState(state) {
  const toArr = v => v == null ? [] : (Array.isArray(v) ? v : Object.values(v));
  if (state.threatDrawPiles) {
    for (const loc of _THREAT_LOCS) {
      threatDrawPiles[loc]   = toArr(state.threatDrawPiles[loc]);
    }
  }
  if (state.threatDiscardPiles) {
    for (const loc of _THREAT_LOCS) {
      threatDiscardPiles[loc] = toArr(state.threatDiscardPiles[loc]);
    }
  }
}

// ── Ally sidebar ──────────────────────────────────────────────────────
function mpRenderAllySidebar(players) {
  const el = document.getElementById('mp-ally-sidebar');
  if (!el) return;
  el.innerHTML = '';
  const others = Object.entries(players).filter(([id]) => id !== mpPlayerId);
  others.forEach(([id, p]) => {
    const card = document.createElement('div');
    card.className = 'mp-ally-card' + (id === mpRound?.activePlayerId ? ' mp-ally-active' : '');
    card.innerHTML =
      `<div class="mp-ally-name">${p.name ?? 'Ally'}</div>` +
      `<div class="mp-ally-stats">` +
      `<span>🌾 ${p.food ?? '?'}</span>` +
      `<span>❤️ ${p.health ?? '?'}</span>` +
      `<span>🧠 ${p.sanity ?? '?'}</span>` +
      `<span>🧬 ${p.mutation ?? '?'}</span>` +
      `</div>`;
    el.appendChild(card);
  });
  el.style.display = others.length > 0 ? 'flex' : 'none';
}

// ── Phase 5: Co-op Draft Phase ─────────────────────────────────────
// Each player drafts independently. The host assembles the shared drawPile
// once everyone has submitted their picks.
async function mpRunDraftPhase(pool, locationName) {
  const draftBasePath = `games/${mpGameCode}/draft`;

  // ── Step A: Host writes per-player draft offers ──
  const allPlayers = await dbGet(playersPath(mpGameCode));
  const playerIds  = Object.keys(allPlayers || {});
  const DRAFT_PICK = getDraftPick(gameDealCount);
  const DRAFT_DRAW = getDraftDraw(gameDealCount);

  if (mpIsHost) {
    // Clear any previous draft data
    await dbRemove(draftBasePath);
    // Generate a unique shuffled offer for each player
    const writes = playerIds.map(id => {
      const offer = shuffle([...pool]).slice(0, Math.min(DRAFT_DRAW, pool.length));
      return dbSet(`${draftBasePath}/offers/${id}`, offer);
    });
    await Promise.all(writes);
    // Signal all clients that offers are ready
    await dbSet(`${draftBasePath}/phase`, 'offering');
  } else {
    // Non-host: wait until offers are written
    await new Promise(resolve => {
      const unsub = dbListen(`${draftBasePath}/phase`, phase => {
        if (phase === 'offering') { unsub(); resolve(); }
      });
    });
  }

  // ── Step B: Each player picks from their own offer ──
  const myOffer = await dbGet(`${draftBasePath}/offers/${mpPlayerId}`);
  if (!myOffer) return []; // safety

  const offerArr = Array.isArray(myOffer) ? myOffer : Object.values(myOffer);
  const picked   = await runDraftPhase(offerArr, locationName);

  // Write this player's picks to Firebase
  await dbSet(`${draftBasePath}/picks/${mpPlayerId}`, picked);
  gameLog.add(`📦 Draft submitted: ${picked.map(c => c.name).join(', ')}`, 'gold');

  // ── Step C: Show waiting overlay until all players have submitted ──
  const waitOverlay = document.getElementById('mp-draft-waiting');
  const waitList    = document.getElementById('mp-draft-wait-list');
  waitOverlay.classList.remove('hidden');

  const allPicks = await new Promise(resolve => {
    const unsub = dbListen(`${draftBasePath}/picks`, picks => {
      // Update the waiting list UI
      waitList.innerHTML = '';
      playerIds.forEach(id => {
        const row = document.createElement('div');
        row.className = 'mp-draft-wait-row';
        const name = allPlayers[id]?.name ?? 'Ally';
        const done = picks?.[id] != null;
        row.innerHTML = `<span>${name}</span><span class="${done ? 'mp-draft-wait-done' : 'mp-draft-wait-pending'}">${done ? '✓ Ready' : 'Drafting...'}</span>`;
        waitList.appendChild(row);
      });

      if (picks && playerIds.every(id => picks[id] != null)) {
        unsub();
        resolve(picks);
      }
    });
  });

  waitOverlay.classList.add('hidden');

  // ── Step D: Host assembles the shared drawPile from all picks + discard ──
  if (mpIsHost) {
    const allPicked = playerIds.flatMap(id => {
      const p = allPicks[id];
      return Array.isArray(p) ? p : Object.values(p || {});
    });
    const newDeck = shuffle([...discardPile, ...allPicked]);
    // Normalize to a multiple of DRAW_SLOTS (same guard as solo path)
    const _rem = newDeck.length % DRAW_SLOTS;
    if (_rem !== 0) newDeck.splice(newDeck.length - _rem, _rem);
    drawPile        = newDeck;
    passStartDeckSize = drawPile.length;
    discardPile     = [];
    await mpWriteSharedState([...slotCards]);
    await dbRemove(draftBasePath);
  } else {
    // Non-host: wait for host to write the new sharedState drawPile
    await new Promise(resolve => {
      const unsub = dbListen(sharedStatePath(mpGameCode), state => {
        if (state?.drawPile && (Array.isArray(state.drawPile) ? state.drawPile : Object.values(state.drawPile)).length > 0) {
          drawPile    = Array.isArray(state.drawPile) ? state.drawPile : Object.values(state.drawPile);
          discardPile = [];
          passStartDeckSize = drawPile.length;
          unsub();
          resolve();
        }
      });
    });
  }

  updateDeckCount();
  return [];  // drawPile is set directly; caller doesn't need the array
}

// ── Phase 4: Food Sharing ──────────────────────────────────────────
// Called after a food gather when the player ends up at maxFood.
// Returns a promise that resolves when the player clicks Done.
async function mpOfferFoodShare(excessFood) {
  if (!isMultiplayer || excessFood <= 0) return;

  const others = Object.entries(mpAllPlayers).filter(([id]) => id !== mpPlayerId);
  if (others.length === 0) return; // solo in co-op session, nothing to share

  // Build the modal
  const dialog   = document.getElementById('mp-food-share-dialog');
  const subEl    = document.getElementById('mp-food-share-sub');
  const poolEl   = document.getElementById('mp-food-pool-count');
  const rowsEl   = document.getElementById('mp-food-rows');
  const confirmBtn = document.getElementById('mp-food-share-confirm');

  let poolLeft = excessFood;
  const allocations = {}; // playerId → amount to give
  others.forEach(([id]) => { allocations[id] = 0; });

  subEl.textContent = `You reached max food. Distribute up to ${excessFood} 🌾 to allies.`;
  poolEl.textContent = poolLeft;
  rowsEl.innerHTML = '';

  const amountEls = {};

  others.forEach(([id, p]) => {
    const row = document.createElement('div');
    row.className = 'mp-food-row';
    const nameEl = document.createElement('div');
    nameEl.className = 'mp-food-row-name';
    nameEl.textContent = `${p.name} (🌾 ${p.food ?? '?'})`;
    const controls = document.createElement('div');
    controls.className = 'mp-food-row-controls';
    const minusBtn = document.createElement('button');
    minusBtn.className = 'mp-food-adj-btn';
    minusBtn.textContent = '−';
    minusBtn.disabled = true;
    const amtEl = document.createElement('span');
    amtEl.className = 'mp-food-row-amount';
    amtEl.textContent = '0';
    amountEls[id] = amtEl;
    const plusBtn = document.createElement('button');
    plusBtn.className = 'mp-food-adj-btn';
    plusBtn.textContent = '+';
    plusBtn.disabled = poolLeft <= 0;

    plusBtn.addEventListener('click', () => {
      if (poolLeft <= 0) return;
      allocations[id]++;
      poolLeft--;
      amtEl.textContent = allocations[id];
      poolEl.textContent = poolLeft;
      minusBtn.disabled = false;
      // Disable all + buttons if pool empty
      rowsEl.querySelectorAll('.mp-food-adj-btn:last-child').forEach(b => {
        b.disabled = poolLeft <= 0;
      });
    });
    minusBtn.addEventListener('click', () => {
      if (allocations[id] <= 0) return;
      allocations[id]--;
      poolLeft++;
      amtEl.textContent = allocations[id];
      poolEl.textContent = poolLeft;
      plusBtn.disabled = false;
      minusBtn.disabled = allocations[id] <= 0;
    });

    controls.appendChild(minusBtn);
    controls.appendChild(amtEl);
    controls.appendChild(plusBtn);
    row.appendChild(nameEl);
    row.appendChild(controls);
    rowsEl.appendChild(row);
  });

  dialog.classList.remove('hidden');

  await new Promise(resolve => {
    confirmBtn.onclick = () => {
      confirmBtn.onclick = null;
      resolve();
    };
  });

  dialog.classList.add('hidden');

  // Push the player's own food to Firebase first (it was only set locally),
  // so the player-state listener doesn't reset it when ally writes fire.
  await mpWriteMyState();

  // Write food deltas to Firebase for each recipient
  const writes = Object.entries(allocations).filter(([, amt]) => amt > 0).map(([id, amt]) => {
    const recipientFood = mpAllPlayers[id]?.food ?? 0;
    const newFood = Math.min(mpAllPlayers[id]?.food != null ? 10 : 10, recipientFood + amt);
    gameLog.add(`🌾 Shared ${amt} food with ${mpAllPlayers[id]?.name ?? 'ally'}`, 'good');
    return dbUpdate(playerPath(mpGameCode, id), { food: newFood });
  });
  await Promise.all(writes);
}

// ── Phase 4: Ally Battle System ────────────────────────────────────
// Called by the active player when they lose a first battle in co-op.
// Returns a promise that resolves to: { won: bool, combinedStr: number } where combinedStr is ally STR only
async function mpRequestAllies(card, monsterStr, myStr, abandonBtn) {
  const allyRequestPath = `${roundPath(mpGameCode)}/allyRequest`;

  // Write the request to Firebase — eligible allies will see the banner
  await dbSet(allyRequestPath, {
    requesterId:  mpPlayerId,
    monsterName:  card.name,
    monsterStr,
    requesterStr: myStr,
    allies:       {},
    resolved:     false,
  });

  // Show the requester's waiting banner
  const waitEl   = document.getElementById('mp-ally-waiting');
  const waitText = document.getElementById('mp-ally-wait-text');
  waitEl.classList.remove('hidden');

  // All other players are eligible to help (helping doesn't cost a turn)
  const players = await dbGet(playersPath(mpGameCode));
  const eligible = Object.entries(players || {})
    .filter(([id]) => id !== mpPlayerId);

  if (eligible.length === 0) {
    // No allies available — fall through to die roll
    waitEl.classList.add('hidden');
    await dbRemove(allyRequestPath);
    return { won: false, combinedStr: 0 };
  }

  // Poll for ally responses with a 30-second timeout
  const result = await new Promise(resolve => {
    let timeout = null;
    let settled = false;
    let unsub;

    const settle = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (unsub) unsub();
      resolve(val);
    };

    unsub = dbListen(allyRequestPath, req => {
      if (!req) { settle({ won: false, combinedStr: 0 }); return; }

      const alliedIds = Object.keys(req.allies || {});
      const combinedStr = alliedIds.reduce((sum, id) => {
        return sum + (req.allies[id]?.str ?? 0);
      }, 0);

      waitText.textContent = alliedIds.length > 0
        ? `${alliedIds.length} ally/allies answered — ally STR: ${combinedStr} vs ${monsterStr}`
        : 'Calling for allies...';

      // Resolve if we've won or all eligible allies have responded
      const allAnswered = eligible.every(([id]) =>
        req.allies?.[id] !== undefined
      );

      if (combinedStr >= monsterStr || allAnswered) {
        const participatingAllyIds = Object.keys(req.allies || {})
          .filter(id => typeof req.allies[id]?.str === 'number');
        settle({
          won:   combinedStr >= monsterStr,
          tied:  combinedStr === monsterStr,
          combinedStr,
          participatingAllyIds,
        });
      }
    });

    abandonBtn.addEventListener('click', () => {
      settle({ won: false, combinedStr: 0, abandoned: true });
    }, { once: true });

    timeout = setTimeout(() => {
      settle({ won: false, combinedStr: 0 });
    }, 30000);
  });

  waitEl.classList.add('hidden');

  await dbRemove(allyRequestPath);
  return result;
}

/** Signal each participating ally that a battle was won so they receive their own win bonuses. */
function mpNotifyAllyBattleWin(allyIds) {
  allyIds.forEach(id => {
    dbUpdate(playerPath(mpGameCode, id), { battleWinBonus: true }).catch(() => {});
  });
}

/** Signal each participating ally to take tie damage (ally STR matched monster STR). */
function mpNotifyAllyBattleTie(allyIds, damage) {
  if (!damage) return;
  allyIds.forEach(id => {
    dbUpdate(playerPath(mpGameCode, id), { battleTieDamage: damage }).catch(() => {});
  });
}

// ── Phase 7: Equipment Sharing ────────────────────────────────────────

/** Write this player's inventory vacancy flags to Firebase so allies can check for empty slots. */
function mpSyncInventorySlots() {
  if (!isMultiplayer || !mpGameCode || !mpPlayerId) return;
  const invSlots = {
    weapon:          inventory.weapon == null,
    items:           itemSlots.filter(Boolean).length,
    armorHead:       armorSlots.head == null,
    armorBody:       armorSlots.body == null,
    armorAccessory:  armorSlots.misc == null,
  };
  dbUpdate(playerPath(mpGameCode, mpPlayerId), { invSlots }).catch(() => {});
}

/**
 * Return allies who have an empty slot matching the given card type.
 * type: 'weapon' | 'item' | 'armor'
 * armorSlotKey: 'head' | 'body' | 'misc' (only for armor type)
 */
function mpGetEligibleShareAllies(type, armorSlotKey) {
  return Object.entries(mpAllPlayers)
    .filter(([id]) => id !== mpPlayerId)
    .filter(([, p]) => {
      const s = p.invSlots;
      if (!s) return false;
      if (type === 'weapon') return s.weapon === true;
      if (type === 'item')   return s.items < 3;
      if (type === 'armor') {
        if (armorSlotKey === 'head')      return s.armorHead      === true;
        if (armorSlotKey === 'body')      return s.armorBody      === true;
        if (armorSlotKey === 'misc')      return s.armorAccessory === true;
      }
      return false;
    })
    .map(([id, p]) => ({ id, name: p.name ?? 'Ally' }));
}

/** Check whether this player's own inventory can receive a shared card. */
function mpCanReceiveCard(type, armorSlotKey) {
  if (type === 'weapon') return inventory.weapon == null;
  if (type === 'item')   return firstEmptyItemSlot() >= 0;
  if (type === 'armor')  return armorSlots[armorSlotKey] == null;
  return false;
}

/**
 * Show the recipient picker modal and return the chosen playerId, or null if cancelled.
 * eligible: array of { id, name }
 */
function mpPromptShareRecipient(eligible, card) {
  return new Promise(resolve => {
    const dialog  = document.getElementById('mp-share-picker');
    const subEl   = document.getElementById('mp-share-picker-sub');
    const rowsEl  = document.getElementById('mp-share-picker-rows');
    const cancelBtn = document.getElementById('mp-share-picker-cancel');

    subEl.textContent = `Who should receive ${card.name} (${cardPreviewStat(card)})?`;
    rowsEl.innerHTML  = '';

    eligible.forEach(({ id, name }) => {
      const btn = document.createElement('button');
      btn.className   = 'mp-share-ally-btn';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        dialog.classList.add('hidden');
        cancelBtn.onclick = null;
        resolve(id);
      });
      rowsEl.appendChild(btn);
    });

    cancelBtn.onclick = () => {
      dialog.classList.add('hidden');
      cancelBtn.onclick = null;
      resolve(null);
    };

    dialog.classList.remove('hidden');
  });
}

/**
 * Write a share request to Firebase, show the waiting bar, and return
 * 'accepted' | 'declined' | 'cancelled' when the recipient responds.
 */
async function mpSendShareRequest(toPlayerId, toName, card, type) {
  const path = `games/${mpGameCode}/shareRequests/${toPlayerId}`;

  await dbSet(path, {
    fromPlayerId: mpPlayerId,
    fromName:     mpMyName,
    card,
    type,
    status:    'pending',
    expiresAt: Date.now() + 60000,
  });

  const waitEl   = document.getElementById('mp-share-waiting');
  const waitText = document.getElementById('mp-share-wait-text');
  const cancelBtn = document.getElementById('mp-share-wait-cancel');
  waitText.textContent = `Waiting for ${toName} to respond…`;
  waitEl.classList.remove('hidden');

  const outcome = await new Promise(resolve => {
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      cancelBtn.onclick = null;
      waitEl.classList.add('hidden');
      resolve(result);
    };

    const unsub = dbListen(path, req => {
      if (!req)                       return finish('declined');
      if (req.status === 'accepted')  return finish('accepted');
      if (req.status === 'declined')  return finish('declined');
    });

    const timer = setTimeout(() => finish('declined'), 60000);

    cancelBtn.onclick = () => finish('cancelled');
  });

  await dbRemove(path);
  return outcome;
}

/**
 * Apply a card received from an ally directly into this player's inventory.
 * Assumes the slot vacancy was already verified before the request was accepted.
 */
async function mpApplySharedCard(card, type) {
  if (type === 'weapon') {
    setInventorySlot('weapon', card);
  } else if (type === 'item') {
    const idx = firstEmptyItemSlot();
    if (idx >= 0) setItemSlot(idx, card);
  } else if (type === 'armor') {
    const slotKey = card.armor_slot;
    armorSlots[slotKey] = { card, pips: { ...card.absorb } };
    refreshArmorSlot(slotKey);
    mpSyncInventorySlots();
  }
  await mpWriteMyState();
}

// ── Broadcast game over to all clients ──────────────────────────────
function mpTriggerGameOver(reason) {
  if (!isMultiplayer) return;
  dbUpdate(metaPath(mpGameCode), {
    status:         'gameover',
    gameOverReason: reason,
    eliminatedName: mpMyName || 'A survivor',
  }).catch(() => {});
}

// ── Called when the active player finishes their pick ───────────────
async function mpAfterPick(slotIndex) {
  if (!isMultiplayer || !mpRound) return;

  // 1. Sync personal stats and mark this player done
  await Promise.all([
    mpWriteMyState(),
    dbUpdate(playerPath(mpGameCode, mpPlayerId), {
      hasPickedThisRound:  true,
      slotPickedThisRound: slotIndex,
    }),
  ]);

  // 2. Update claimed slots list and persist current board state
  const claimedSlots = [...(mpRound.claimedSlots || []), slotIndex];
  await Promise.all([
    dbUpdate(roundPath(mpGameCode), { claimedSlots }),
    mpWriteSharedState([...slotCards]),
  ]);

  // 3. Read all player states to decide what happens next
  const allPlayers = await dbGet(playersPath(mpGameCode));
  if (!allPlayers) return;

  // Treat our own write as committed (Firebase may not reflect it yet)
  if (allPlayers[mpPlayerId]) allPlayers[mpPlayerId].hasPickedThisRound = true;

  const playerIds = Object.keys(allPlayers);
  const allPicked = playerIds.every(id => allPlayers[id]?.hasPickedThisRound === true);

  if (allPicked) {
    await mpStartNewRound(playerIds, mpRound.turnOrder || playerIds);
  } else {
    // Advance to the next unpicked player in turn order
    const order  = mpRound.turnOrder || playerIds;
    const myIdx  = order.indexOf(mpPlayerId);
    let nextIdx  = (myIdx + 1) % order.length;
    const start  = nextIdx;
    while (allPlayers[order[nextIdx]]?.hasPickedThisRound === true) {
      nextIdx = (nextIdx + 1) % order.length;
      if (nextIdx === start) break; // safety fallback
    }
    await dbUpdate(roundPath(mpGameCode), { activePlayerId: order[nextIdx] });
  }
}

// ── End of round: clear board, deal new cards, rotate order ─────────
async function mpStartNewRound(playerIds, turnOrder) {
  // Discard remaining cards from slots that weren't picked
  clearLootZones();

  if (drawPile.length === 0) {
    cardSelected = false;
    // Signal all other clients to enter the draft phase
    await dbUpdate(roundPath(mpGameCode), { phase: 'draft' });
    await onDeckExhausted();
    return;
  }

  // Deal a new board
  const slotsRowEl = document.getElementById('slots-row');
  slotsRowEl.classList.add('redrawing');
  await new Promise(r => setTimeout(r, 250));
  const drawn = drawPile.splice(0, Math.min(drawPile.length, DRAW_SLOTS));
  placeCards(drawn);
  updateDeckCount();
  cardSelected = false;
  updateItemBars();
  slotsRowEl.classList.remove('redrawing');

  // Rotate turn order: move first element to end
  const newOrder = [...turnOrder.slice(1), turnOrder[0]];

  // Reset hasPickedThisRound for all players
  const resetUpdates = {};
  playerIds.forEach(id => {
    resetUpdates[`${id}/hasPickedThisRound`]  = false;
    resetUpdates[`${id}/slotPickedThisRound`] = null;
  });
  await dbUpdate(playersPath(mpGameCode), resetUpdates);

  // Persist the new shared state and advance the round
  await mpWriteSharedState([...slotCards]);
  await dbUpdate(roundPath(mpGameCode), {
    number:         (mpRound?.number || 1) + 1,
    turnOrder:      newOrder,
    activePlayerId: newOrder[0],
    claimedSlots:   [],
    phase:          'picking',
  });
}

// ── Firebase listeners ───────────────────────────────────────────────
function mpInitListeners() {
  if (!isMultiplayer || !mpGameCode || !mpPlayerId) return;

  // 1. Round: whose turn, phase, claimed slots
  _mpUnsubRound = dbListen(roundPath(mpGameCode), round => {
    if (!round) return;
    mpRound = round;

    // Draft phase signal: all clients run onDeckExhausted independently
    if (round.phase === 'draft' && !gameOver) {
      // Only trigger if not already in the draft (host/last-picker already running it)
      if (round.activePlayerId !== mpPlayerId) {
        onDeckExhausted();
      }
      return;
    }

    const isMyTurn = round.activePlayerId === mpPlayerId;

    if (isMyTurn) {
      mpHideWaiting();
      mpShowYourTurnNotice();
      setAllSlotsLocked(false);
      cardSelected = false;
      updateItemBars();
    } else {
      mpHideYourTurnNotice();
      const name = mpAllPlayers[round.activePlayerId]?.name ?? 'Another player';
      mpShowWaiting(name);
      setAllSlotsLocked(true);
    }
  });

  // 2. Shared board: deck + visible cards — only update when it's NOT my turn
  _mpUnsubShared = dbListen(sharedStatePath(mpGameCode), state => {
    if (!state) return;
    // If it's currently my turn I'm the source of truth — skip
    if (mpRound?.activePlayerId === mpPlayerId) return;

    drawPile        = Array.isArray(state.drawPile)        ? state.drawPile        : Object.values(state.drawPile        || {});
    discardPile     = Array.isArray(state.discardPile)     ? state.discardPile     : Object.values(state.discardPile     || {});
    injuredMonsters = Array.isArray(state.injuredMonsters) ? state.injuredMonsters : Object.values(state.injuredMonsters || {});
    _applyThreatPilesFromState(state);
    if (typeof state.deckPass === 'number' && state.deckPass !== deckPass) {
      deckPass = state.deckPass;
      updateBoardLocation();
      updateSlotCosts();
    }
    mpApplySlotCards(state.slotCards);
    updateDeckCount();
    updateItemBars();
    // Re-lock after mpApplySlotCards (it strips the locked class during re-render)
    const isMyTurn = mpRound?.activePlayerId === mpPlayerId;
    setAllSlotsLocked(!isMyTurn);
    cardSelected = !isMyTurn;
  });

  // 3. All players — for ally sidebar + waiting overlay name
  _mpUnsubPlayers = dbListen(playersPath(mpGameCode), players => {
    if (!players) return;
    mpAllPlayers = players;
    mpRenderAllySidebar(players);
    // If the win screen is already open, refresh the score block now that we
    // have the latest ally stats (handles the race between the round-path
    // listener firing triggerYouWin and this players-path listener arriving).
    if (gameOver && typeof buildScoreBlock === 'function') buildScoreBlock();
    if (mpRound && mpRound.activePlayerId !== mpPlayerId) {
      const name = players[mpRound.activePlayerId]?.name ?? 'Another player';
      document.getElementById('mp-turn-name').textContent = name;
    }
    // Apply any externally-written stat changes to this player (e.g. food shared by an ally)
    const myRemote = players[mpPlayerId];
    if (myRemote) {
      for (const key of ['food', 'health', 'sanity', 'mutation']) {
        const remoteVal = myRemote[key];
        if (typeof remoteVal === 'number' && remoteVal !== playerState[key]?.value) {
          if (playerState[key]?.set) playerState[key].set(remoteVal);
        }
      }
      if (myRemote.battleWinBonus) {
        applyBattleWinBonuses();
        dbUpdate(playerPath(mpGameCode, mpPlayerId), {
          battleWinBonus: null,
          food:     playerState.food.value,
          health:   playerState.health.value,
          sanity:   playerState.sanity.value,
          mutation: playerState.mutation.value,
        }).catch(() => {});
      }
      if (myRemote.battleTieDamage) {
        const dmg = myRemote.battleTieDamage;
        dbUpdate(playerPath(mpGameCode, mpPlayerId), { battleTieDamage: null }).catch(() => {});
        (async () => {
          await applyEffects(dmg);
          await mpWriteMyState();
          gameLog.add('⚔ Tie damage — you absorbed the blow for your ally', 'warn');
        })();
      }
    }
  });

  // 4. Ally request — show banner to eligible non-active players
  dbListen(`${roundPath(mpGameCode)}/allyRequest`, req => {
    const banner  = document.getElementById('mp-ally-request');
    const bodyEl  = document.getElementById('mp-ally-req-body');
    const yesBtn  = document.getElementById('mp-ally-ans-yes');
    const noBtn   = document.getElementById('mp-ally-ans-no');

    if (!req || req.resolved || req.requesterId === mpPlayerId) {
      banner.classList.add('hidden');
      return;
    }

    const name = mpAllPlayers[req.requesterId]?.name ?? 'Your ally';
    bodyEl.textContent =
      `${name} is battling ${req.monsterName} (STR ${req.monsterStr}). ` +
      `Their STR: ${req.requesterStr}. Will you help?`;
    // Reset to initial state in case cost panel was previously shown
    document.getElementById('mp-ally-req-btns').classList.remove('hidden');
    document.getElementById('mp-ally-cost-btns').classList.add('hidden');
    banner.classList.remove('hidden');

    const costFoodBtn   = document.getElementById('mp-ally-cost-food');
    const costHealthBtn = document.getElementById('mp-ally-cost-health');
    const costBackBtn   = document.getElementById('mp-ally-cost-back');

    const hideBanner = () => {
      banner.classList.add('hidden');
      document.getElementById('mp-ally-req-btns').classList.remove('hidden');
      document.getElementById('mp-ally-cost-btns').classList.add('hidden');
    };

    const commitHelp = async (costLabel) => {
      hideBanner();
      const myStr = getPlayerStrength();
      await mpWriteMyState();
      await dbUpdate(`${roundPath(mpGameCode)}/allyRequest/allies/${mpPlayerId}`, { str: myStr });
      gameLog.add(`⚔ You answered ${name}'s call (${costLabel}) — your STR ${myStr} added`, 'good');
    };

    // Step 1: "Answer the Call" → show cost choice
    yesBtn.onclick = () => {
      document.getElementById('mp-ally-req-btns').classList.add('hidden');
      document.getElementById('mp-ally-cost-btns').classList.remove('hidden');
    };

    noBtn.onclick = async () => {
      hideBanner();
      // Record the decline so allAnswered resolves without waiting for the full timeout
      await dbUpdate(`${roundPath(mpGameCode)}/allyRequest/allies/${mpPlayerId}`, { declined: true }).catch(() => {});
    };

    // Step 2: cost choices
    costFoodBtn.onclick = async () => {
      if (playerState.food.value < 2) {
        gameLog.add('Not enough food to answer the call.', 'warn');
        return;
      }
      if (playerState.food.set) playerState.food.set(Math.max(0, playerState.food.value - 2));
      await commitHelp('−2 food');
    };

    costHealthBtn.onclick = async () => {
      if (playerState.health.value < 1) {
        gameLog.add('Not enough health to answer the call.', 'warn');
        return;
      }
      if (playerState.health.set) playerState.health.set(Math.max(0, playerState.health.value - 1));
      await commitHelp('−1 health');
    };

    costBackBtn.onclick = () => hideBanner();
  });

  // 5. Share requests — incoming equipment offer from an ally
  dbListen(`games/${mpGameCode}/shareRequests/${mpPlayerId}`, async req => {
    const banner     = document.getElementById('mp-share-request');
    const bodyEl     = document.getElementById('mp-share-req-body');
    const acceptBtn  = document.getElementById('mp-share-req-accept');
    const declineBtn = document.getElementById('mp-share-req-decline');

    if (!req || req.status !== 'pending' || req.expiresAt < Date.now()) {
      banner.classList.add('hidden');
      return;
    }

    const { card, type, fromName = 'Your ally' } = req;
    const canAccept = mpCanReceiveCard(type, card.armor_slot);

    bodyEl.textContent =
      `${fromName} wants to share ${card.name} (${cardPreviewStat(card)}) with you.` +
      (canAccept ? '' : ' (Your slot is full — cannot accept.)');

    acceptBtn.disabled = !canAccept;
    banner.classList.remove('hidden');

    acceptBtn.onclick = async () => {
      banner.classList.add('hidden');
      acceptBtn.onclick  = null;
      declineBtn.onclick = null;
      if (!mpCanReceiveCard(type, card.armor_slot)) {
        // Slot filled up between offer and accept — auto-decline
        await dbUpdate(`games/${mpGameCode}/shareRequests/${mpPlayerId}`, { status: 'declined' });
        return;
      }
      await mpApplySharedCard(card, type);
      await dbUpdate(`games/${mpGameCode}/shareRequests/${mpPlayerId}`, { status: 'accepted' });
      gameLog.add(`📦 Received ${card.name} from ${fromName}`, 'good');
    };

    declineBtn.onclick = async () => {
      banner.classList.add('hidden');
      acceptBtn.onclick  = null;
      declineBtn.onclick = null;
      await dbUpdate(`games/${mpGameCode}/shareRequests/${mpPlayerId}`, { status: 'declined' });
    };
  });

  // 6. Remote game log — display other players' events in this client's log panel
  dbListenChildAdded(logPath(mpGameCode), (_key, entry) => {
    if (!entry || entry.n === mpMyName) return;
    if (!mpGameLog) return;
    mpGameLog.setReceiving(true);
    if (entry.c === '_turn') {
      gameLog.newTurn(`[${entry.n}] ${entry.t}`);
    } else {
      gameLog.add(`[${entry.n}] ${entry.t}`, entry.c || '');
    }
    mpGameLog.setReceiving(false);
  });

  // 7. Meta — game over broadcast
  _mpUnsubMeta = dbListen(metaPath(mpGameCode), meta => {
    if (!meta) return;
    if (meta.status === 'gameover' && !gameOver) {
      const reason = meta.gameOverReason ?? 'health';
      const name   = meta.eliminatedName ?? 'A survivor';
      if (mpGameLog) mpGameLog.setReceiving(true);
      gameLog.add(`💀 ${name} has fallen — the group cannot continue.`, 'warn');
      if (mpGameLog) mpGameLog.setReceiving(false);
      // triggerGameOver will check gameOver flag and show the screen
      if (!gameOver) triggerGameOver(reason);
    }
  });
}

// ── Multiplayer init: read Firebase state, override local, start listeners ──
async function mpInit() {
  if (!isMultiplayer || !mpGameCode || !mpPlayerId) return;

  const [myData, shared, round] = await Promise.all([
    dbGet(playerPath(mpGameCode, mpPlayerId)),
    dbGet(sharedStatePath(mpGameCode)),
    dbGet(roundPath(mpGameCode)),
  ]);

  mpIsHost = myData?.isHost === true;
  mpMyName = myData?.name ?? charDef.label;

  // Detect reconnect: round already has an active player → game is in progress.
  // mpFreshStart suppresses this when arriving directly from the lobby.
  const isReconnect = !mpFreshStart && round?.activePlayerId != null;

  if (mpIsHost && !isReconnect) {
    // Fresh game: host is source of truth — write locally-dealt board to Firebase
    await mpWriteSharedState([...slotCards]);
  } else if (shared) {
    // Non-host on fresh game, OR any player reconnecting: read Firebase as source of truth
    drawPile        = Array.isArray(shared.drawPile)        ? shared.drawPile        : Object.values(shared.drawPile        || {});
    discardPile     = Array.isArray(shared.discardPile)     ? shared.discardPile     : Object.values(shared.discardPile     || {});
    injuredMonsters = Array.isArray(shared.injuredMonsters) ? shared.injuredMonsters : Object.values(shared.injuredMonsters || {});
    _applyThreatPilesFromState(shared);
    if (typeof shared.deckPass === 'number' && shared.deckPass !== deckPass) {
      deckPass = shared.deckPass;
      updateBoardLocation();
      updateSlotCosts();
    }
    mpApplySlotCards(shared.slotCards);
    updateDeckCount();
  } else if (!isReconnect) {
    // Non-host fresh start: host hasn't written sharedState yet (race). Wait for it.
    // The permanent sharedState listener (set up in mpInitListeners) skips updates
    // when it's the active player's turn, so we must apply the initial board here
    // before that listener is registered.
    await new Promise(resolve => {
      const unsub = dbListen(sharedStatePath(mpGameCode), state => {
        if (!state) return;
        drawPile        = Array.isArray(state.drawPile)        ? state.drawPile        : Object.values(state.drawPile        || {});
        discardPile     = Array.isArray(state.discardPile)     ? state.discardPile     : Object.values(state.discardPile     || {});
        injuredMonsters = Array.isArray(state.injuredMonsters) ? state.injuredMonsters : Object.values(state.injuredMonsters || {});
        _applyThreatPilesFromState(state);
        if (typeof state.deckPass === 'number' && state.deckPass !== deckPass) {
          deckPass = state.deckPass;
          updateBoardLocation();
          updateSlotCosts();
        }
        mpApplySlotCards(state.slotCards);
        updateDeckCount();
        unsub();
        resolve();
      });
    });
  }

  // On reconnect: restore this player's stats and inventory from Firebase
  if (isReconnect && myData) {
    if (myData.food     != null && playerState.food.set)     playerState.food.set(myData.food);
    if (myData.health   != null && playerState.health.set)   playerState.health.set(myData.health);
    if (myData.sanity   != null && playerState.sanity.set)   playerState.sanity.set(myData.sanity);
    if (myData.mutation != null && playerState.mutation.set) playerState.mutation.set(myData.mutation);
    if (myData.inv && typeof restoreInventory === 'function') restoreInventory(myData.inv);
    if (myData.mutantCards?.length > 0) {
      mutantCards.push(...myData.mutantCards);
      if (typeof renderMutantPanel === 'function') renderMutantPanel();
      if (typeof updateSlotCosts === 'function') updateSlotCosts();
    }
    gameLog.add(`🔄 Reconnected to game ${mpGameCode}`, 'gold');
  }

  // Apply turn lock immediately — before listeners fire — to close the first-turn race window
  if (round) {
    mpRound = round;
    const isMyTurn = round.activePlayerId === mpPlayerId;
    if (isMyTurn) {
      // Undo the pre-lock applied before mpInit() ran
      setAllSlotsLocked(false);
      cardSelected = false;
      mpShowYourTurnNotice();
    } else {
      setAllSlotsLocked(true);
      cardSelected = true;
      const allPlayers = await dbGet(playersPath(mpGameCode));
      mpAllPlayers = allPlayers ?? {};
      const name = allPlayers?.[round.activePlayerId]?.name ?? 'Another player';
      mpShowWaiting(name);
    }
  }

  // ── Game log sync: wrap gameLog so all events broadcast to Firebase ──
  // Other players receive entries via the log listener in mpInitListeners().
  let _mpLogReceiving = false;
  const _origLogAdd      = gameLog.add;
  const _origLogNewTurn  = gameLog.newTurn;
  gameLog.add = (text, cls = '') => {
    _origLogAdd(_mpLogReceiving ? text : `[${mpMyName}] ${text}`, cls);
    if (!_mpLogReceiving && !gameOver) {
      dbPush(logPath(mpGameCode), { n: mpMyName, t: text, c: cls ?? '', ts: Date.now() });
    }
  };
  gameLog.newTurn = (label) => {
    _origLogNewTurn(_mpLogReceiving ? label : `[${mpMyName}] ${label}`);
    if (!_mpLogReceiving && !gameOver) {
      dbPush(logPath(mpGameCode), { n: mpMyName, t: label, c: '_turn', ts: Date.now() });
    }
  };
  // Store the receiving flag and restore fns on the module scope so listener can access them
  mpGameLog = { setReceiving: v => { _mpLogReceiving = v; } };

  // Write correct stats (including character bonuses) to Firebase before the players
  // listener fires. Lobby buildPlayerData stores base stats only, so without this,
  // dbListen fires immediately with base values and overwrites the local bonus.
  if (!isReconnect) await mpWriteMyState();

  mpSyncInventorySlots(); // publish initial vacancy state so allies can see our empty slots
  mpInitListeners();
  console.log(`[MP] Initialized. Host: ${mpIsHost}, Code: ${mpGameCode}, Reconnect: ${isReconnect}`);
}
