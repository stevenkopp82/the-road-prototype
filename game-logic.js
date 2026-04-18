/**
 * game-logic.js — Pure, testable versions of core game logic
 *
 * These functions are standalone and take all needed state as parameters.
 * They have no DOM dependencies and no side effects.
 * game.html retains its own copies that read from global state.
 *
 * Consumed by: tests.html
 */

/* ════════════════════════════════════════════
   SEEDED RNG  (mulberry32)
════════════════════════════════════════════ */

var _rngSeed = Date.now() >>> 0;

/** Returns a pseudo-random float in [0, 1) using the current seed. */
function _rng() {
  _rngSeed = (_rngSeed + 0x6D2B79F5) >>> 0;
  var t = Math.imul(_rngSeed ^ (_rngSeed >>> 15), 1 | _rngSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Seed the RNG. Omit argument to use Date.now().
 * Returns the seed that was set — log it to replay a run with ?seed=N.
 */
function setRngSeed(seed) {
  _rngSeed = (seed !== undefined ? seed : Date.now()) >>> 0;
  return _rngSeed;
}

/* ════════════════════════════════════════════
   DECK UTILITIES
════════════════════════════════════════════ */

/**
 * Fisher-Yates shuffle. Returns a new shuffled array; does not mutate input.
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(_rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ════════════════════════════════════════════
   GAME-OVER CONDITIONS
════════════════════════════════════════════ */

/**
 * Returns the losing track name if the value triggers game over, or null.
 * @param {'health'|'sanity'|'mutation'} track
 * @param {number} value
 * @returns {string|null}
 */
function checkGameOverCondition(track, value) {
  if (track === 'health'   && value <= 0)  return 'health';
  if (track === 'sanity'   && value <= 0)  return 'sanity';
  if (track === 'mutation' && value >= 10) return 'mutation';
  return null;
}

/* ════════════════════════════════════════════
   COMBAT STRENGTH
════════════════════════════════════════════ */

/**
 * Base player STR from health bracket + character bonus.
 * @param {number} healthVal  1–10
 * @param {string} character  'default' | 'soldier' | etc.
 * @returns {number}
 */
function getBaseStrength(healthVal, character) {
  let base;
  if (healthVal === 10)    base = 3;
  else if (healthVal >= 7) base = 2;
  else if (healthVal >= 3) base = 1;
  else                     base = 0;
  if (character === 'soldier') base += 1;
  return base;
}

/**
 * Sanity modifier to STR.
 * Frenzy(1): +2 | Cracking(2): -1 | Clear-headed(8+): +1 | Neutral(3-7): 0
 * @param {number} sanityVal  1–10
 * @returns {number}
 */
function getSanityStrModifier(sanityVal) {
  if (sanityVal === 1) return  2;
  if (sanityVal === 2) return -1;
  if (sanityVal >= 8)  return  1;
  return 0;
}

/**
 * Environment bonus for a weapon at a given slot.
 * @param {object|null} weapon          card object with optional env_bonuses array
 * @param {number}      slotIndex
 * @param {object[]}    slotEnvironments  SLOT_ENVIRONMENTS array from game
 * @returns {number}
 */
function getWeaponEnvBonus(weapon, slotIndex, slotEnvironments) {
  if (!weapon?.env_bonuses) return 0;
  const envName = slotEnvironments[slotIndex]?.label?.toLowerCase();
  if (!envName) return 0;
  return weapon.env_bonuses.reduce((total, eb) => {
    return eb.env?.toLowerCase() === envName ? total + (eb.bonus ?? 0) : total;
  }, 0);
}

/**
 * Item battle_str bonus from equipped items.
 * @param {boolean}    usingWeapon
 * @param {object|null} weaponCard
 * @param {object[]}   itemSlots   array of item cards (or null entries)
 * @returns {{ bonus: number, labels: string[] }}
 */
function getItemBattleStrBonus(usingWeapon, weaponCard, itemSlots) {
  let bonus = 0;
  const labels = [];
  for (const card of itemSlots) {
    if (!card?.mechanism || card.mechanism.type !== 'battle_str') continue;
    const m = card.mechanism;
    if (m.condition === 'weapon_class') {
      if (!usingWeapon || !weaponCard) continue;
      if (!m.weapon_classes.includes(weaponCard.weapon_class)) continue;
    }
    bonus += m.bonus;
    labels.push(`+${m.bonus} ${card.name.toLowerCase()}`);
  }
  return { bonus, labels };
}

/**
 * Full player STR including all bonuses. Pure version of game.html's getPlayerStrength().
 * @param {object} state
 * @param {number}   state.healthVal
 * @param {number}   state.sanityVal
 * @param {string}   state.character
 * @param {object|null} state.weapon
 * @param {number}   state.weaponUsesRemaining
 * @param {object[]} state.itemSlots
 * @param {object[]} state.mutantCards
 * @param {number}   state.deckPass            0=Road 1=Sprawl 2=Hive
 * @returns {number}
 */
function getPlayerStrength({ healthVal, sanityVal, character, weapon, weaponUsesRemaining, itemSlots, mutantCards, deckPass }) {
  const base        = getBaseStrength(healthVal, character);
  const usingWeapon = weapon != null && weaponUsesRemaining > 0;
  const weaponBonus = usingWeapon ? (weapon.strength ?? 0) : 0;
  const sanityMod   = getSanityStrModifier(sanityVal);
  const isMelee     = weapon?.weapon_class === 'melee';
  const { bonus: itemBonus } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
  const tuskBonus     = countMutants('forehead_tusk', mutantCards) * 2;
  const hiveMindBonus = (hasMutant('hive_mind', mutantCards) && deckPass >= 2) ? 3 : 0;
  const extraArmBonus = (hasMutant('extra_arm', mutantCards) && isMelee && weaponBonus > 0) ? 3 : 0;
  return base + weaponBonus + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus + sanityMod;
}

/* ════════════════════════════════════════════
   MUTANT HELPERS
════════════════════════════════════════════ */

/**
 * Returns true if the player has at least one mutant with the given effect key.
 * @param {string}   effect
 * @param {object[]} mutantCards
 */
function hasMutant(effect, mutantCards) {
  return mutantCards.some(c => c.effect === effect);
}

/**
 * Returns how many mutants with the given effect key the player has.
 * @param {string}   effect
 * @param {object[]} mutantCards
 */
function countMutants(effect, mutantCards) {
  return mutantCards.filter(c => c.effect === effect).length;
}

/* ════════════════════════════════════════════
   DRAFT SIZING
════════════════════════════════════════════ */

/**
 * Cards the player picks during a location draft.
 * @param {number} gameDealCount  e.g. 30
 */
function getDraftPick(gameDealCount) { return Math.floor(gameDealCount / 5); }

/**
 * Cards shown in the draft pool (pick + 3).
 * @param {number} gameDealCount
 */
function getDraftDraw(gameDealCount) { return getDraftPick(gameDealCount) + 3; }

/* ════════════════════════════════════════════
   ITEM COST MODIFIERS
════════════════════════════════════════════ */

/**
 * Applies cost_modifier item mechanisms to a slot's base costs.
 * Pure: does not mutate inputs; returns a new costs object.
 *
 * @param {number}   slotIndex
 * @param {{food:number, threat:number, mutation:number, health:number, sanity:number}} costs
 * @param {object[]} itemSlots  equipped item cards (may contain nulls)
 * @returns {{food:number, threat:number, mutation:number, health:number, sanity:number}}
 */
function applyItemCostModifiers(slotIndex, costs, itemSlots) {
  let { food, threat, mutation, health, sanity } = costs;
  for (const card of itemSlots) {
    if (!card?.mechanism || card.mechanism.type !== 'cost_modifier') continue;
    const m = card.mechanism;
    if (!m.slots.includes(slotIndex)) continue;
    if (m.cost === 'food')     food     = Math.max(m.min, food     + m.amount);
    if (m.cost === 'threat')   threat   = Math.max(m.min, threat   + m.amount);
    if (m.cost === 'mutation') mutation = Math.max(m.min, mutation + m.amount);
    if (m.cost === 'health')   health   = Math.max(m.min, health   + m.amount);
    if (m.cost === 'sanity')   sanity   = Math.max(m.min, sanity   + m.amount);
  }
  return { food, threat, mutation, health, sanity };
}

/* ════════════════════════════════════════════
   ARMOR ABSORPTION
════════════════════════════════════════════ */

/**
 * Pure armor absorption calculation. Does NOT mutate inputs.
 *
 * @param {{ [stat: string]: number }} damageObj  e.g. { health: -3 }
 * @param {{ head, body, accessory }}  armorSlots  each slot: null or { card, pips: { health?, sanity?, mutation? } }
 * @returns {{
 *   absorbed:      { [stat: string]: number },
 *   newArmorSlots: { head, body, accessory },
 *   lines:         string[]
 * }}
 */
function armorAbsorbCalc(damageObj, armorSlots) {
  // Deep-copy slots so callers aren't mutated
  const slots = {};
  for (const [k, v] of Object.entries(armorSlots)) {
    slots[k] = v ? { card: v.card, pips: { ...v.pips } } : null;
  }

  const absorbed = {};
  const lines    = [];

  for (const [stat, rawAmt] of Object.entries(damageObj)) {
    const isDamage = (stat === 'health' || stat === 'sanity') ? rawAmt < 0 : rawAmt > 0;
    if (!isDamage) continue;

    const dmgAmt   = Math.abs(rawAmt);
    let remaining  = dmgAmt;

    for (const slotKey of ['head', 'body', 'accessory']) {
      const slot = slots[slotKey];
      if (!slot || (slot.pips[stat] ?? 0) <= 0) continue;

      const canAbsorb = Math.min(remaining, slot.pips[stat]);
      slot.pips[stat] -= canAbsorb;
      remaining -= canAbsorb;
      absorbed[stat] = (absorbed[stat] ?? 0) + canAbsorb;
      lines.push(`${slot.card.name} absorbed ${canAbsorb} ${stat} damage (${slot.pips[stat]} left)`);

      const totalLeft = Object.values(slot.pips).reduce((a, b) => a + b, 0);
      if (totalLeft <= 0) {
        lines.push(`${slot.card.name} destroyed`);
        slots[slotKey] = null;
      }
      if (remaining <= 0) break;
    }
  }

  return { absorbed, newArmorSlots: slots, lines };
}
