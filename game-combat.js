/**
 * game-combat.js — Threat deck, combat resolution, strength calculation
 *
 * Loaded before the main game.html inline script.
 * All state variables declared with `var` for cross-file access.
 *
 * Depends on: game-logic.js (shuffle, hasMutant, countMutants, getItemBattleStrBonus)
 *             game-mutant.js (drainMutantSpots)
 *             game-multiplayer.js (mpRequestAllies)
 * Requires globals from game.html: playerState, gameLog, gameOver, slotCards,
 *   discardPile, deckPass, mutantCards, itemSlots, armorSlots, inventory,
 *   injuredMonsters, cardSelected, DRAW_SLOTS, EFFECT_META, SLOT_ENVIRONMENTS,
 *   tempStrBonus, retainedSlot, suppressThreatNextPick, weaponUsesRemaining
 */

var threatFull         = [];
var threatDrawPiles    = {};  // { 'The Road': [], 'The Sprawl': [], 'The Hive': [] }
var threatDiscardPiles = {};  // same structure — cards move here after resolution

const _THREAT_LOCS = ['The Road', 'The Sprawl', 'The Hive'];

async function loadThreatDeck() {
  try {
    const res  = await fetch('data/threat-deck.json?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    threatFull = data.threat_deck;
    threatDrawPiles   = {};
    threatDiscardPiles = {};
    for (const loc of _THREAT_LOCS) {
      threatDrawPiles[loc]   = shuffle(threatFull.filter(c => c.location === loc));
      threatDiscardPiles[loc] = [];
    }
    console.log(`✓ Loaded ${threatFull.length} threat cards`);
  } catch (e) {
    console.warn('Could not load data/threat-deck.json:', e.message);
  }
}

function drawThreatCard() {
  const loc = _THREAT_LOCS[Math.min(deckPass, 2)];
  if (!threatDrawPiles[loc]) return null;
  if (threatDrawPiles[loc].length === 0) {
    if (!threatDiscardPiles[loc]?.length) return null;
    // Reshuffle discard into draw pile
    threatDrawPiles[loc]   = shuffle([...threatDiscardPiles[loc]]);
    threatDiscardPiles[loc] = [];
    console.log(`[Threat] ${loc} reshuffled ${threatDrawPiles[loc].length} cards from discard`);
  }
  const card = threatDrawPiles[loc].shift();
  if (card) threatDiscardPiles[loc].push(card);
  return card ?? null;
}

/* ── Compute player's base strength (no weapon) ── */
function getBaseStrength() {
  const healthVal = playerState.health.value;
  let base;
  if (healthVal === 10)    base = 3;
  else if (healthVal >= 7) base = 2;
  else if (healthVal >= 3) base = 1;
  else                     base = 0;
  if (character === 'soldier') base += 1;
  return base;
}

/* ── Sanity STR modifier ── */
function getSanityStrModifier() {
  const s = playerState.sanity.value;
  if (s === 1)  return 2;  // Frenzy
  if (s === 2)  return -1; // Cracking
  if (s >= 8)   return 1;  // Clear-headed
  return 0;                // 3-7 neutral
}

/* ── Environment bonus for a weapon at a given slot ── */
function getWeaponEnvBonus(weapon, slotIndex) {
  if (!weapon?.env_bonuses) return 0;
  const envName = SLOT_ENVIRONMENTS[slotIndex]?.label?.toLowerCase();
  if (!envName) return 0;
  return weapon.env_bonuses.reduce((total, eb) => {
    return eb.env?.toLowerCase() === envName ? total + (eb.bonus ?? 0) : total;
  }, 0);
}

/* ── Full strength with weapon (if usable) ── */
function getPlayerStrength() {
  const base = getBaseStrength();
  const weapon = inventory.weapon;
  const usingWeapon = weapon && weaponUsesRemaining > 0;
  const weaponBonus = usingWeapon ? (weapon.strength ?? 0) : 0;
  const sanityMod = getSanityStrModifier();
  const isMelee = weapon && weapon.weapon_class === 'melee';
  const { bonus: itemBonus } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
  // Mutant bonuses
  const tuskBonus     = countMutants('forehead_tusk', mutantCards) * 2;
  const hiveMindBonus = (hasMutant('hive_mind', mutantCards) && deckPass >= 2) ? 3 : 0;
  const extraArmBonus = (hasMutant('extra_arm', mutantCards) && isMelee && weaponBonus > 0) ? 3 : 0;
  return base + weaponBonus + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus + sanityMod;
}


/* ── Apply an effects object to player state ── */
async function applyEffects(effects, skipArmorAbsorb = false) {
  const lines = [];
  // Armor absorption for setbacks (battle damage is absorbed upstream)
  if (!skipArmorAbsorb) {
    const { absorbed, lines: absLines } = armorAbsorb(effects);
    absLines.forEach(l => {
      lines.push(l);
      gameLog.add(l, l.includes('destroyed') ? 'warn' : 'dim');
    });
    // Reduce effects by absorbed amounts before processing tracks
    effects = { ...effects };
    for (const [stat, absAmt] of Object.entries(absorbed)) {
      if (effects[stat] != null) {
        const sign = effects[stat] < 0 ? -1 : 1;
        const reduced = sign * Math.max(0, Math.abs(effects[stat]) - absAmt);
        if (reduced === 0) delete effects[stat];
        else effects[stat] = reduced;
      }
    }
  }
  for (const [track, amount] of Object.entries(effects)) {
    if (!playerState[track]) continue;
    const current = playerState[track].value;


    const next = Math.max(0, Math.min(10, current + amount));
    if (playerState[track].set) playerState[track].set(next);
    const effectLine = `${EFFECT_META[track]?.icon ?? ''} ${track} ${amount > 0 ? '+' : ''}${amount} (${next})`;
    lines.push(effectLine);
    // Log with smart colouring: bad = health/sanity loss, mutation gain; good = health/sanity gain, food gain
    const isBad = (track === 'health' && amount < 0) || (track === 'sanity' && amount < 0) || (track === 'mutation' && amount > 0);
    const isGood = (track === 'health' && amount > 0) || (track === 'sanity' && amount > 0) || (track === 'food' && amount > 0) || (track === 'mutation' && amount < 0);
    gameLog.add(effectLine, isBad ? 'warn' : isGood ? 'good' : 'dim');
    // Starvation: food just hit 0 via effect
    if (track === 'food' && next === 0 && amount < 0) {
      applyStarvation();
      if (gameOver) return lines;
    } else {
      checkGameOver(track, next);
      if (gameOver) return lines;
    }
  }
  return lines;
}

/* ── Discard N items from item slots (leftmost filled first) ── */
/* ── Show one threat card in the dialog, resolve it, wait for dismiss ── */
async function resolveThreatCard(card, queueEl, queueDots, currentIdx, slotIndex) {
  return new Promise(async (resolve) => {
    // Mark pip as active
    queueDots[currentIdx]?.classList.add('done');

    const display  = document.getElementById('threat-card-display');
    const effectsEl = document.getElementById('threat-effects-list');
    const btn      = document.getElementById('threat-continue-btn');
    display.innerHTML = '';
    effectsEl.innerHTML = '';
    btn.className = 'threat-continue-btn';

    // Log this threat
    gameLog.add(`☣ Threat: ${card.name} (${card.type})`, card.type === 'monster' ? 'warn' : card.type === 'break' ? 'dim' : '');

    // Type badge
    const badge = document.createElement('div');
    badge.className = `card-type-badge ttype-${card.type}`;
    badge.textContent = card.type;
    display.appendChild(badge);

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'card-name';
    nameEl.textContent = card.name;
    display.appendChild(nameEl);

    if (card.icon) display.appendChild(createIconEl(card.icon, card.name, 'card-icon-img'));

    display.appendChild(Object.assign(document.createElement('div'), { className: 'card-divider' }));

    const bodyEl = document.createElement('div');
    bodyEl.className = 'threat-card-body';

    let effectLines = [];
    let lootLostThisCard = false;

    if (card.type === 'break') {
      bodyEl.textContent = 'The path is clear. No threat.';
      btn.classList.add('btn-gold');

    } else if (card.type === 'setback') {
      const parts = [];
      if (card.effects) {
        for (const [t, v] of Object.entries(card.effects)) {
          parts.push(`${EFFECT_META[t]?.icon ?? ''} ${t} ${v > 0 ? '+' : ''}${v}`);
        }
        effectLines = await applyEffects(card.effects);
        if (gameOver) { resolve({ lootLost: false }); return; }
      }

      bodyEl.textContent = parts.length ? `Effect: ${parts.join(', ')}` : 'No effect.';

    } else if (card.type === 'monster') {
      const baseStr    = getBaseStrength();
      const monsterStr = card.strength ?? 0;
      const weapon     = inventory.weapon;
      const weaponStr  = (weapon && weaponUsesRemaining > 0) ? (weapon.strength ?? 0) : 0;
      const hasWeapon  = weapon != null && weaponUsesRemaining > 0;
      const isProjectile = weapon && (weapon.weapon_class === 'ranged' || weapon.weapon_class === 'explosive');
      const isMelee      = weapon && weapon.weapon_class === 'melee';
      // Mutant bonuses
      const tuskBonus     = countMutants('forehead_tusk', mutantCards) * 2;
      const hiveMindBonus = (hasMutant('hive_mind', mutantCards) && deckPass >= 2) ? 3 : 0;
      // extra_arm: +3 STR only when using a melee weapon
      const getExtraArmBonus = (usingMelee) => (hasMutant('extra_arm', mutantCards) && usingMelee) ? 3 : 0;
      // Adrenaline (pre_battle active): +N STR for this battle only
      const adrenalineBonus = tempStrBonus;
      // Environment bonus from weapon's env_bonuses array
      const envBonus = getWeaponEnvBonus(weapon, slotIndex);
      tempStrBonus = 0; // consumed regardless of outcome

      // Weapon use state — default to using weapon if available
      let usingWeapon = hasWeapon;

      // ── Two-panel battle layout ──────────────────────────────────────
      display.classList.add('battle-mode');

      // Left panel: player strength breakdown
      const playerPanel = document.createElement('div');
      playerPanel.className = 'battle-panel battle-player-panel';
      const playerTitle = document.createElement('div');
      playerTitle.className = 'battle-panel-title';
      playerTitle.textContent = 'Your Strength';
      playerPanel.appendChild(playerTitle);
      const strRows = document.createElement('div');
      strRows.className = 'battle-str-rows';
      playerPanel.appendChild(strRows);
      const strTotal = document.createElement('div');
      strTotal.className = 'battle-str-total';
      playerPanel.appendChild(strTotal);

      // Right panel: monster info
      const monsterPanel = document.createElement('div');
      monsterPanel.className = 'battle-panel battle-monster-panel';
      const monsterPanelTitle = document.createElement('div');
      monsterPanelTitle.className = 'battle-panel-title';
      monsterPanelTitle.textContent = 'Monster';
      monsterPanel.appendChild(monsterPanelTitle);
      if (card.icon) monsterPanel.appendChild(createIconEl(card.icon, card.name, 'card-icon-img battle-panel-icon'));
      const monsterNameEl = document.createElement('div');
      monsterNameEl.className = 'battle-monster-name';
      monsterNameEl.textContent = card.name;
      monsterPanel.appendChild(monsterNameEl);
      const monsterStrEl = document.createElement('div');
      monsterStrEl.className = 'battle-monster-stat';
      monsterStrEl.innerHTML = `<span class="bsr-label">STR</span><span class="battle-stat-value monster-str">${monsterStr}</span>`;
      monsterPanel.appendChild(monsterStrEl);
      if (card.damage) {
        const dmgParts = Object.entries(card.damage)
          .map(([k, v]) => `${EFFECT_META[k]?.icon ?? ''} ${v < 0 ? '' : '+'}${v}`).join(' ');
        const dmgEl = document.createElement('div');
        dmgEl.className = 'battle-monster-stat';
        dmgEl.innerHTML = `<span class="bsr-label">Damage</span><span class="battle-damage-val">${dmgParts}</span>`;
        monsterPanel.appendChild(dmgEl);
      }

      const battleLayout = document.createElement('div');
      battleLayout.className = 'battle-layout';
      battleLayout.appendChild(playerPanel);
      battleLayout.appendChild(monsterPanel);
      display.appendChild(battleLayout);

      // Helper: build a STR breakdown row
      const makeBsrRow = (label, val, cls) => {
        const row = document.createElement('div');
        row.className = 'battle-str-row' + (cls ? ' ' + cls : '');
        row.innerHTML = `<span class="bsr-label">${label}</span><span class="bsr-val">${typeof val === 'number' && val > 0 ? '+' : ''}${val}</span>`;
        return row;
      };

      // Populate player panel (weapon-aware)
      const updatePlayerPanel = () => {
        const usingMelee = usingWeapon && isMelee;
        const extraArmBonus = getExtraArmBonus(usingMelee);
        const sanityMod = getSanityStrModifier();
        const { bonus: itemBonus, labels: itemLabels } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
        const activeEnvBonus = usingWeapon ? envBonus : 0;
        const effStr = (usingWeapon ? baseStr + weaponStr : baseStr)
                     + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus + adrenalineBonus + sanityMod + activeEnvBonus;
        strRows.innerHTML = '';
        strRows.appendChild(makeBsrRow('Base', baseStr, 'str-base'));
        if (usingWeapon) strRows.appendChild(makeBsrRow(weapon.name, weaponStr, 'str-weapon'));
        itemLabels.forEach(lbl => {
          const m = lbl.match(/^([+-]?\d+)\s+(.+)$/);
          if (m) strRows.appendChild(makeBsrRow(m[2], parseInt(m[1]), 'str-item'));
        });
        if (tuskBonus)     strRows.appendChild(makeBsrRow('Forehead Tusk', tuskBonus, 'str-mutant'));
        if (hiveMindBonus) strRows.appendChild(makeBsrRow('Hive Mind', hiveMindBonus, 'str-mutant'));
        if (extraArmBonus) strRows.appendChild(makeBsrRow('Extra Arm', extraArmBonus, 'str-mutant'));
        if (adrenalineBonus) strRows.appendChild(makeBsrRow('Adrenaline', adrenalineBonus, 'str-item'));
        if (sanityMod) strRows.appendChild(makeBsrRow('Sanity' + (sanityMod === 2 ? ' (frenzy)' : ''), sanityMod, sanityMod > 0 ? 'str-bonus' : 'str-penalty'));
        if (activeEnvBonus) strRows.appendChild(makeBsrRow(SLOT_ENVIRONMENTS[slotIndex]?.label ?? 'Env', activeEnvBonus, 'str-bonus'));
        strTotal.innerHTML = `<span class="bsr-label">Total</span><span class="battle-stat-value player-str">${effStr}</span>`;
      };

      // ── Actions panel (below two panels) ──────────────────────────────
      const battleActions = document.createElement('div');
      battleActions.className = 'battle-actions';

      if (hasWeapon) {
        const toggleRow = document.createElement('div');
        toggleRow.className = 'weapon-toggle-row';
        const useBtn = document.createElement('button');
        useBtn.className = 'weapon-toggle-btn active';
        useBtn.textContent = `⚔ Use ${weapon.name} (${weaponUsesRemaining} use${weaponUsesRemaining !== 1 ? 's' : ''} left)`;
        const skipBtn = document.createElement('button');
        skipBtn.className = 'weapon-toggle-btn inactive';
        skipBtn.textContent = 'Fight bare-handed';
        toggleRow.appendChild(useBtn);
        toggleRow.appendChild(skipBtn);
        battleActions.appendChild(toggleRow);
        useBtn.addEventListener('click', () => {
          usingWeapon = true;
          useBtn.className  = 'weapon-toggle-btn active';
          skipBtn.className = 'weapon-toggle-btn inactive';
          updatePlayerPanel();
          updateOutcome();
        });
        skipBtn.addEventListener('click', () => {
          usingWeapon = false;
          useBtn.className  = 'weapon-toggle-btn inactive';
          skipBtn.className = 'weapon-toggle-btn active';
          updatePlayerPanel();
          updateOutcome();
        });
        updatePlayerPanel();
      } else {
        // No weapon: static bare-hand breakdown
        const sanityModBare = getSanityStrModifier();
        const { bonus: bareItemBonus, labels: bareItemLabels } = getItemBattleStrBonus(false, null, itemSlots);
        const bareStr = baseStr + bareItemBonus + tuskBonus + hiveMindBonus + adrenalineBonus + sanityModBare;
        strRows.appendChild(makeBsrRow('Base', baseStr, 'str-base'));
        bareItemLabels.forEach(lbl => {
          const m = lbl.match(/^([+-]?\d+)\s+(.+)$/);
          if (m) strRows.appendChild(makeBsrRow(m[2], parseInt(m[1]), 'str-item'));
        });
        if (tuskBonus)     strRows.appendChild(makeBsrRow('Forehead Tusk', tuskBonus, 'str-mutant'));
        if (hiveMindBonus) strRows.appendChild(makeBsrRow('Hive Mind', hiveMindBonus, 'str-mutant'));
        if (adrenalineBonus) strRows.appendChild(makeBsrRow('Adrenaline', adrenalineBonus, 'str-item'));
        if (sanityModBare) strRows.appendChild(makeBsrRow('Sanity' + (sanityModBare === 2 ? ' (frenzy)' : ''), sanityModBare, sanityModBare > 0 ? 'str-bonus' : 'str-penalty'));
        strTotal.innerHTML = `<span class="bsr-label">Total</span><span class="battle-stat-value player-str">${bareStr}</span>`;
      }

      // Outcome + body text live in actions panel
      const outcomeEl = document.createElement('div');
      outcomeEl.className = 'battle-outcome';
      battleActions.appendChild(outcomeEl);
      battleActions.appendChild(bodyEl);
      display.appendChild(battleActions);

      function updateOutcome() {
        const usingMelee = usingWeapon && isMelee;
        const extraArmBonus = getExtraArmBonus(usingMelee);
        const sanityMod = getSanityStrModifier();
        const { bonus: itemBonus } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
        const activeEnvBonus = usingWeapon ? envBonus : 0;
        const effStr = (usingWeapon ? baseStr + weaponStr : baseStr)
                     + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus + adrenalineBonus + sanityMod + activeEnvBonus;
        lootLostThisCard = effStr < monsterStr;
        outcomeEl.className = 'battle-outcome';
        effectLines = [];
        if (effStr > monsterStr) {
          outcomeEl.classList.add('outcome-win');
          outcomeEl.textContent = '⚔ Victory — loot secured!';
          bodyEl.textContent = 'You overpower the creature.';
          btn.className = 'threat-continue-btn btn-gold';
        } else if (effStr === monsterStr) {
          outcomeEl.classList.add('outcome-tie');
          outcomeEl.textContent = '⚔ Tie — loot secured, but at a cost';
          bodyEl.textContent = 'You defeat it, but not without harm.';
          if (card.damage) effectLines = Object.entries(card.damage).map(([k,v]) => `${EFFECT_META[k]?.icon ?? ''} ${k} ${v > 0 ? '+' : ''}${v}`);
        } else {
          outcomeEl.classList.add('outcome-loss');
          outcomeEl.textContent = '⚔ Defeat — loot lost';
          bodyEl.textContent = 'The creature bests you.';
          if (card.damage) effectLines = Object.entries(card.damage).map(([k,v]) => `${EFFECT_META[k]?.icon ?? ''} ${k} ${v > 0 ? '+' : ''}${v}`);
        }
        effectsEl.innerHTML = '';
        effectLines.forEach(line => {
          const p = document.createElement('div');
          p.textContent = line;
          effectsEl.appendChild(p);
        });
      }

      updateOutcome();

      // Override the continue handler to consume a weapon use and apply damage
      const origHandler = async () => {
        btn.removeEventListener('click', origHandler);
        if (usingWeapon && hasWeapon) {
          weaponUsesRemaining--;
          refreshWeaponZone();
        }
        // Compute final effective STR (same as updateOutcome)
        const usingMelee = usingWeapon && isMelee;
        const extraArmBonus = getExtraArmBonus(usingMelee);
        const sanityMod = getSanityStrModifier();
        const { bonus: itemBonus } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
        const effStr = (usingWeapon ? baseStr + weaponStr : baseStr)
                     + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus + adrenalineBonus + sanityMod;

        // Helper: apply damage with armor absorption
        const applyBattleDamage = async () => {
          if (!card.damage) return false;
          let dmg = { ...card.damage };
          const { absorbed, lines: absLines } = armorAbsorb(dmg);
          absLines.forEach(l => { showToast(l, false, 2200); gameLog.add(l, l.includes('destroyed') ? 'warn' : 'dim'); });
          const reduced = {};
          for (const [stat, amt] of Object.entries(dmg)) {
            const a = absorbed[stat] ?? 0; const s = amt < 0 ? -1 : 1;
            const r = s * Math.max(0, Math.abs(amt) - a);
            if (r !== 0) reduced[stat] = r;
          }
          if (Object.keys(reduced).length > 0) await applyEffects(reduced, true);
          return gameOver;
        };

        // Helper: apply win/tie passive bonuses (Matches, feral instinct, hardened skin)
        const applyWinBonuses = () => {
          // Item passive_event: battle_win_or_tie
          const itemLines = triggerBattleWinOrTie();
          itemLines.forEach(l => showToast(l, false, 2000));
          // Character passive: Hunter gains +2 food on battle win/tie
          if (character === 'hunter') {
            const hf = Math.min(maxFood, playerState.food.value + 2);
            if (playerState.food.set) playerState.food.set(hf);
            showToast(`🏹 Hunter — food +2 (${hf})`, false, 2400);
          }
          // Mutant bonuses
          if (hasMutant('feral_instinct', mutantCards)) {
            const fif = Math.min(maxFood, playerState.food.value + 2);
            if (playerState.food.set) playerState.food.set(fif);
            showToast(`🧬 Feral instinct — food +2 (${fif})`, false, 2400);
          }
          if (hasMutant('hardened_skin', mutantCards)) {
            const restorable = Object.entries(armorSlots).find(([k, slot]) => {
              if (!slot) return false;
              return Object.keys(slot.card.absorb).some(stat => (slot.pips[stat] ?? 0) < slot.card.absorb[stat]);
            });
            if (restorable) {
              const [slotKey, slot] = restorable;
              const stat = Object.keys(slot.card.absorb).find(s => (slot.pips[s] ?? 0) < slot.card.absorb[s]);
              slot.pips[stat] = Math.min(slot.card.absorb[stat], (slot.pips[stat] ?? 0) + 1);
              refreshArmorSlot(slotKey);
              showToast(`🪨 Hardened skin — +1 ${stat} pip restored on ${slot.card.name}`, false, 2400);
            }
          }
        };

        // Apply damage on tie or loss
        if (effStr <= monsterStr) { if (await applyBattleDamage()) { resolve({ lootLost: true }); return; } }

        if (effStr > monsterStr) {
          gameLog.add(`⚔ Victory vs ${card.name} (your ${effStr} > ${monsterStr})`, 'good');
        } else if (effStr === monsterStr) {
          gameLog.add(`⚔ Tie vs ${card.name} (${effStr} = ${monsterStr}) — damage taken`, 'warn');
        } else {
          gameLog.add(`⚔ Defeat vs ${card.name} (your ${effStr} < ${monsterStr}) — damage taken`, 'warn');
        }

        // ── First battle loss: offer flee or fight again ──────────────────────
        if (effStr < monsterStr) {
          const reducedMonsterStr = Math.max(0, monsterStr - effStr);

          // Update display to show flee/fight-again choice
          outcomeEl.className = 'battle-outcome outcome-loss';
          outcomeEl.textContent = '⚔ Defeat — the creature is wounded';
          bodyEl.textContent = `Its strength is now ${reducedMonsterStr}. Your move.`;
          effectsEl.innerHTML = '';
          btn.style.display = 'none';

          const choiceRow = document.createElement('div');
          choiceRow.className = 'second-chance-row';
          const fleeBtn = document.createElement('button');
          fleeBtn.className = 'second-chance-btn btn-flee';
          fleeBtn.textContent = '↩ Flee';
          const fightBtn = document.createElement('button');
          fightBtn.className = 'second-chance-btn btn-fight';
          fightBtn.textContent = isMultiplayer ? '⚔ Call for Allies' : '🎲 Fight Again';
          choiceRow.appendChild(fleeBtn);
          choiceRow.appendChild(fightBtn);
          effectsEl.appendChild(choiceRow);

          const secondChoice = await new Promise(res => {
            fleeBtn.onclick = () => res('flee');
            fightBtn.onclick = () => res('fight');
          });

          effectsEl.innerHTML = '';
          // In co-op the ally wait handles its own continue button — don't show it yet
          if (!isMultiplayer || secondChoice === 'flee') btn.style.display = '';

          if (secondChoice === 'flee') {
            gameLog.add(`↩ Fled from ${card.name} — loot abandoned`, 'dim');
            outcomeEl.textContent = '↩ You flee — loot abandoned';
            bodyEl.textContent = 'You escape with your life.';
            btn.className = 'threat-continue-btn';
            btn.textContent = 'End Turn';
            await new Promise(res => { btn.addEventListener('click', function h() { btn.removeEventListener('click', h); btn.textContent = 'Continue'; res(); }); });
            resolve({ lootLost: true });
            return;
          }

          // ── Fight again: co-op uses ally system; solo rolls d6 ───────────
          if (isMultiplayer) {
            const myEffStr = effStr; // already computed above

            // Add abandon button to the battle dialog while waiting for allies
            const abandonRow = document.createElement('div');
            abandonRow.className = 'second-chance-row';
            const abandonBtn = document.createElement('button');
            abandonBtn.className = 'second-chance-btn btn-flee';
            abandonBtn.textContent = '↩ Abandon Call';
            abandonRow.appendChild(abandonBtn);
            effectsEl.appendChild(abandonRow);

            let allyResult;
            try {
              allyResult = await mpRequestAllies(card, reducedMonsterStr, myEffStr, abandonBtn);
            } catch (e) {
              console.error('mpRequestAllies failed:', e);
              allyResult = { won: false, combinedStr: 0 };
              btn.style.display = '';
            }
            effectsEl.innerHTML = '';

            if (allyResult.abandoned) {
              gameLog.add(`↩ You abandoned the call for help — turn ends`, 'dim');
              resolve({ lootLost: true });
              return;
            }

            // Rebuild display to show ally result
            display.innerHTML = '';
            const r2Layout = document.createElement('div');
            r2Layout.className = 'battle-layout';
            const r2PlayerPanel = document.createElement('div');
            r2PlayerPanel.className = 'battle-panel battle-player-panel';
            const r2Title = document.createElement('div');
            r2Title.className = 'battle-panel-title';
            r2Title.textContent = allyResult.won ? '⚔ Allies Answered!' : '⚔ No Help Came';
            r2PlayerPanel.appendChild(r2Title);
            const r2StrEl = document.createElement('div');
            r2StrEl.className = 'battle-str-total';
            r2StrEl.innerHTML = `<span class="bsr-label">Ally STR</span><span class="battle-stat-value player-str">${allyResult.combinedStr}</span>`;
            r2PlayerPanel.appendChild(r2StrEl);
            const r2MonPanel = document.createElement('div');
            r2MonPanel.className = 'battle-panel battle-monster-panel';
            const r2MonTitle = document.createElement('div');
            r2MonTitle.className = 'battle-panel-title';
            r2MonTitle.textContent = 'Monster (wounded)';
            r2MonPanel.appendChild(r2MonTitle);
            const r2StrMon = document.createElement('div');
            r2StrMon.className = 'battle-monster-stat';
            r2StrMon.innerHTML = `<span class="bsr-label">STR</span><span class="battle-stat-value monster-str">${reducedMonsterStr}</span>`;
            r2MonPanel.appendChild(r2StrMon);
            r2Layout.appendChild(r2PlayerPanel);
            r2Layout.appendChild(r2MonPanel);
            display.appendChild(r2Layout);

            const r2Actions = document.createElement('div');
            r2Actions.className = 'battle-actions';
            const outcome2 = document.createElement('div');
            outcome2.className = 'battle-outcome';
            const body2 = document.createElement('div');
            body2.className = 'threat-card-body';
            r2Actions.appendChild(outcome2);
            r2Actions.appendChild(body2);
            display.appendChild(r2Actions);
            effectsEl.innerHTML = '';

            let secondLootLost;
            if (allyResult.won) {
              outcome2.classList.add('outcome-win');
              outcome2.textContent = '⚔ Victory — loot secured!';
              body2.textContent = 'Your allies turn the tide.';
              btn.className = 'threat-continue-btn btn-gold';
              secondLootLost = false;
              gameLog.add(`⚔ Allies helped defeat ${card.name} (combined ${allyResult.combinedStr} > ${reducedMonsterStr})`, 'good');
            } else {
              outcome2.classList.add('outcome-loss');
              outcome2.textContent = '⚔ Defeat — the group retreats';
              body2.textContent = 'Not enough strength. You abandon the fight.';
              btn.className = 'threat-continue-btn';
              secondLootLost = true;
              if (card.damage) Object.entries(card.damage).forEach(([k,v]) => {
                const p = document.createElement('div');
                p.textContent = `${EFFECT_META[k]?.icon ?? ''} ${k} ${v>0?'+':''}${v}`;
                effectsEl.appendChild(p);
              });
              gameLog.add(`⚔ Allies could not defeat ${card.name} (${allyResult.combinedStr} vs ${reducedMonsterStr}) — loot lost`, 'warn');
            }

            btn.style.display = '';
            await new Promise(res => { btn.addEventListener('click', function h() { btn.removeEventListener('click', h); res(); }); });
            if (secondLootLost || !allyResult.won) {
              if (await applyBattleDamage()) { resolve({ lootLost: true }); return; }
            }
            if (allyResult.won) applyWinBonuses();
            resolve({ lootLost: secondLootLost });
            return;
          }

          const roll = Math.floor(_rng() * 6) + 1;
          const isAutoWin = roll === 6;
          const secondStr = roll; // dice roll replaces player strength

          // Rebuild display for round 2 — two-panel layout
          display.innerHTML = '';

          const r2PlayerPanel = document.createElement('div');
          r2PlayerPanel.className = 'battle-panel battle-player-panel';
          const r2Title = document.createElement('div');
          r2Title.className = 'battle-panel-title';
          r2Title.textContent = isAutoWin ? '🎲 Six! Auto Win' : '🎲 Round 2';
          r2PlayerPanel.appendChild(r2Title);
          const r2RollEl = document.createElement('div');
          r2RollEl.className = 'battle-str-total';
          r2RollEl.innerHTML = `<span class="bsr-label">Dice Roll</span><span class="battle-stat-value player-str">${roll}</span>`;
          r2PlayerPanel.appendChild(r2RollEl);

          const r2MonsterPanel = document.createElement('div');
          r2MonsterPanel.className = 'battle-panel battle-monster-panel';
          const r2MonTitle = document.createElement('div');
          r2MonTitle.className = 'battle-panel-title';
          r2MonTitle.textContent = 'Monster';
          r2MonsterPanel.appendChild(r2MonTitle);
          if (card.icon) r2MonsterPanel.appendChild(createIconEl(card.icon, card.name, 'card-icon-img battle-panel-icon'));
          const r2NameEl = document.createElement('div');
          r2NameEl.className = 'battle-monster-name';
          r2NameEl.textContent = card.name;
          r2MonsterPanel.appendChild(r2NameEl);
          const r2StrEl = document.createElement('div');
          r2StrEl.className = 'battle-monster-stat';
          r2StrEl.innerHTML = `<span class="bsr-label">STR (wounded)</span><span class="battle-stat-value monster-str">${reducedMonsterStr}</span>`;
          r2MonsterPanel.appendChild(r2StrEl);

          const r2Layout = document.createElement('div');
          r2Layout.className = 'battle-layout';
          r2Layout.appendChild(r2PlayerPanel);
          r2Layout.appendChild(r2MonsterPanel);
          display.appendChild(r2Layout);

          const body2 = document.createElement('div');
          body2.className = 'threat-card-body';
          const outcome2 = document.createElement('div');
          outcome2.className = 'battle-outcome';
          const r2Actions = document.createElement('div');
          r2Actions.className = 'battle-actions';
          r2Actions.appendChild(outcome2);
          r2Actions.appendChild(body2);
          display.appendChild(r2Actions);
          effectsEl.innerHTML = '';

          let secondLootLost;
          if (isAutoWin || secondStr > reducedMonsterStr) {
            outcome2.classList.add('outcome-win');
            outcome2.textContent = isAutoWin ? '🎲 Six! Auto Victory — loot secured!' : '⚔ Victory — loot secured!';
            body2.textContent = 'You slay the wounded creature.';
            btn.className = 'threat-continue-btn btn-gold';
            secondLootLost = false;
          } else if (secondStr === reducedMonsterStr) {
            outcome2.classList.add('outcome-tie');
            outcome2.textContent = '⚔ Tie — loot secured, but at a cost';
            body2.textContent = 'You finish it, but take a hit.';
            btn.className = 'threat-continue-btn btn-gold';
            secondLootLost = false;
            if (card.damage) Object.entries(card.damage).forEach(([k,v]) => {
              const p = document.createElement('div');
              p.textContent = `${EFFECT_META[k]?.icon ?? ''} ${k} ${v>0?'+':''}${v}`;
              effectsEl.appendChild(p);
            });
          } else {
            outcome2.classList.add('outcome-loss');
            outcome2.textContent = '⚔ Defeat — turn ends';
            body2.textContent = 'The creature endures. You retreat.';
            btn.className = 'threat-continue-btn';
            secondLootLost = true;
            if (card.damage) Object.entries(card.damage).forEach(([k,v]) => {
              const p = document.createElement('div');
              p.textContent = `${EFFECT_META[k]?.icon ?? ''} ${k} ${v>0?'+':''}${v}`;
              effectsEl.appendChild(p);
            });
          }

          // Wait for player to confirm
          await new Promise(res => { btn.addEventListener('click', function h() { btn.removeEventListener('click', h); res(); }); });

          // Apply second battle damage (tie or loss)
          if (secondStr === reducedMonsterStr || secondLootLost) {
            if (await applyBattleDamage()) { resolve({ lootLost: true }); return; }
          }

          // Log second battle
          if (isAutoWin) {
            gameLog.add(`🎲 Round 2 vs ${card.name} — rolled 6, Auto Victory!`, 'good');
          } else if (!secondLootLost) {
            gameLog.add(`🎲 Round 2 vs ${card.name} — roll ${roll} vs STR ${reducedMonsterStr}, ${secondStr === reducedMonsterStr ? 'Tie — damage taken' : 'Victory!'}`, secondStr === reducedMonsterStr ? 'warn' : 'good');
          } else {
            gameLog.add(`🎲 Round 2 vs ${card.name} — roll ${roll} vs STR ${reducedMonsterStr}, Defeat — turn ends`, 'warn');
          }

          if (!secondLootLost) applyWinBonuses();
          resolve({ lootLost: secondLootLost });
          return;
        }

        // ── Win or tie first battle ───────────────────────────────────────────
        if (effStr >= monsterStr) applyWinBonuses();
        resolve({ lootLost: lootLostThisCard });
      };
      btn.addEventListener('click', origHandler);
      // bodyEl is already in battleActions — skip the default append below
      return;
    }

    display.appendChild(bodyEl);

    // Effect lines under the card
    effectLines.forEach(line => {
      const p = document.createElement('div');
      p.textContent = line;
      effectsEl.appendChild(p);
    });

    // Wire up continue button (only fires once)
    const handler = async () => {
      btn.removeEventListener('click', handler);
      resolve({ lootLost: lootLostThisCard });
    };
    btn.addEventListener('click', handler);
  });
}

/* ── Pre-battle against a lingering injured monster ── */
// Returns { won: true } if player wins (or ties), { won: false } on another loss
function battleInjuredMonster(slotIndex) {
  return new Promise(async (resolve) => {
    const inj = injuredMonsters[slotIndex];
    if (!inj) { resolve({ won: true }); return; }

    const dialog  = document.getElementById('threat-dialog');
    const queueEl = document.getElementById('threat-queue');
    const display = document.getElementById('threat-card-display');
    const effectsEl = document.getElementById('threat-effects-list');
    const btn     = document.getElementById('threat-continue-btn');

    // Show single pip
    queueEl.innerHTML = '';
    const dot = document.createElement('div');
    dot.className = 'threat-pip-indicator done';
    queueEl.appendChild(dot);
    dialog.classList.add('open');

    display.innerHTML = '';
    effectsEl.innerHTML = '';
    btn.className = 'threat-continue-btn';

    // Header
    const badge = document.createElement('div');
    badge.className = 'card-type-badge ttype-monster';
    badge.textContent = 'injured monster';
    display.appendChild(badge);

    const nameEl = document.createElement('div');
    nameEl.className = 'card-name';
    nameEl.textContent = inj.card.name;
    display.appendChild(nameEl);

    if (inj.card.icon) display.appendChild(createIconEl(inj.card.icon, inj.card.name, 'card-icon-img'));

    display.appendChild(Object.assign(document.createElement('div'), { className: 'card-divider' }));

    const injNote = document.createElement('div');
    injNote.style.cssText = 'font-family:Spectral,serif;font-size:0.62rem;color:#e07070;opacity:0.8;margin:2px 0 6px;';
    injNote.textContent = `Injured — original STR ${inj.originalStrength}, now STR ${inj.remainingStrength}`;
    display.appendChild(injNote);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'threat-card-body';

    const monsterStr = inj.remainingStrength;
    const baseStr    = getBaseStrength();
    const weapon     = inventory.weapon;
    const weaponStr  = (weapon && weaponUsesRemaining > 0) ? (weapon.strength ?? 0) : 0;
    const hasWeapon  = weapon != null && weaponUsesRemaining > 0;
    const isProjectile = weapon && (weapon.weapon_class === 'ranged' || weapon.weapon_class === 'explosive');
    const isMelee      = weapon && weapon.weapon_class === 'melee';
    const tuskBonus     = countMutants('forehead_tusk', mutantCards) * 2;
    const hiveMindBonus = (hasMutant('hive_mind', mutantCards) && deckPass >= 2) ? 3 : 0;
    const getExtraArmBonus = (usingMelee) => (hasMutant('extra_arm', mutantCards) && usingMelee) ? 3 : 0;
    let usingWeapon = hasWeapon;

    const battleRow = document.createElement('div');
    battleRow.className = 'threat-battle-row';
    const playerSide = document.createElement('div');
    playerSide.className = 'battle-stat';
    const vsEl = document.createElement('div');
    vsEl.className = 'battle-vs';
    vsEl.textContent = 'vs';
    const monsterSide = document.createElement('div');
    monsterSide.className = 'battle-stat';
    monsterSide.innerHTML = `
      <span class="battle-stat-label">${inj.card.name} STR (injured)</span>
      <span class="battle-stat-value monster-str">${monsterStr}</span>`;
    battleRow.appendChild(playerSide);
    battleRow.appendChild(vsEl);
    battleRow.appendChild(monsterSide);
    display.appendChild(battleRow);

    if (hasWeapon) {
      const toggleRow = document.createElement('div');
      toggleRow.className = 'weapon-toggle-row';
      const useBtn = document.createElement('button');
      useBtn.className = 'weapon-toggle-btn active';
      useBtn.textContent = `⚔ Use ${weapon.name} (${weaponUsesRemaining} use${weaponUsesRemaining !== 1 ? 's' : ''} left)`;
      const skipBtn = document.createElement('button');
      skipBtn.className = 'weapon-toggle-btn inactive';
      skipBtn.textContent = 'Fight bare-handed';
      toggleRow.appendChild(useBtn);
      toggleRow.appendChild(skipBtn);
      display.appendChild(toggleRow);

      const updatePlayerSide = () => {
        const usingMelee = usingWeapon && isMelee;
        const extraArmBonus = getExtraArmBonus(usingMelee);
        const sanityMod = getSanityStrModifier();
        const { bonus: itemBonus, labels: itemLabels } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
        const effStr = (usingWeapon ? baseStr + weaponStr : baseStr)
                     + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus + sanityMod;
        const weaponLabel   = usingWeapon       ? `+${weaponStr} weapon` : '';
        const itemLabel     = itemLabels.length  ? itemLabels.join(' ')   : '';
        const tuskLabel     = tuskBonus          ? `+${tuskBonus} tusk`  : '';
        const hiveMindLabel = hiveMindBonus      ? '+3 hive mind'         : '';
        const extraArmLabel = extraArmBonus      ? '+3 extra arm'         : '';
        const sanityLabel   = sanityMod > 0      ? `+${sanityMod} sanity${sanityMod===2?' (frenzy)':''}` : sanityMod < 0 ? `${sanityMod} sanity` : '';
        const labels = [weaponLabel, itemLabel, tuskLabel, hiveMindLabel, extraArmLabel, sanityLabel].filter(Boolean).join(' ');
        playerSide.innerHTML = `
          <span class="battle-stat-label">Your STR${labels ? ' ' + labels : ''}</span>
          <span class="battle-stat-value player-str">${effStr}</span>`;
      };
      useBtn.addEventListener('click', () => {
        usingWeapon = true;
        useBtn.className = 'weapon-toggle-btn active';
        skipBtn.className = 'weapon-toggle-btn inactive';
        updatePlayerSide(); updateOutcome();
      });
      skipBtn.addEventListener('click', () => {
        usingWeapon = false;
        useBtn.className = 'weapon-toggle-btn inactive';
        skipBtn.className = 'weapon-toggle-btn active';
        updatePlayerSide(); updateOutcome();
      });
      updatePlayerSide();
    } else {
      const sanityModBare2 = getSanityStrModifier();
      const { bonus: bareItemBonus, labels: bareItemLabels } = getItemBattleStrBonus(false, null, itemSlots);
      const bareStr = baseStr + bareItemBonus + tuskBonus + hiveMindBonus + sanityModBare2;
      const bareLabels = [
        ...bareItemLabels,
        tuskBonus?`+${tuskBonus} tusk`:'',
        hiveMindBonus?'+3 hive mind':'',
        sanityModBare2>0?`+${sanityModBare2} sanity${sanityModBare2===2?' (frenzy)':''}` : '',
        sanityModBare2<0?`${sanityModBare2} sanity`:'',
      ].filter(Boolean).join(' ');
      playerSide.innerHTML = `
        <span class="battle-stat-label">Your STR${bareLabels ? ' ' + bareLabels : ''}</span>
        <span class="battle-stat-value player-str">${bareStr}</span>`;
    }

    const outcomeEl = document.createElement('div');
    outcomeEl.className = 'battle-outcome';
    display.appendChild(outcomeEl);
    display.appendChild(bodyEl);

    function updateOutcome() {
      const usingMelee = usingWeapon && isMelee;
      const extraArmBonus = getExtraArmBonus(usingMelee);
      const { bonus: itemBonus } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
      const effStr = (usingWeapon ? baseStr + weaponStr : baseStr)
                   + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus;
      outcomeEl.className = 'battle-outcome';
      effectsEl.innerHTML = '';
      if (effStr > monsterStr) {
        outcomeEl.classList.add('outcome-win');
        outcomeEl.textContent = '⚔ Victory — monster slain, proceed to loot!';
        bodyEl.textContent = 'You finish the creature off.';
        btn.className = 'threat-continue-btn btn-gold';
      } else if (effStr === monsterStr) {
        outcomeEl.classList.add('outcome-tie');
        outcomeEl.textContent = '⚔ Tie — monster slain, but at a cost';
        bodyEl.textContent = 'You kill it, barely.';
        btn.className = 'threat-continue-btn btn-gold';
        if (inj.card.damage) {
          Object.entries(inj.card.damage).forEach(([k,v]) => {
            const p = document.createElement('div');
            p.textContent = `${EFFECT_META[k]?.icon ?? ''} ${k} ${v>0?'+':''}${v}`;
            effectsEl.appendChild(p);
          });
        }
      } else {
        outcomeEl.classList.add('outcome-loss');
        outcomeEl.textContent = '⚔ Defeat — monster holds the slot';
        bodyEl.textContent = 'The creature endures. The loot remains out of reach.';
        if (inj.card.damage) {
          Object.entries(inj.card.damage).forEach(([k,v]) => {
            const p = document.createElement('div');
            p.textContent = `${EFFECT_META[k]?.icon ?? ''} ${k} ${v>0?'+':''}${v}`;
            effectsEl.appendChild(p);
          });
        }
      }
    }
    updateOutcome();

    const handler = async () => {
      btn.removeEventListener('click', handler);
      const usingMelee = usingWeapon && isMelee;
      const extraArmBonus = getExtraArmBonus(usingMelee);
      const { bonus: itemBonus } = getItemBattleStrBonus(usingWeapon, weapon, itemSlots);
      const effStr = (usingWeapon ? baseStr + weaponStr : baseStr)
                   + itemBonus + tuskBonus + hiveMindBonus + extraArmBonus;

      if (usingWeapon && hasWeapon) {
        weaponUsesRemaining--;
        refreshWeaponZone();
      }

      if (effStr >= monsterStr) {
        // Win or tie — monster defeated
        injuredMonsters[slotIndex] = null;
        updateSlotCosts();
        if (effStr > monsterStr) {
          gameLog.add(`⚔ Victory vs ${inj.card.name} (injured, STR ${monsterStr}) — cleared`, 'good');
        } else {
          gameLog.add(`⚔ Tie vs ${inj.card.name} (injured, STR ${monsterStr}) — cleared, damage taken`, 'warn');
        }
        // Apply tie damage
        if (effStr === monsterStr && inj.card.damage) {
          await applyEffects(inj.card.damage);
          if (gameOver) { dialog.classList.remove('open'); resolve({ won: true }); return; }
        }
        // Matches
        const matchesIdx = itemSlots.findIndex(c => c?.name === 'Matches');
        if (matchesIdx >= 0) {
          const nf = Math.min(maxFood, playerState.food.value + 1);
          if (playerState.food.set) playerState.food.set(nf);
          showToast(`🔥 Matches — food +1 (${nf})`, false, 2000);
        }
        if (hasMutant('feral_instinct', mutantCards)) {
          const ff = Math.min(maxFood, playerState.food.value + 2);
          if (playerState.food.set) playerState.food.set(ff);
          showToast(`🧬 Feral instinct — food +2 (${ff})`, false, 2400);
        }
        dialog.classList.remove('open');
        resolve({ won: true });
      } else {
        // Another loss — reduce remaining strength further
        const newRemaining = monsterStr - effStr;
        injuredMonsters[slotIndex] = { ...inj, remainingStrength: newRemaining };
        updateSlotCosts();
        gameLog.add(`⚔ Defeat vs ${inj.card.name} (injured) — now STR ${newRemaining}`, 'warn');
        if (inj.card.damage) {
          await applyEffects(inj.card.damage);
          if (gameOver) { dialog.classList.remove('open'); resolve({ won: false }); return; }
        }
        dialog.classList.remove('open');
        resolve({ won: false });
      }
    };
    btn.addEventListener('click', handler);
  });
}

/* ── Draw & resolve N threat cards sequentially ── */
async function resolveThreatCards(count, slotIndex) {
  if (!count || count <= 0 || threatFull.length === 0) return { lootLost: false };

  const dialog   = document.getElementById('threat-dialog');
  const queueEl  = document.getElementById('threat-queue');

  // Build pip indicators
  queueEl.innerHTML = '';
  const dots = [];
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'threat-pip-indicator';
    queueEl.appendChild(dot);
    dots.push(dot);
  }

  dialog.classList.add('open');

  let lootLost = false;
  for (let i = 0; i < count; i++) {
    const card = drawThreatCard();
    if (!card) break;
    const result = await resolveThreatCard(card, queueEl, dots, i, slotIndex);
    if (gameOver) break;
    if (result?.lootLost) { lootLost = true; break; }
  }

  dialog.classList.remove('open');
  await drainMutantSpots(); // show mutation card picks immediately after all threats resolve
  return { lootLost };
}
