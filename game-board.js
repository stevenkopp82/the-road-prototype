/**
 * game-board.js — Player board track rendering (buildTrack and helpers)
 *
 * Loaded before the main game.html inline script.
 * Functions reference globals lazily — safe to load in <head>.
 *
 * Depends on: game-inventory.js (renderItemSlots)
 * Requires globals from game.html: playerState, updateStatsPill,
 *   _pendingMutantSpots
 */

const SPACES = 10;

function getStrength(health) {
  if (health === 10) return 3;
  if (health >= 7)   return 2;
  if (health > 2)    return 1;
  return 0;
}

function getBand(health) {
  if (health === 10) return 3;
  if (health >= 7)   return 2;
  if (health > 2)    return 1;
  return 0;
}

function buildStatSidebar(wrapper, statId, label, getCellConfig) {
  const group = document.createElement('div');
  group.className = 'track-group';
  group.appendChild(wrapper);

  const sidebar = document.createElement('div');
  sidebar.className = 'stat-sidebar';

  const spacer = document.createElement('div');
  spacer.className = 'stat-spacer';
  sidebar.appendChild(spacer);

  const hdr = document.createElement('div');
  hdr.className = 'stat-header';
  hdr.textContent = label;
  sidebar.appendChild(hdr);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'stat-cells';

  const statCells = [];
  let prevBand = null;
  for (let i = SPACES; i >= 0; i--) {
    const { val, band, isSkull, isFrenzy } = getCellConfig(i);
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    cell.setAttribute('data-stat-id', statId);
    cell.setAttribute('data-val', val);
    if (band !== prevBand) { cell.classList.add('band-start'); prevBand = band; }
    if (isSkull)  cell.classList.add('skull-row');
    if (isFrenzy) cell.classList.add('frenzy');
    if (!isSkull) {
      const span = document.createElement('span');
      span.className = 'stat-value';
      span.textContent = val;
      cell.appendChild(span);
    }
    statCells.push({ el: cell, trackVal: i });
    cellsEl.appendChild(cell);
  }

  sidebar.appendChild(cellsEl);
  group.appendChild(sidebar);

  return {
    group,
    renderStat(trackVal) {
      statCells.forEach(({ el, trackVal: tv }) => el.classList.toggle('active-stat', tv === trackVal));
    }
  };
}

function buildTrack(track) {
  const state = { value: track.defaultValue };

  // Register the setter in playerState so gather board can apply effects
  playerState[track.id].value = state.value;
  playerState[track.id].set = (newVal) => {
    const prevVal = state.value;
    state.value = newVal;
    playerState[track.id].value = newVal;
    render();
    // Refresh item action buttons when food changes
    if (track.id === 'food') renderItemSlots();
    updateStatsPill();
    // Track mutation thresholds crossed — game flow awaits these via drainMutantSpots()
    if (track.id === 'mutation') {
      const MUTATION_CARDS_SET = new Set([3, 5, 8]);
      const lo = Math.min(prevVal, newVal), hi = Math.max(prevVal, newVal);
      for (const spot of MUTATION_CARDS_SET) {
        if (spot > lo && spot <= hi && newVal > prevVal) {
          _pendingMutantSpots++;
          break; // one card per move
        }
      }
    }
    saveGameState?.();
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'track-wrapper';
  wrapper.setAttribute('data-track', track.id);

  const labelTop = document.createElement('div');
  labelTop.className = 'track-label';
  labelTop.innerHTML = `<span class="track-icon">${track.icon}</span>`;
  wrapper.appendChild(labelTop);

  const isMutation = track.id === 'mutation';
  const MUTATION_SKULL = 10;
  const MUTATION_CARDS = new Set([3, 5, 8]);

  const trackEl = document.createElement('div');
  trackEl.className = 'track';

  const displayOrder = [];
  if (isMutation) { for (let i = 0; i <= SPACES; i++) displayOrder.push(i); }
  else            { for (let i = SPACES; i >= 0; i--) displayOrder.push(i); }

  const spaces = [];
  for (const i of displayOrder) {
    const isSkull = isMutation ? (i === MUTATION_SKULL) : (i === 0);
    const isCard  = isMutation && MUTATION_CARDS.has(i);
    const isFoodLocked = (track.id === 'food') && (i === 9 || i === 10);

    const space = document.createElement('div');
    space.className = 'track-space' + (isSkull ? ' skull-space' : '') + (isCard ? ' card-space' : '') + (isFoodLocked ? ' food-locked' : '');
    if (track.id === 'food') space.setAttribute('data-food-val', i);

    if (isFoodLocked) {
      // Locked food slots — show backpack icon
      const lockEl = document.createElement('span');
      lockEl.className = 'food-lock-icon';
      lockEl.textContent = '🎒';
      lockEl.title = 'Requires Backpack to unlock';
      space.appendChild(lockEl);
      // Show number dimly underneath
      const num = document.createElement('span');
      num.className = 'space-num';
      num.textContent = i;
      space.appendChild(num);
    } else if (isSkull) {
      const skull = document.createElement('span');
      skull.className = 'skull-icon';
      // Food track skull: show what happens at 0 (starvation = health + sanity loss)
      if (track.id === 'food') {
        skull.innerHTML = '<span>🩸</span><span>🕯️</span>';
        skull.title = 'Starvation: −1 health, −1 sanity';
      } else {
        skull.textContent = '☠';
      }
      space.appendChild(skull);
    } else {
      const num = document.createElement('span');
      num.className = 'space-num';
      num.textContent = i;
      space.appendChild(num);
    }

    if (isCard) {
      const cardEl = document.createElement('span');
      cardEl.className = 'card-icon';
      cardEl.textContent = '🃏';
      space.appendChild(cardEl);
    }

    // Track spaces are read-only — stat changes are driven by game logic only
    spaces.push({ el: space, val: i, isFoodLocked });
    trackEl.appendChild(space);
  }

  wrapper.appendChild(trackEl);

  const labelBottom = document.createElement('div');
  labelBottom.className = 'track-label';
  labelBottom.textContent = track.label;
  wrapper.appendChild(labelBottom);

  const marker = document.createElement('div');
  marker.className = 'marker';

  let renderStrength = () => {};
  let renderSpeed    = () => {};

  function render() {
    spaces.forEach(({ el, val }) => {
      const active = val === state.value;
      el.classList.toggle('has-marker', active);
      if (active) el.appendChild(marker);
      // Starving pulse: food skull-space (val 0) pulses red when food is 0
      if (track.id === 'food' && val === 0) {
        el.classList.toggle('starving', state.value === 0);
      }
    });
    if (track.id === 'health') renderStrength(state.value);
    if (track.id === 'sanity') renderSpeed(state.value);
  }

  render();

  if (track.id === 'health') {
    const group = document.createElement('div');
    group.className = 'health-track-group';
    group.appendChild(wrapper);

    const sidebar = document.createElement('div');
    sidebar.className = 'strength-sidebar';
    const spacer = document.createElement('div');
    spacer.className = 'strength-spacer';
    sidebar.appendChild(spacer);
    const hdr = document.createElement('div');
    hdr.className = 'strength-header';
    hdr.textContent = 'STR';
    sidebar.appendChild(hdr);
    const cellsEl = document.createElement('div');
    cellsEl.className = 'strength-cells';
    const strCells = [];
    for (let i = SPACES; i >= 0; i--) {
      const cell = document.createElement('div');
      cell.className = 'strength-cell';
      const str = getStrength(i);
      cell.setAttribute('data-str', str);
      const bandAbove = (i < SPACES) ? getBand(i + 1) : -1;
      if (getBand(i) !== bandAbove) cell.classList.add('band-start');
      if (i === 0) {
        cell.classList.add('skull-row');
      } else {
        const v = document.createElement('span');
        v.className = 'str-value';
        v.textContent = str;
        cell.appendChild(v);
      }
      strCells.push({ el: cell, health: i });
      cellsEl.appendChild(cell);
    }
    sidebar.appendChild(cellsEl);
    group.appendChild(sidebar);
    renderStrength = function(healthVal) {
      strCells.forEach(({ el, health }) => el.classList.toggle('active-str', health === healthVal));
    };
    renderStrength(state.value);
    return group;
  }

  if (track.id === 'sanity') {
    function getSanityBand(s) {
      if (s === 1) return 'frenzy';
      if (s === 2) return 'low-1';
      if (s >= 8)  return 'high+1';
      return 'mid0';
    }
    function getSanityStrVal(s) {
      if (s === 1) return '+2';
      if (s === 2) return '−1';
      if (s >= 8)  return '+1';
      return '0';
    }

    // STR modifier sidebar — Sanity modifies combat STR
    const { group: strModGroup, renderStat: renderStrMod } = buildStatSidebar(wrapper, 'str-mod', 'STR', (i) => ({
      val:      getSanityStrVal(i),
      band:     getSanityBand(i),
      isSkull:  i === 0,
      isFrenzy: getSanityBand(i) === 'frenzy',
    }));

    renderSpeed = (v) => renderStrMod(v);
    renderSpeed(state.value);
    return strModGroup;
  }

  return wrapper;
}
