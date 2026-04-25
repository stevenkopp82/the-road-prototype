/**
 * game-draft.js — Deck loading, draft phase, starting gear, discard viewer
 *
 * Loaded before the main game.html inline script.
 * All state variables are declared with `var` so they are accessible
 * as window properties from the main script and other modules.
 *
 * Depends on: game-logic.js (shuffle, getDraftPick, getDraftDraw)
 * Requires these globals set by game.html at runtime:
 *   fullDeck, drawPile, discardPile, passStartDeckSize, gameDealCount,
 *   gameLog, renderCard, showMagnifier, hideMagnifier, updateDeckCount
 */

var sprawlPool = [];  // Sprawl cards, drawn from during draft
var hivePool   = [];  // Hive cards, drawn from during draft

async function loadDeck(dealCount = 40, excludeName = null) {
  const titleEl = document.getElementById('gather-board-title');
  try {
    const res = await fetch('data/loot-deck.json?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status} — is loot-deck.json in the data/ folder?`);
    const data = await res.json();
    if (!data.loot_deck || !Array.isArray(data.loot_deck)) throw new Error('Unexpected JSON structure');
    fullDeck = data.loot_deck;

    // Separate by location
    let roadCards = shuffle(fullDeck.filter(c => c.location === 'road'));
    sprawlPool    = shuffle(fullDeck.filter(c => c.location === 'sprawl'));
    hivePool      = shuffle(fullDeck.filter(c => c.location === 'hive'));

    // Remove starting gear card from road pool before dealing so draw pile is always full
    if (excludeName) {
      const idx = roadCards.findIndex(c => c.name === excludeName);
      if (idx >= 0) roadCards.splice(idx, 1);
    }

    // Deal N road cards to draw pile; the rest are permanently set aside
    drawPile          = roadCards.slice(0, dealCount);
    passStartDeckSize = drawPile.length;

    console.log(`✓ Deck: ${drawPile.length} road cards dealt, ${roadCards.length - drawPile.length} road set aside${excludeName ? ` (excluded: ${excludeName})` : ''}`);
    console.log(`✓ Sprawl pool: ${sprawlPool.length} | Hive pool: ${hivePool.length}`);
    updateDeckCount();
  } catch (e) {
    if (titleEl) { titleEl.textContent = `⚠ ${e.message}`; titleEl.style.color = '#c94040'; }
  }
}

/* ── Starting gear pick: show 3 random road items/weapons, player picks 1 ── */
function runStartingGearPick() {
  return new Promise(resolve => {
    // Pull 3 random item or weapon cards from the road portion of the full deck
    // (drawPile already sliced; sample from fullDeck road items/weapons instead,
    //  avoiding cards already in the draw pile by sampling from the full filtered pool)

    const eligible = shuffle(
      fullDeck.filter(c => c.location === 'road' && (c.type === 'item' || c.type === 'weapon'))
    ).slice(0, 3);

    if (eligible.length === 0) { resolve(null); return; }

    const dialog    = document.getElementById('starting-gear-dialog');
    const titleEl   = document.getElementById('sg-title');
    const subtitleEl= document.getElementById('sg-subtitle');
    const cardsEl   = document.getElementById('sg-cards');
    const confirmBtn= document.getElementById('sg-confirm-btn');

    titleEl.textContent    = '⚙ Starting Gear';
    subtitleEl.textContent = 'You scavenged something before setting out. Choose one to keep.';
    confirmBtn.disabled    = true;
    cardsEl.innerHTML      = '';
    // Dialog is already open from page load — no classList.add needed
    let chosen = null;

    const wraps = eligible.map((card) => {
      const wrap = document.createElement('div');
      wrap.className = 'draft-card-wrap';

      const check = document.createElement('div');
      check.className = 'draft-check';
      check.textContent = '✓';
      wrap.appendChild(check);
      wrap.appendChild(renderCard(card));
      wrap.addEventListener('mouseenter', () => showMagnifier(card, wrap));
      wrap.addEventListener('mouseleave', hideMagnifier);

      wrap.addEventListener('click', () => {
        // Deselect all, select this one
        wraps.forEach(w => w.classList.remove('draft-selected'));
        wrap.classList.add('draft-selected');
        chosen = card;
        confirmBtn.disabled = false;
      });

      cardsEl.appendChild(wrap);
      return wrap;
    });

    confirmBtn.onclick = () => {
      dialog.classList.remove('open');
      resolve(chosen);
    };
  });
}

/* ── Draft phase: pick (dealCount/5) from pool, pool size = pick+3 ── */
function runDraftPhase(pool, locationName) {
  return new Promise(resolve => {
    if (pool.length === 0) { resolve([]); return; }

    const DRAFT_PICK = getDraftPick(gameDealCount);
    const DRAFT_DRAW = getDraftDraw(gameDealCount);

    // Draw up to DRAFT_DRAW from pool
    const drawn = pool.splice(0, Math.min(DRAFT_DRAW, pool.length));
    const selected = new Set();

    const dialog    = document.getElementById('draft-dialog');
    const titleEl   = document.getElementById('draft-title');
    const subtitleEl= document.getElementById('draft-subtitle');
    const progressEl= document.getElementById('draft-progress');
    const cardsEl   = document.getElementById('draft-cards');
    const confirmBtn= document.getElementById('draft-confirm-btn');

    titleEl.textContent    = `📦 Entering ${locationName} — Choose Your Supplies`;
    subtitleEl.textContent = `Select ${DRAFT_PICK} cards to add to your deck. The rest return to the pool.`;
    progressEl.textContent = `0 / ${DRAFT_PICK} selected`;
    confirmBtn.disabled    = true;
    cardsEl.innerHTML      = '';

    const wraps = drawn.map((card, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'draft-card-wrap';

      const check = document.createElement('div');
      check.className = 'draft-check';
      check.textContent = '✓';
      wrap.appendChild(check);
      wrap.appendChild(renderCard(card));
      wrap.addEventListener('mouseenter', () => showMagnifier(card, wrap));
      wrap.addEventListener('mouseleave', hideMagnifier);

      wrap.addEventListener('click', () => {
        if (selected.has(i)) {
          selected.delete(i);
          wrap.classList.remove('draft-selected');
        } else {
          if (selected.size >= DRAFT_PICK) return;
          selected.add(i);
          wrap.classList.add('draft-selected');
        }
        // Disable unselected cards once limit reached
        const full = selected.size >= DRAFT_PICK;
        wraps.forEach((w, j) => {
          if (!selected.has(j)) w.classList.toggle('draft-disabled', full);
        });
        progressEl.textContent = `${selected.size} / ${DRAFT_PICK} selected`;
        confirmBtn.disabled = selected.size < DRAFT_PICK;
      });

      cardsEl.appendChild(wrap);
      return wrap;
    });

    dialog.classList.add('open');

    confirmBtn.onclick = () => {
      dialog.classList.remove('open');
      const picked = drawn.filter((_, i) => selected.has(i));
      const returned = drawn.filter((_, i) => !selected.has(i));
      // Return unkept cards to the pool (back of pool, order doesn't matter)
      returned.forEach(c => pool.push(c));
      gameLog.add(`📦 Draft: kept ${picked.map(c => c.name).join(', ')}`, 'gold');
      resolve(picked);
    };
  });
}

/* ── Discard pile viewer ── */
var dvActiveFilter = 'all';

function openDiscardViewer() {
  renderDiscardViewer();
  document.getElementById('discard-viewer').classList.add('open');
}

function renderDiscardViewer() {
  const pile = [...discardPile].reverse(); // most recent first
  const filtered = dvActiveFilter === 'all'
    ? pile
    : pile.filter(c => c.type === dvActiveFilter);

  document.getElementById('dv-count').textContent =
    `${discardPile.length} card${discardPile.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('dv-grid');
  grid.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dv-empty';
    empty.textContent = discardPile.length === 0
      ? 'The discard pile is empty.'
      : 'No cards of this type in the discard pile.';
    grid.appendChild(empty);
    return;
  }

  filtered.forEach(card => {
    const wrap = document.createElement('div');
    wrap.className = 'dv-card-wrap';
    wrap.appendChild(renderCard(card));
    grid.appendChild(wrap);
  });
}
