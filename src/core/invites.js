const db = require('./db');
const { isModuleEnabled } = require('./settings');

const upsertStmt = db.prepare(`
  INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, fake, has_left, joined_at)
  VALUES (?, ?, ?, ?, ?, 0, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET
    inviter_id = excluded.inviter_id, code = excluded.code,
    fake = excluded.fake, has_left = 0, joined_at = excluded.joined_at
`);
const byUserStmt = db.prepare('SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ?');
const markLeftStmt = db.prepare('UPDATE invite_joins SET has_left = 1 WHERE guild_id = ? AND user_id = ?');
const statsStmt = db.prepare(`
  SELECT
    SUM(CASE WHEN has_left = 0 AND fake = 0 THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN has_left = 1 THEN 1 ELSE 0 END) AS leaves,
    SUM(CASE WHEN has_left = 0 AND fake = 1 THEN 1 ELSE 0 END) AS fakes
  FROM invite_joins WHERE guild_id = ? AND inviter_id = ?
`);
const leaderboardStmt = db.prepare(`
  SELECT inviter_id,
    SUM(CASE WHEN has_left = 0 AND fake = 0 THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN has_left = 1 THEN 1 ELSE 0 END) AS leaves,
    SUM(CASE WHEN has_left = 0 AND fake = 1 THEN 1 ELSE 0 END) AS fakes
  FROM invite_joins
  WHERE guild_id = ? AND inviter_id IS NOT NULL
  GROUP BY inviter_id
  HAVING active > 0 OR leaves > 0 OR fakes > 0
  ORDER BY active DESC
  LIMIT 10
`);

// Cache des utilisations d'invitations, pour détecter laquelle a servi à un join
const invitesCache = new Map(); // guildId → Map(code → uses)

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    invitesCache.set(guild.id, new Map(invites.map((i) => [i.code, i.uses ?? 0])));
  } catch {
    invitesCache.set(guild.id, new Map());
  }
}

async function initInvites(client) {
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
}

function onInviteCreate(invite) {
  if (!invite.guild) return;
  const cache = invitesCache.get(invite.guild.id);
  if (cache) cache.set(invite.code, invite.uses ?? 0);
}

function onInviteDelete(invite) {
  if (!invite.guild) return;
  invitesCache.get(invite.guild.id)?.delete(invite.code);
}

function getStats(guildId, userId) {
  const row = statsStmt.get(guildId, userId);
  return { active: row?.active ?? 0, leaves: row?.leaves ?? 0, fakes: row?.fakes ?? 0 };
}

// À l'arrivée d'un membre : détermine l'invitation utilisée et enregistre le lien
async function recordJoin(member) {
  if (!isModuleEnabled(member.guild.id, 'invites')) return null;

  const before = invitesCache.get(member.guild.id) ?? new Map();
  let usedInvite = null;
  try {
    const invites = await member.guild.invites.fetch();
    for (const invite of invites.values()) {
      if ((invite.uses ?? 0) > (before.get(invite.code) ?? 0)) {
        usedInvite = invite;
        break;
      }
    }
    invitesCache.set(member.guild.id, new Map(invites.map((i) => [i.code, i.uses ?? 0])));
  } catch {
    return null; // permission Gérer le serveur manquante
  }

  const inviterId = usedInvite?.inviterId ?? usedInvite?.inviter?.id ?? null;
  const fake = Date.now() - member.user.createdTimestamp < 7 * 86_400_000 ? 1 : 0;
  upsertStmt.run(member.guild.id, member.id, inviterId, usedInvite?.code ?? null, fake, Date.now());

  if (!inviterId) return null;
  return { inviterId, code: usedInvite.code, fake: Boolean(fake), stats: getStats(member.guild.id, inviterId) };
}

// Au départ d'un membre : marque le join comme parti et retourne l'inviteur impacté
function recordLeave(member) {
  if (!isModuleEnabled(member.guild.id, 'invites')) return null;
  const row = byUserStmt.get(member.guild.id, member.id);
  if (!row || row.has_left) return null;
  markLeftStmt.run(member.guild.id, member.id);
  if (!row.inviter_id) return null;
  return { inviterId: row.inviter_id, stats: getStats(member.guild.id, row.inviter_id) };
}

function leaderboard(guildId) {
  return leaderboardStmt.all(guildId);
}

module.exports = {
  initInvites,
  cacheGuildInvites,
  onInviteCreate,
  onInviteDelete,
  recordJoin,
  recordLeave,
  getStats,
  leaderboard,
};
