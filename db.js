// db.js — Thin wrappers around Firebase Realtime Database
// All multiplayer code calls these functions; never calls firebase.database() directly.
// Safe to load on pages that don't use multiplayer — all functions are no-ops if RTDB is unavailable.

let _rtdb = null;

function initRTDB() {
  try {
    // firebase-config.js must be loaded first and must include databaseURL
    if (typeof firebase !== 'undefined' && firebaseConfig.databaseURL) {
      // Re-use the existing Firebase app if already initialized
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
      _rtdb = firebase.database(app);
    } else {
      console.warn('[db.js] databaseURL missing from firebaseConfig — multiplayer unavailable.');
    }
  } catch (e) {
    console.warn('[db.js] RTDB init failed:', e);
  }
}

// Call once on page load
initRTDB();

// ─── Core helpers ────────────────────────────────────────────────────────────

/** Write (set) a value at a path. Returns a Promise. */
function dbSet(path, value) {
  if (!_rtdb) return Promise.resolve();
  return _rtdb.ref(path).set(value).catch(e => console.warn('[db] set failed', path, e));
}

/** Merge (update) fields at a path. Returns a Promise. */
function dbUpdate(path, updates) {
  if (!_rtdb) return Promise.resolve();
  return _rtdb.ref(path).update(updates).catch(e => console.warn('[db] update failed', path, e));
}

/** Read a path once. Returns a Promise resolving to the value (or null). */
function dbGet(path) {
  if (!_rtdb) return Promise.resolve(null);
  return _rtdb.ref(path).get()
    .then(snap => snap.exists() ? snap.val() : null)
    .catch(e => { console.warn('[db] get failed', path, e); return null; });
}

/** Push a new child under a path (auto-generates key). Returns a Promise resolving to the new key. */
function dbPush(path, value) {
  if (!_rtdb) return Promise.resolve(null);
  const ref = _rtdb.ref(path).push();
  return ref.set(value)
    .then(() => ref.key)
    .catch(e => { console.warn('[db] push failed', path, e); return null; });
}

/** Remove a path. Returns a Promise. */
function dbRemove(path) {
  if (!_rtdb) return Promise.resolve();
  return _rtdb.ref(path).remove().catch(e => console.warn('[db] remove failed', path, e));
}

/**
 * Subscribe to a path. Calls callback(value) immediately and on every change.
 * Returns an unsubscribe function — call it to stop listening.
 */
function dbListen(path, callback) {
  if (!_rtdb) return () => {};
  const ref = _rtdb.ref(path);
  const handler = snap => callback(snap.exists() ? snap.val() : null);
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

/**
 * Subscribe only to child additions under a path.
 * Calls callback(childKey, childValue) for each new child.
 * Returns an unsubscribe function.
 */
function dbListenChildAdded(path, callback) {
  if (!_rtdb) return () => {};
  const ref = _rtdb.ref(path);
  const handler = snap => callback(snap.key, snap.val());
  ref.on('child_added', handler);
  return () => ref.off('child_added', handler);
}

// ─── Game-path helpers ────────────────────────────────────────────────────────
// Convenience functions so callers don't construct paths by hand.

function gamePath(gameCode)               { return `games/${gameCode}`; }
function metaPath(gameCode)               { return `games/${gameCode}/meta`; }
function playersPath(gameCode)            { return `games/${gameCode}/players`; }
function playerPath(gameCode, playerId)   { return `games/${gameCode}/players/${playerId}`; }
function sharedStatePath(gameCode)        { return `games/${gameCode}/sharedState`; }
function roundPath(gameCode)              { return `games/${gameCode}/round`; }
function logPath(gameCode)                { return `games/${gameCode}/log`; }
function shareRequestsPath(gameCode)      { return `games/${gameCode}/shareRequests`; }
function shareRequestPath(gameCode, toId) { return `games/${gameCode}/shareRequests/${toId}`; }

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Generate a random 6-character uppercase alphanumeric game code. */
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Generate a random UUID-style player ID. */
function generatePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}
