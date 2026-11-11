'use strict';

/* Account lifecycle: expiry and bans.
 *
 * A user whose validity window has passed becomes "expired": login is
 * refused and every server they own is stopped. The hourly sweeper calls
 * applyExpiry for everyone; login and server power actions call it for
 * the acting user so expiry takes effect immediately.
 */

function isPastExpiry(user, now = Date.now()) {
  if (!user || user.is_admin || !user.expires_at) return false;
  return now >= new Date(user.expires_at).getTime();
}

/** If the user has silently expired, flip their status and stop their
 *  servers. Returns true when the user is expired after this check. */
function applyExpiry(store, engine, user) {
  if (!user) return false;
  if (user.status === 'active' && isPastExpiry(user)) {
    user.status = 'expired';
    store.save();
    for (const server of store.serversOfUser(user.id)) {
      engine.stopServer(server.identifier, 'stopped by system').catch(() => {});
    }
    return true;
  }
  return user.status === 'expired';
}

/** Stop everything a user owns (used on ban / delete). */
function stopAllUserServers(store, engine, userId) {
  for (const server of store.serversOfUser(userId)) {
    engine.stopServer(server.identifier, 'account disabled').catch(() => {});
  }
}

/** Run the expiry check across all users. Returns how many expired. */
function sweepExpired(store, engine) {
  let count = 0;
  for (const user of store.db.users) {
    const wasActive = user.status === 'active';
    if (applyExpiry(store, engine, user) && wasActive) count++;
  }
  return count;
}

module.exports = { isPastExpiry, applyExpiry, stopAllUserServers, sweepExpired };
