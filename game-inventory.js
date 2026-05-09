/**
 * game-inventory.js — Inventory state, rendering, and slot management
 *
 * Loaded before the main game.html inline script.
 * State variables declared with `var` for cross-file access.
 *
 * Depends on: game-logic.js (renderCard)
 *             game-multiplayer.js (mpSyncInventorySlots, mpGetEligibleShareAllies, isMultiplayer)
 * Requires globals from game.html: playerState, weaponUsesRemaining, showMagnifier, hideMagnifier,
 *   updateActiveItemBars, updateSlotCosts, applyCapacityMechanism, applyStarvation,
 *   gameOver, cardSelected, suppressThreatNextPick, tempStrBonus, showToast
 */

/* ═══════════════════════════════════════════
   INVENTORY STATE
═══════════════════════════════════════════ */
var inventory = { weapon: null };
// Item slots: always 3
var itemSlots      = [null, null, null]; // array of card|null
var itemUsesArr    = [0, 0, 0];          // parallel array of remaining uses
const itemSlotsCount = 3;

// Passive items: capacity/perpetual items that don't occupy a slot
var passiveItems = [];

// Survivors rescued — VP cards that stay in inventory
var survivorCards = [];

// ── Armor slots (armor variant only) ─────────────────────────────
// Each slot: null | { card, pips: { health: N, sanity: N, mutation: N } }
var armorSlots = { head: null, body: null, misc: null };
const ARMOR_SLOT_IDS = { head: 'inv-armor-head', body: 'inv-armor-body', misc: 'inv-armor-acc' };
const ARMOR_SLOT_LABELS = { head: '🪖 Head', body: '🧥 Body', misc: '📿 Misc' };

// Max food (8 normally, 10 with Backpack)
var maxFood = 8;

// Convenience: first item matching a predicate
const findItem = (pred) => itemSlots.find(c => c && pred(c)) ?? null;
// Convenience: index of first item matching predicate
const findItemIdx = (pred) => itemSlots.findIndex(c => c && pred(c));

// Legacy single-item accessor for code that checks inventory.item
Object.defineProperty(inventory, 'item', {
  get() { return itemSlots.find(Boolean) ?? null; },
  enumerable: false,
});

// Legacy itemUsesRemaining — points to the uses of the first filled item slot
// (used by stash code — always references its own slot explicitly)
let _legacyItemUsesRemaining = 0;
Object.defineProperty(window, 'itemUsesRemaining', {
  get()    { const i = itemSlots.findIndex(Boolean); return i >= 0 ? itemUsesArr[i] : 0; },
  set(v)   { const i = itemSlots.findIndex(Boolean); if (i >= 0) itemUsesArr[i] = v; },
  configurable: true,
});

const INV_ICONS = { weapon: '🔧', item: '🎒' };

/* ═══════════════════════════════════════════
   INVENTORY FUNCTIONS
═══════════════════════════════════════════ */

function cardPreviewStat(card, usesOverride) {
  const uses = usesOverride !== undefined ? usesOverride : card.uses;
  if (card.strength != null) {
    const classTag = card.weapon_class ? ` · ${card.weapon_class}` : '';
    return `STR ${card.strength}${classTag}${uses != null ? ' · ' + uses + ' uses' : ''}`;
  }
  if (card.move != null) return `MOVE ${card.move}${uses != null ? ' · ' + uses + ' uses' : ''}`;
  if (card.absorb != null) {
    const parts = Object.entries(card.absorb).map(([k,v]) => `${v} ${k}`);
    return `Absorbs: ${parts.join(', ')} · ${card.armor_slot}`;
  }
  if (card.text)          return card.text.slice(0, 40) + (card.text.length > 40 ? '…' : '');
  return '';
}

function renderInventoryCard(card, usesRemaining) {
  const wrap = renderCard(card);
  wrap.style.cursor = 'pointer';

  // Uses pip row — for weapons, and items with uses
  if ((card.type === 'weapon' || card.type === 'item') && card.uses != null) {
    const row = document.createElement('div');
    row.className = 'weapon-uses-row';
    for (let i = 0; i < card.uses; i++) {
      const pip = document.createElement('div');
      pip.className = 'use-pip' + (i >= usesRemaining ? ' used' : '');
      row.appendChild(pip);
    }
    wrap.appendChild(row);
  }

  return wrap;
}

/* ── Render all item slots into #item-slots-container ── */
function renderItemSlots() {
  const container = document.getElementById('item-slots-container');
  container.innerHTML = '';
  for (let i = 0; i < itemSlotsCount; i++) {
    const zone = document.createElement('div');
    zone.className = 'inventory-card-zone inv-item';
    zone.id = `inv-item-${i}`;
    const card = itemSlots[i];
    if (card) {
      zone.classList.add('inv-filled');
      const uses = itemUsesArr[i];
      if (card.uses != null) {
        zone.classList.toggle('item-has-uses', uses > 0);
        zone.classList.toggle('item-depleted', uses <= 0);
      }
      zone.appendChild(renderInventoryCard(card, card.uses != null ? uses : undefined));
      attachItemActionButton(zone, card, i);
      zone.onmouseenter = () => showMagnifier(card, zone);
      zone.onmouseleave = hideMagnifier;
    } else {
      const icon = document.createElement('span');
      icon.className = 'inventory-empty-icon';
      icon.textContent = '🎒';
      zone.appendChild(icon);
    }
    container.appendChild(zone);
  }
  updateItemBars();
  // Refresh slot costs to reflect any item discounts (Area Map, Binoculars, etc.)
  updateSlotCosts();
}

/* ── Render rescued survivors into #survivor-cards-container ── */
function renderSurvivorPanel() {
  const container = document.getElementById('survivor-cards-container');
  if (!container) return;
  container.innerHTML = '';
  if (survivorCards.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  survivorCards.forEach(card => {
    const badge = document.createElement('div');
    badge.className = 'survivor-badge';
    badge.title = card.text ?? card.name;
    const icon = document.createElement('span');
    icon.className = 'survivor-badge-icon';
    icon.textContent = card.icon ?? '👤';
    const label = document.createElement('span');
    label.className = 'survivor-badge-label';
    label.textContent = card.name;
    const pts = document.createElement('span');
    pts.className = 'survivor-badge-pts';
    pts.textContent = `+${card.points ?? 0} pts`;
    badge.appendChild(icon);
    badge.appendChild(label);
    badge.appendChild(pts);
    container.appendChild(badge);
  });
}

/* ── Render passive (no-slot) items into #passive-items-container ── */
function renderPassiveItems() {
  const container = document.getElementById('passive-items-container');
  if (!container) return;
  container.innerHTML = '';
  if (passiveItems.length === 0) return;
  passiveItems.forEach(card => {
    const badge = document.createElement('div');
    badge.className = 'passive-item-badge';
    badge.title = card.text ?? card.name;
    const icon = document.createElement('span');
    icon.className = 'passive-item-icon';
    if (card.icon && card.icon.endsWith('.svg')) {
      const img = document.createElement('img');
      img.src = card.icon;
      img.alt = card.name;
      icon.appendChild(img);
    } else {
      icon.textContent = card.icon ?? '🎒';
    }
    const label = document.createElement('span');
    label.className = 'passive-item-label';
    label.textContent = card.name;
    badge.appendChild(icon);
    badge.appendChild(label);
    badge.onmouseenter = () => showMagnifier(card, badge);
    badge.onmouseleave = hideMagnifier;
    container.appendChild(badge);
  });
}

/* ── Equip a passive item (applies effect, no slot consumed) ── */
function equipPassiveItem(card) {
  const dupIdx = passiveItems.findIndex(c => c?.mechanism?.type === 'capacity' && c.mechanism.stat === card.mechanism.stat);
  if (dupIdx >= 0) return false; // already have one
  passiveItems.push(card);
  applyCapacityMechanism(card, true);
  renderPassiveItems();
  return true;
}

/* ── Get/set a specific item slot ── */
function getItemSlot(idx) { return itemSlots[idx] ?? null; }

function setItemSlot(idx, card) {
  const prev = itemSlots[idx];
  itemSlots[idx] = card;
  itemUsesArr[idx] = card ? (card.uses ?? 0) : 0;
  // If a capacity item was removed and none of that stat remain, revert cap
  if (prev?.mechanism?.type === 'capacity') {
    const stillHas = itemSlots.some(c => c?.mechanism?.type === 'capacity' && c.mechanism.stat === prev.mechanism.stat);
    if (!stillHas) applyCapacityMechanism(prev, false);
  }
  renderItemSlots();
  mpSyncInventorySlots();
}

/* ── Find the first empty item slot index, or -1 ── */
function firstEmptyItemSlot() { return itemSlots.findIndex(c => c === null); }

/* ── Refresh locked state of food track spaces 9 & 10 ── */
function renderFoodTrack() {
  document.querySelectorAll('[data-food-val="9"], [data-food-val="10"]').forEach(el => {
    el.classList.toggle('food-locked', maxFood < 10);
    el.classList.toggle('food-unlocked', maxFood >= 10);
  });
}

function refreshWeaponZone() {
  const card = inventory.weapon;
  const zone = document.getElementById('inv-weapon');
  if (!card) return;
  zone.innerHTML = '';
  zone.classList.add('inv-filled');
  zone.classList.toggle('item-has-uses', weaponUsesRemaining > 0);
  zone.classList.toggle('item-depleted', weaponUsesRemaining <= 0);
  zone.appendChild(renderInventoryCard(card, weaponUsesRemaining));
  zone.onmouseenter = () => showMagnifier(card, zone);
  zone.onmouseleave = hideMagnifier;
}

/* ── Armor: render pips for one armor slot ── */
function renderArmorPips(pips, originalAbsorb) {
  const row = document.createElement('div');
  row.className = 'armor-absorb-pips';
  for (const [stat, total] of Object.entries(originalAbsorb)) {
    const remaining = pips[stat] ?? 0;
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('span');
      pip.className = `armor-pip pip-${stat}${i >= remaining ? ' pip-spent' : ''}`;
      pip.title = `${stat} absorption${i >= remaining ? ' (spent)' : ''}`;
      row.appendChild(pip);
    }
  }
  return row;
}

/* ── Armor: re-render one armor slot zone ── */
function refreshArmorSlot(slotKey) {
  const slot = armorSlots[slotKey];
  const zone = document.getElementById(ARMOR_SLOT_IDS[slotKey]);
  if (!zone) return;
  zone.innerHTML = '';
  zone.classList.remove('inv-filled', 'item-has-uses', 'item-depleted');
  if (!slot) {
    const icon = document.createElement('span');
    icon.className = 'inventory-empty-icon';
    icon.textContent = slotKey === 'head' ? '🪖' : slotKey === 'body' ? '🧥' : '📿';
    zone.appendChild(icon);
    return;
  }
  zone.classList.add('inv-filled');
  const totalPips = Object.values(slot.pips).reduce((a,b) => a+b, 0);
  const maxPips   = Object.values(slot.card.absorb).reduce((a,b) => a+b, 0);
  zone.classList.toggle('item-has-uses', totalPips > 0);
  zone.classList.toggle('item-depleted', totalPips <= 0);
  const cardEl = renderInventoryCard(slot.card, null);
  // Append pip display inside the card element
  cardEl.appendChild(renderArmorPips(slot.pips, slot.card.absorb));
  zone.appendChild(cardEl);
  zone.onmouseenter = () => showMagnifier(slot.card, zone);
  zone.onmouseleave = hideMagnifier;
}

/* ── Armor: equip a new armor card (with replace prompt if slot occupied) ── */
async function equipArmor(card) {
  const slotKey = card.armor_slot; // head | body | misc
  const existing = armorSlots[slotKey];

  if (existing) {
    const result = await promptReplace('armor', existing.card, card, slotKey);
    if (result === 'share') return { taken: false, share: true, shareCard: card };
    if (!result) return { taken: false };
    // Trash the old armor permanently (no discard pile cycle)
  }
  armorSlots[slotKey] = { card, pips: { ...card.absorb } };
  refreshArmorSlot(slotKey);
  mpSyncInventorySlots();
  return { taken: true };
}

/* ── Armor: absorb damage through armor slots, return { absorbed, lines } ── */
function armorAbsorb(damageObj) {
  const absorbed = {};
  const lines = [];
  for (const [stat, rawAmt] of Object.entries(damageObj)) {
    const amt = rawAmt; // negative = damage (health/sanity), positive = mutation gain
    const isDamage = (stat === 'health' || stat === 'sanity') ? amt < 0 : amt > 0;
    if (!isDamage) continue;
    const dmgAmt = Math.abs(amt);
    let remaining = dmgAmt;
    // Try each slot in priority order: head, body, misc
    for (const slotKey of ['head', 'body', 'misc']) {
      const slot = armorSlots[slotKey];
      if (!slot || (slot.pips[stat] ?? 0) <= 0) continue;
      const canAbsorb = Math.min(remaining, slot.pips[stat]);
      slot.pips[stat] -= canAbsorb;
      remaining -= canAbsorb;
      absorbed[stat] = (absorbed[stat] ?? 0) + canAbsorb;
      lines.push(`🛡️ ${slot.card.name} absorbed ${canAbsorb} ${stat} damage (${slot.pips[stat]} left)`);
      // Trash armor if all pips depleted
      const totalLeft = Object.values(slot.pips).reduce((a,b)=>a+b,0);
      if (totalLeft <= 0) {
        lines.push(`🗑️ ${slot.card.name} destroyed`);
        armorSlots[slotKey] = null;
      }
      refreshArmorSlot(slotKey);
      if (remaining <= 0) break;
    }
  }
  return { absorbed, lines };
}

// setInventorySlot handles weapon; items use setItemSlot
function setInventorySlot(type, card) {
  if (type === 'item') { throw new Error('Use setItemSlot for items'); }
  inventory[type] = card;
  const zone = document.getElementById(`inv-${type}`);
  zone.innerHTML = '';
  zone.classList.remove('item-has-uses', 'item-depleted');
  if (card) {
    zone.classList.add('inv-filled');
    if (type === 'weapon') {
      weaponUsesRemaining = card.uses ?? 0;
      zone.classList.toggle('item-has-uses', weaponUsesRemaining > 0);
      zone.classList.toggle('item-depleted', weaponUsesRemaining <= 0);
      zone.appendChild(renderInventoryCard(card, weaponUsesRemaining));
      zone.onmouseenter = () => showMagnifier(card, zone);
      zone.onmouseleave = hideMagnifier;
    }
  } else {
    zone.classList.remove('inv-filled');
    const icon = document.createElement('span');
    icon.className = 'inventory-empty-icon';
    icon.textContent = INV_ICONS[type];
    zone.appendChild(icon);
  }
  mpSyncInventorySlots();
}

function updateItemBars() {
  updateActiveItemBars();
}

/* ── Walkie-talkie: arm/disarm threat suppression for next pick ── */
function updateWalkieBar() {
  const idx = itemSlots.findIndex(c => c?.mechanism?.timing === 'pre_pick');
  const bar = document.getElementById('walkie-bar');
  if (idx < 0) { bar.style.display = 'none'; suppressThreatNextPick = false; return; }
  const card = itemSlots[idx];
  const uses = itemUsesArr[idx];
  bar.style.display = (uses > 0 && !cardSelected) ? 'flex' : 'none';
  document.getElementById('walkie-uses-label').textContent =
    uses > 0 ? `${uses} use${uses !== 1 ? 's' : ''} remaining` : '';
  const btn = document.getElementById('walkie-use-btn');
  btn.style.background = suppressThreatNextPick ? 'rgba(100,180,120,0.25)' : 'rgba(100,180,120,0.08)';
  btn.textContent = suppressThreatNextPick
    ? `📻 ${card.name} — ARMED (threats suppressed)`
    : `📻 ${card.name} — skip all threats this pick`;
}

/* ── Adrenaline shot (pre_battle active): temp STR bonus for one battle ── */
function updateAdrenalineBar() {
  const idx = itemSlots.findIndex(c => c?.mechanism?.timing === 'pre_battle');
  const bar = document.getElementById('adrenaline-bar');
  if (idx < 0) { bar.style.display = 'none'; return; }
  const card = itemSlots[idx];
  const bonus = card.mechanism.bonus;
  const uses = itemUsesArr[idx];
  bar.style.display = (uses > 0 && !cardSelected) ? 'flex' : 'none';
  document.getElementById('adrenaline-uses-label').textContent =
    uses > 0 ? `${uses} use${uses !== 1 ? 's' : ''} remaining` : '';
  const btn = document.getElementById('adrenaline-use-btn');
  btn.style.background = tempStrBonus > 0 ? 'rgba(200,80,80,0.25)' : 'rgba(200,80,80,0.08)';
  btn.textContent = tempStrBonus > 0
    ? `💉 ${card.name} — ACTIVE (+${bonus} STR this battle)`
    : `💉 ${card.name} — +${bonus} STR next battle`;
}

/* ── Attach per-turn action button to item slot ─────────────────── */
function attachItemActionButton(zone, card, slotIdx) {
  if (!card) return;

  // Helper: create a standard once-per-turn food-cost action button
  const makeActionBtn = (label, usedFlagGetter, usedFlagSetter, onUse) => {
    const btn = document.createElement('button');
    btn.className = 'item-action-btn';
    btn.textContent = label;
    const refresh = () => {
      const noUses = itemUsesArr[slotIdx] <= 0;
      const noFood = playerState.food.value < 1;
      const used   = usedFlagGetter();
      btn.disabled = noUses || noFood || used;
      btn.title = used ? 'Already used this turn'
                : noFood ? 'Not enough food'
                : noUses ? 'No uses remaining' : '';
    };
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      // Pay 1 food
      const prevFood = playerState.food.value;
      const newFood = Math.max(0, prevFood - 1);
      if (playerState.food.set) playerState.food.set(newFood);
      if (newFood === 0 || prevFood === 0) { applyStarvation(); }
      if (gameOver) return;
      usedFlagSetter(true);
      onUse(btn, slotIdx, refresh);
    });
    zone.appendChild(btn);
    return { btn, refresh };
  };
}

/* ── Replace dialog ── */
let replaceResolve = null; // resolve fn for the pending promise

function promptReplace(type, currentCard, newCard, armorSlotKey) {
  return new Promise(resolve => {
    replaceResolve = resolve;

    document.getElementById('replace-body').textContent =
      `Your ${type} slot is occupied. Replace it with "${newCard.name}"?`;
    document.getElementById('replace-current-name').textContent = currentCard.name;
    const currentUses = type === 'weapon' ? weaponUsesRemaining : undefined;
    document.getElementById('replace-current-stat').textContent = cardPreviewStat(currentCard, currentUses);
    document.getElementById('replace-new-name').textContent = newCard.name;
    document.getElementById('replace-new-stat').textContent = cardPreviewStat(newCard);

    // Show share button only in multiplayer when an ally has an open slot
    const shareBtn = document.getElementById('btn-share');
    if (isMultiplayer) {
      const eligible = mpGetEligibleShareAllies(type, armorSlotKey);
      shareBtn.classList.toggle('hidden', eligible.length === 0);
    } else {
      shareBtn.classList.add('hidden');
    }

    document.getElementById('replace-dialog').classList.add('open');
  });
}

/* ── Discard picker: shown when all item slots are full ── */
let discardResolve = null;

function promptItemDiscard(incomingCard) {
  return new Promise(resolve => {
    discardResolve = resolve;

    document.getElementById('discard-body').textContent =
      `Your backpack is full. Discard an item to make room for "${incomingCard.name}".`;

    const container = document.getElementById('discard-options');
    container.innerHTML = '';

    itemSlots.forEach((slotCard, idx) => {
      if (!slotCard) return;
      const btn = document.createElement('button');
      btn.className = 'discard-option-btn';
      const isBackpack = slotCard.name === 'Backpack';
      btn.disabled = isBackpack;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = slotCard.name + (isBackpack ? ' (cannot discard)' : '');

      const statSpan = document.createElement('span');
      statSpan.className = 'discard-option-stat';
      const uses = itemUsesArr[idx];
      statSpan.textContent = cardPreviewStat(slotCard, slotCard.uses != null ? uses : undefined);

      btn.appendChild(nameSpan);
      btn.appendChild(statSpan);
      btn.addEventListener('click', () => {
        document.getElementById('discard-dialog').classList.remove('open');
        if (discardResolve) { discardResolve(idx); discardResolve = null; }
      });
      container.appendChild(btn);
    });

    document.getElementById('discard-dialog').classList.add('open');
  });
}

/* ═══════════════════════════════════════════
   DOM EVENT LISTENERS
   Deferred until DOM is ready (file loads in <head>)
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('walkie-use-btn').addEventListener('click', () => {
    const idx = itemSlots.findIndex(c => c?.mechanism?.timing === 'pre_pick');
    if (idx < 0 || cardSelected || itemUsesArr[idx] <= 0) return;
    suppressThreatNextPick = !suppressThreatNextPick;
    updateWalkieBar();
  });

  document.getElementById('adrenaline-use-btn').addEventListener('click', () => {
    const idx = itemSlots.findIndex(c => c?.mechanism?.timing === 'pre_battle');
    if (idx < 0 || cardSelected || itemUsesArr[idx] <= 0) return;
    const card = itemSlots[idx];
    const bonus = card.mechanism.bonus;
    if (tempStrBonus > 0) { tempStrBonus = 0; updateAdrenalineBar(); return; }
    itemUsesArr[idx]--;
    tempStrBonus = bonus;
    if (itemUsesArr[idx] === 0) {
      showToast(`💉 ${card.name} loaded — +${bonus} STR this battle\n🎒 ${card.name} depleted — discarded`, false, 2800);
      setItemSlot(idx, null);
    } else {
      showToast(`💉 ${card.name} loaded — +${bonus} STR this battle (${itemUsesArr[idx]} use${itemUsesArr[idx] !== 1 ? 's' : ''} left)`, false, 2400);
      renderItemSlots();
    }
    updateAdrenalineBar();
  });

  document.getElementById('btn-keep').addEventListener('click', () => {
    document.getElementById('replace-dialog').classList.remove('open');
    if (replaceResolve) { replaceResolve(false); replaceResolve = null; }
  });

  document.getElementById('btn-replace').addEventListener('click', () => {
    document.getElementById('replace-dialog').classList.remove('open');
    if (replaceResolve) { replaceResolve(true); replaceResolve = null; }
  });

  document.getElementById('btn-share').addEventListener('click', () => {
    document.getElementById('replace-dialog').classList.remove('open');
    if (replaceResolve) { replaceResolve('share'); replaceResolve = null; }
  });

  document.getElementById('discard-cancel').addEventListener('click', () => {
    document.getElementById('discard-dialog').classList.remove('open');
    if (discardResolve) { discardResolve(-1); discardResolve = null; }
  });
});
