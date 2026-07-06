const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { getSettings } = require('./settings');
const { addSanction } = require('./sanctions');
const { isBotAdminMember } = require('./permissions');
const { parseDuration, formatDuration } = require('./utils');
const { sendLog, userAuthor, idLine } = require('./logs');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 28 * DAY_MS; // limite Discord des timeouts

const countWarnsStmt = db.prepare(
  "SELECT COUNT(*) AS c FROM sanctions WHERE guild_id = ? AND user_id = ? AND type = 'warn' AND created_at >= ?",
);

async function logStrike(guild, user, action, count, windowDays) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor(userAuthor(user))
    .setDescription([
      `📈 **${action}** (sanction par paliers)`,
      `**Déclencheur :** ${count} warns en ${windowDays} jours`,
      idLine(user),
    ].join('\n'))
    .setTimestamp();
  await sendLog(guild, 'mod', embed);
}

// Appelé après chaque warn enregistré (manuel ou automod) : applique le palier
// atteint. Retourne un court texte descriptif si une sanction est tombée, sinon null.
async function checkStrikes(guild, member) {
  const { strikes, dmOnSanction } = getSettings(guild.id).moderationConfig;
  if (!strikes.enabled || !member || member.user.bot) return null;
  if (isBotAdminMember(member)) return null; // owner et admins du bot hors paliers

  const count = countWarnsStmt.get(guild.id, member.id, Date.now() - strikes.windowDays * DAY_MS).c;
  if (count < strikes.muteThreshold) return null;

  const botId = guild.client.user.id;

  // Palier final : ban définitif (MP envoyé avant, impossible après)
  if (count >= strikes.banThreshold) {
    if (!member.bannable) return null;
    const reason = `Palier atteint : ${count} warns en ${strikes.windowDays} jours → ban`;
    if (dmOnSanction) {
      await member.send(`📈 Tu as atteint **${count} avertissements en ${strikes.windowDays} jours** sur **${guild.name}** : tu es banni définitivement.`).catch(() => {});
    }
    const banned = await member.ban({ reason }).then(() => true).catch(() => false);
    if (!banned) return null;
    addSanction({ guildId: guild.id, userId: member.id, moderatorId: botId, type: 'ban', reason });
    await logStrike(guild, member.user, 'Ban automatique', count, strikes.windowDays);
    return `⛔ **Palier atteint** (${count} warns en ${strikes.windowDays} jours) → **ban automatique**`;
  }

  // Palier intermédiaire : mute — chaque warn supplémentaire remet un mute complet
  if (!member.moderatable) return null;
  const duration = Math.min(parseDuration(strikes.muteDuration) ?? DAY_MS, MAX_TIMEOUT_MS);
  const reason = `Palier atteint : ${count} warns en ${strikes.windowDays} jours → mute ${formatDuration(duration)}`;
  const muted = await member.timeout(duration, reason).then(() => true).catch(() => false);
  if (!muted) return null;
  addSanction({ guildId: guild.id, userId: member.id, moderatorId: botId, type: 'mute', reason, expiresAt: Date.now() + duration });
  if (dmOnSanction) {
    await member.send(`📈 Tu as atteint **${count} avertissements en ${strikes.windowDays} jours** sur **${guild.name}** : mute automatique de ${formatDuration(duration)}.`).catch(() => {});
  }
  await logStrike(guild, member.user, `Mute automatique ${formatDuration(duration)}`, count, strikes.windowDays);
  return `🔇 **Palier atteint** (${count} warns en ${strikes.windowDays} jours) → **mute automatique ${formatDuration(duration)}**`;
}

module.exports = { checkStrikes };
