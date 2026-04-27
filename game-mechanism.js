/**
 * game-mechanism.js — Item mechanism engine + loot zone board management
 *
 * Loaded before the main game.html inline script.
 * All functions reference globals lazily — safe to load in <head>.
 *
 * Depends on: game-inventory.js (itemSlots, itemUsesArr, maxFood, setItemSlot,
 *               renderItemSlots, renderFoodTrack, inventory, refreshWeaponZone,
 *               updateWalkieBar, updateAdrenalineBar)
 *             game-logic.js (renderCard)
 * Requires globals from game.html: playerState, weaponUsesRemaining,
 *   DRAW_SLOTS, slotCards, lootZones, discardPile, showMagnifier, hideMagnifier
 */

/* ═══════════════════════════════════════════
   MECHANISM ENGINE
   All item card special behaviour is driven by
   the `mechanism` field in loot-deck.json.
   No hardcoded card-name checks outside this block.
═══════════════════════════════════════════ */

// ── passive_event / battle_win_or_tie ─────────────────────────────
// Returns array of toast/log lines
function triggerBattleWinOrTie() {
  const lines = [];
  for (const card of itemSlots) {
    if (!card?.mechanism) continue;
    const m = card.mechanism;
    if (m.type !== 'passive_event' || m.trigger !== 'battle_win_or_tie') continue;
    for (const [stat, amt] of Object.entries(m.effect)) {
      const cap = stat === 'food' ? maxFood : 10;
      const next = Math.min(cap, playerState[stat].value + amt);
      if (playerState[stat].set) playerState[stat].set(next);
      lines.push(`${card.name} — ${stat} +${amt} (${next})`);
    }
  }
  return lines;
}

// ── passive_event / gather_gain ───────────────────────────────────
// Called after a gather stat is applied; returns extra lines.
// Only handles items with stat_filter (fires per-stat).
// Items with trigger loot_gain (no stat_filter) are handled by triggerLootGain.
function triggerGatherGain(stat, amountGained, slotIndex) {
  if (amountGained <= 0) return [];
  const lines = [];
  for (const [idx, card] of itemSlots.entries()) {
    if (!card?.mechanism) continue;
    const m = card.mechanism;
    if (m.type !== 'passive_event' || m.trigger !== 'gather_gain') continue;
    if (!m.stat_filter) continue;
    if (m.stat_filter !== stat) continue;
    if (m.slots && !m.slots.includes(slotIndex)) continue;
    // Check uses if the card has them
    if (card.uses != null) {
      if (itemUsesArr[idx] <= 0) continue;
      itemUsesArr[idx]--;
      if (itemUsesArr[idx] === 0) {
        setItemSlot(idx, null);
      } else {
        renderItemSlots();
      }
    }
    for (const [eStat, eAmt] of Object.entries(m.effect)) {
      const cap = eStat === 'food' ? maxFood : 10;
      const next = Math.min(cap, playerState[eStat].value + eAmt);
      if (playerState[eStat].set) playerState[eStat].set(next);
      lines.push(`${card.name} — ${eStat} +${eAmt} (${next})`);
    }
  }
  return lines;
}

// ── passive_event / loot_gain ────────────────────────────────────
// Fires once per card pick from the matching slot(s), regardless of card type.
function triggerLootGain(slotIndex) {
  const lines = [];
  for (const [idx, card] of itemSlots.entries()) {
    if (!card?.mechanism) continue;
    const m = card.mechanism;
    if (m.type !== 'passive_event' || m.trigger !== 'loot_gain') continue;
    if (m.slots && !m.slots.includes(slotIndex)) continue;
    if (card.uses != null) {
      if (itemUsesArr[idx] <= 0) continue;
      itemUsesArr[idx]--;
      if (itemUsesArr[idx] === 0) {
        setItemSlot(idx, null);
      } else {
        renderItemSlots();
      }
    }
    for (const [eStat, eAmt] of Object.entries(m.effect)) {
      const cap = eStat === 'food' ? maxFood : 10;
      const next = Math.min(cap, playerState[eStat].value + eAmt);
      if (playerState[eStat].set) playerState[eStat].set(next);
      lines.push(`${card.name} — ${eStat} +${eAmt} (${next})`);
    }
  }
  return lines;
}

// ── capacity: called on equip/unequip ────────────────────────────
function applyCapacityMechanism(card, equipping) {
  if (!card?.mechanism || card.mechanism.type !== 'capacity') return;
  const m = card.mechanism;
  if (m.stat === 'food') {
    if (equipping) {
      maxFood = m.max;
    } else {
      maxFood = 8;
      if (playerState.food.value > 8 && playerState.food.set) playerState.food.set(8);
    }
    renderFoodTrack();
  }
}

// ── instant: called at card acquisition ──────────────────────────
// Returns effect lines
function resolveInstantMechanism(card) {
  const m = card.mechanism;
  const lines = [];
  // Instant cards are consumed — removed from play, not returned to discard
  if (m.effect === 'reload_weapon') {
    const weapon = inventory.weapon;
    if (weapon && weapon.weapon_class === m.weapon_class) {
      weaponUsesRemaining = weapon.uses;
      refreshWeaponZone();
      lines.push(`🔫 ${weapon.name} reloaded (${weapon.uses} uses restored)`);
    } else {
      lines.push(`🔫 No ${m.weapon_class} weapon to reload`);
    }
  }
  return lines;
}

// ── active: update item bar buttons ──────────────────────────────
function updateActiveItemBars() {
  // Walkie-talkie (pre_pick), Adrenaline (pre_battle)
  updateWalkieBar();
  updateAdrenalineBar();
}

/* ═══════════════════════════════════════════
   LOOT ZONE BOARD MANAGEMENT
═══════════════════════════════════════════ */

function placeCards(cards) {
  const sorted = [...cards].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const total  = DRAW_SLOTS;                // 5
  const count  = sorted.length;             // 1–5
  const offset = total - count;             // how many left slots are empty/disabled

  slotCards = Array(total).fill(null);

  lootZones.slice(0, total).forEach((zone, i) => {
    zone.innerHTML = '';
    zone.classList.remove('has-card', 'locked', 'slot-disabled');

    if (i < offset) {
      // Disabled empty slot on the left
      zone.classList.add('slot-disabled');
      const icon = document.createElement('span');
      icon.className = 'loot-icon';
      icon.textContent = '📦';
      zone.appendChild(icon);
    } else {
      // Active card slot
      const card = sorted[i - offset];
      slotCards[i] = card;
      zone.classList.add('has-card');
      zone.appendChild(renderCard(card));

      zone.addEventListener('mouseenter', () => showMagnifier(card, zone, i));
      zone.addEventListener('mouseleave', hideMagnifier);
    }
  });
}

// Like placeCards but leaves the retained slot untouched and fills the rest
function placeCardsWithRetained(newCards, retained) {
  // Sort new cards by value
  const sorted = [...newCards].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

  // Build a full 5-slot layout: place retained card at its original index,
  // fill remaining slots with sorted new cards (left-to-right among empty slots)
  const layout = Array(DRAW_SLOTS).fill(null);
  layout[retained.slotIndex] = retained.card;

  let ni = 0;
  for (let i = 0; i < DRAW_SLOTS; i++) {
    if (layout[i] === null && ni < sorted.length) {
      layout[i] = sorted[ni++];
    }
  }

  slotCards = [...layout];

  lootZones.slice(0, DRAW_SLOTS).forEach((zone, i) => {
    const card = layout[i];
    const isRetained = i === retained.slotIndex;

    if (isRetained) {
      // Already rendered — just ensure state is consistent
      zone.classList.remove('locked', 'slot-disabled');
      zone.classList.add('has-card');
      return;
    }

    zone.innerHTML = '';
    zone.classList.remove('has-card', 'locked', 'slot-disabled');

    if (!card) {
      // Empty slot (draw pile had fewer than needed)
      zone.classList.add('slot-disabled');
      const icon = document.createElement('span');
      icon.className = 'loot-icon';
      icon.textContent = '📦';
      zone.appendChild(icon);
    } else {
      zone.classList.add('has-card');
      zone.appendChild(renderCard(card));
      zone.addEventListener('mouseenter', () => showMagnifier(card, zone, i));
      zone.addEventListener('mouseleave', hideMagnifier);
    }
  });
}

function clearLootZones() {
  // Any cards still on the board (not selected) go to the discard pile.
  slotCards.forEach(c => { if (c) discardPile.push(c); });
  lootZones.slice(0, DRAW_SLOTS).forEach((zone, i) => {
    zone.innerHTML = '';
    zone.classList.remove('has-card', 'locked', 'slot-disabled');
    slotCards[i] = null;
    const icon = document.createElement('span');
    icon.className = 'loot-icon';
    icon.textContent = '📦';
    zone.appendChild(icon);
    const lbl = document.createElement('div');
    lbl.className = 'loot-label';
    lbl.textContent = 'loot';
    zone.appendChild(lbl);
  });
}

function setAllSlotsLocked(locked) {
  lootZones.slice(0, DRAW_SLOTS).forEach(zone => {
    if (zone.classList.contains('has-card')) {
      zone.classList.toggle('locked', locked);
    }
  });
}
