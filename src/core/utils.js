const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getSettings } = require('./settings');

// Parse une durée du type "1j2h30m", "45m", "2h", "7d" → millisecondes (null si invalide)
function parseDuration(input) {
  if (!input) return null;
  const regex = /(\d+)\s*(j|d|h|m|s)/gi;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of input.matchAll(regex)) {
    matched = true;
    const n = parseInt(amount, 10);
    switch (unit.toLowerCase()) {
      case 'j':
      case 'd':
        total += n * 86_400_000;
        break;
      case 'h':
        total += n * 3_600_000;
        break;
      case 'm':
        total += n * 60_000;
        break;
      case 's':
        total += n * 1_000;
        break;
    }
  }
  return matched && total > 0 ? total : null;
}

function formatDuration(ms) {
  const parts = [];
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000) % 24;
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1_000) % 60;
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds && !days && !hours) parts.push(`${seconds}s`);
  return parts.join(' ') || '0s';
}

// `source` : un guildId (string) ou une interaction. Avec une interaction,
// l'embed est signé en footer par l'avatar + pseudo de son auteur.
function baseEmbed(source) {
  const guildId = typeof source === 'string' ? source : source.guildId;
  const embed = new EmbedBuilder().setColor(getSettings(guildId).color).setTimestamp();
  if (typeof source !== 'string' && source.user) {
    embed.setFooter({ text: source.user.username, iconURL: source.user.displayAvatarURL() });
  }
  return embed;
}

function successEmbed(source, description) {
  return baseEmbed(source).setDescription(`✅ ${description}`);
}

function errorEmbed(source, description) {
  return baseEmbed(source).setColor(0xed4245).setDescription(`❌ ${description}`);
}

// Seules protections : le owner (serveur + .env), le bot lui-même, et les rôles au-dessus
// du bot (limite imposée par Discord). Les admins du bot peuvent agir entre eux.
// `needsBotAbove: false` pour les actions sans opération Discord (ex: warn, simple
// écriture en base) : la position du rôle du bot n'a alors aucune importance.
function checkHierarchy(interaction, targetMember, { needsBotAbove = true } = {}) {
  const { isOwner } = require('./permissions');
  if (!targetMember) return null;
  if (targetMember.id === interaction.guild.ownerId || isOwner(targetMember.id))
    return "Impossible d'agir sur le propriétaire.";
  if (targetMember.id === interaction.client.user.id) return 'Je ne peux pas agir sur moi-même.';
  if (needsBotAbove && targetMember.roles.highest.position >= interaction.guild.members.me.roles.highest.position)
    return 'Ce membre a un rôle supérieur ou égal au mien, je ne peux pas agir sur lui. Monte mon rôle dans la hiérarchie.';
  return null;
}

// Extrait un ID Discord d'une saisie libre : ID brut, mention <#id>/<@id>, ou lien.
// Prend le DERNIER id trouvé : dans un lien discord.com/channels/serveur/salon,
// c'est le salon qui nous intéresse, pas le serveur.
function extractId(input) {
  const matches = String(input ?? '').match(/\d{15,20}/g);
  return matches ? matches[matches.length - 1] : null;
}

// Verrouille (restrict=true) ou déverrouille/affiche (false) un salon en tenant
// compte des rôles ayant un allow explicite : sans ça, un rôle « membre »/« client »
// autorisé écraserait le deny de @everyone et la restriction n'aurait aucun effet
// (cas typique des salons vocaux temporaires).
// Au verrouillage : @everyone passe en deny, et les rôles qui AUTORISAIENT la perm
// sont neutralisés (allow → null) pour hériter de ce deny. On ne force jamais de deny
// sur un rôle, donc un rôle « Muet » (deny volontaire) n'est jamais touché.
// Au déverrouillage : rétablir @everyone (null) suffit, les rôles neutralisés
// héritent de l'ouverture. Les overwrites de MEMBRES ne sont jamais modifiés
// (le propriétaire d'un salon garde son accès). `exceptRoleIds` : rôles épargnés
// (ex. le rôle admin des vocaux, pour que le staff entre toujours).
async function restrictChannel(channel, permNames, restrict, { reason, exceptRoleIds = [] } = {}) {
  const everyone = channel.guild.roles.everyone;
  const everyonePatch = Object.fromEntries(permNames.map((name) => [name, restrict ? false : null]));
  await channel.permissionOverwrites.edit(everyone, everyonePatch, { reason }).catch(() => {});
  if (!restrict) return; // rétablir @everyone suffit ; les rôles neutralisés héritent de l'ouverture

  for (const overwrite of [...channel.permissionOverwrites.cache.values()]) {
    if (overwrite.type !== 0 || overwrite.id === everyone.id || exceptRoleIds.includes(overwrite.id)) continue;
    const patch = {};
    for (const name of permNames) {
      if (overwrite.allow.has(PermissionFlagsBits[name])) patch[name] = null;
    }
    if (Object.keys(patch).length) {
      await channel.permissionOverwrites.edit(overwrite.id, patch, { reason }).catch(() => {});
    }
  }
}

module.exports = {
  parseDuration,
  formatDuration,
  baseEmbed,
  successEmbed,
  errorEmbed,
  checkHierarchy,
  extractId,
  restrictChannel,
};
