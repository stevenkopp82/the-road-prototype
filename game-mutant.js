/**
 * game-mutant.js — Mutant deck: loading, drawing, rendering, pick dialog
 *
 * Loaded before the main game.html inline script.
 * All state variables are declared with `var` so they are accessible
 * as window properties from the main script and other modules.
 *
 * Depends on: game-logic.js (shuffle)
 * Requires these globals set by game.html at runtime:
 *   mutantFull, mutantPile, mutantCards, _pendingMutantSpots, mutantResolve
 *   renderCard, showMagnifier, hideMagnifier, createIconEl,
 *   updateSlotCosts
 */

/* ═══════════════════════════════════════════
   MUTANT DECK
═══════════════════════════════════════════ */
var mutantFull  = [];
var mutantPile  = [];
var mutantCards = []; // cards the player currently holds
var _pendingMutantSpots = 0; // count of mutation thresholds crossed, awaited by game flow

async function loadMutantDeck() {
  try {
    const res  = await fetch('mutant-deck.json?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mutantFull = data.mutant_deck;
    mutantPile = shuffle([...mutantFull]);
    console.log(`✓ Loaded ${mutantFull.length} mutant cards`);
  } catch (e) {
    console.warn('Could not load mutant-deck.json:', e.message);
  }
}

function drawMutantCard() {
  if (mutantPile.length === 0) mutantPile = shuffle([...mutantFull]);
  return mutantPile.splice(0, 1)[0] ?? null;
}

function renderMutantPanel() {
  const panel = document.getElementById('mutant-cards-panel');
  const container = document.getElementById('mutant-tags-container');
  container.innerHTML = '';
  if (mutantCards.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  mutantCards.forEach(c => {
    // Render as a loot-style card by building a synthetic card object
    const synth = {
      name: c.name,
      type: 'mutant',
      icon: c.icon ?? '🧬',
      effects: {},
      text: c.text,
    };
    const cardEl = renderCard(synth);
    cardEl.addEventListener('mouseenter', () => showMagnifier(synth, cardEl));
    cardEl.addEventListener('mouseleave', hideMagnifier);
    container.appendChild(cardEl);
  });
}

/* ── Show mutant card choice dialog (draw 2, pick 1) ── */
var mutantResolve = null;

function buildMutantCardEl(card) {
  const wrap = document.createElement('div');
  wrap.className = 'mutant-choice-card';

  const nameEl = document.createElement('div');
  nameEl.className = 'mutant-card-name';
  nameEl.textContent = card.name;
  wrap.appendChild(nameEl);

  if (card.icon) wrap.appendChild(createIconEl(card.icon, card.name, 'mutant-card-icon'));

  const effEl = document.createElement('div');
  effEl.className = 'mutant-card-effect';
  effEl.textContent = card.text;
  wrap.appendChild(effEl);

  const btn = document.createElement('button');
  btn.className = 'mutant-choose-btn';
  btn.textContent = 'Choose';
  wrap.appendChild(btn);

  return { wrap, btn };
}

function promptMutantChoice(cardA, cardB) {
  return new Promise(resolve => {
    mutantResolve = resolve;
    const row = document.getElementById('mutant-choice-row');
    row.innerHTML = '';

    const { wrap: wrapA, btn: btnA } = buildMutantCardEl(cardA);
    const { wrap: wrapB, btn: btnB } = buildMutantCardEl(cardB);

    btnA.addEventListener('click', () => {
      document.getElementById('mutant-dialog').classList.remove('open');
      if (mutantResolve) { mutantResolve(cardA); mutantResolve = null; }
    });
    btnB.addEventListener('click', () => {
      document.getElementById('mutant-dialog').classList.remove('open');
      if (mutantResolve) { mutantResolve(cardB); mutantResolve = null; }
    });

    // Clicking the card itself also chooses it
    wrapA.addEventListener('click', e => { if (e.target !== btnA) btnA.click(); });
    wrapB.addEventListener('click', e => { if (e.target !== btnB) btnB.click(); });

    row.appendChild(wrapA);
    row.appendChild(wrapB);
    document.getElementById('mutant-dialog').classList.add('open');
  });
}

/* ── Called when mutation track marker lands on a card-spot ── */
async function onMutantCardSpot() {
  const cardA = drawMutantCard();
  if (!cardA) return;
  const cardB = drawMutantCard();
  if (!cardB) {
    // Fallback: only one card available — auto-accept it
    mutantCards.push(cardA);
    renderMutantPanel();
    updateSlotCosts();
    return;
  }
  const chosen = await promptMutantChoice(cardA, cardB);
  const rejected = chosen === cardA ? cardB : cardA;
  mutantCards.push(chosen);
  // Return the rejected card to the pile (shuffled back in)
  mutantPile.push(rejected);
  mutantPile = shuffle(mutantPile);
  renderMutantPanel();
  // Refresh board costs — some mutations affect slot costs (e.g. future_flicker)
  updateSlotCosts();
}

/* Await all pending mutation card picks before continuing game flow */
async function drainMutantSpots() {
  while (_pendingMutantSpots > 0) {
    _pendingMutantSpots--;
    await onMutantCardSpot();
  }
}
