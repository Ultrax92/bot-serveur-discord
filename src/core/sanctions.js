const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO sanctions (guild_id, user_id, moderator_id, type, reason, created_at, expires_at)
  VALUES (@guildId, @userId, @moderatorId, @type, @reason, @createdAt, @expiresAt)
`);

function addSanction({ guildId, userId, moderatorId, type, reason = null, expiresAt = null }) {
  const info = insertStmt.run({ guildId, userId, moderatorId, type, reason, createdAt: Date.now(), expiresAt });
  return info.lastInsertRowid;
}

function getSanctions(guildId, userId) {
  return db.prepare('SELECT * FROM sanctions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(guildId, userId);
}

function deleteSanction(guildId, sanctionId) {
  return db.prepare('DELETE FROM sanctions WHERE guild_id = ? AND id = ?').run(guildId, sanctionId).changes > 0;
}

function clearSanctions(guildId, userId) {
  return db.prepare('DELETE FROM sanctions WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes;
}

function getExpiredActive(now = Date.now()) {
  return db.prepare('SELECT * FROM sanctions WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?').all(now);
}

function deactivateSanction(id) {
  db.prepare('UPDATE sanctions SET active = 0 WHERE id = ?').run(id);
}

// Worker : lève les tempbans expirés (les mutes utilisent le timeout Discord, qui expire tout seul)
function startExpiryWorker(client) {
  setInterval(async () => {
    for (const sanction of getExpiredActive()) {
      deactivateSanction(sanction.id);
      if (sanction.type !== 'ban') continue;
      try {
        const guild = client.guilds.cache.get(sanction.guild_id);
        if (guild) await guild.bans.remove(sanction.user_id, 'Fin du bannissement temporaire');
      } catch (error) {
        // Déjà débanni à la main, ou permissions retirées : on ignore
      }
    }
  }, 30_000);
}

module.exports = { addSanction, getSanctions, deleteSanction, clearSanctions, startExpiryWorker };
