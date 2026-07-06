const { ChannelType } = require('discord.js');
const db = require('./db');
const { isModuleEnabled } = require('./settings');

// Sauvegarde et restauration de la STRUCTURE du serveur : rôles, catégories,
// salons, permissions (autorisations/refus par rôle et par membre), réglages
// du serveur, et rôles de chaque membre (remis automatiquement à son retour).
// Limite API Discord (tous bots confondus) : les messages, boosts, webhooks
// et intégrations tierces ne sont pas restaurables.

const CAPTURED_CHANNEL_TYPES = [
  ChannelType.GuildCategory,
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
];

const upsertMemberRolesStmt = db.prepare(`
  INSERT INTO member_roles (guild_id, user_id, roles, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET roles = excluded.roles, updated_at = excluded.updated_at
`);
const getMemberRolesStmt = db.prepare('SELECT roles FROM member_roles WHERE guild_id = ? AND user_id = ?');
const allMemberRolesStmt = db.prepare('SELECT user_id, roles FROM member_roles WHERE guild_id = ?');
const setMemberRolesStmt = db.prepare('UPDATE member_roles SET roles = ? WHERE guild_id = ? AND user_id = ?');

// ── Capture ───────────────────────────────────────────────────────────────────

// Liste complète des membres, en économisant le gateway : le cache est complet
// après le premier fetch (l'intent membres le tient à jour), et en cas de
// rate-limit (opcode 8) on se rabat dessus plutôt que de tout perdre
async function fetchAllMembers(guild) {
  if (guild.members.cache.size >= guild.memberCount) return guild.members.cache;
  try {
    return await guild.members.fetch();
  } catch (error) {
    console.error(`[backups] Fetch des membres limité (${guild.id}), cache utilisé :`, error.message ?? error);
    return guild.members.cache;
  }
}

// Photographie les rôles de chaque membre (pour les lui remettre s'il revient)
async function snapshotMemberRoles(guild) {
  const members = await fetchAllMembers(guild);
  const now = Date.now();
  const write = db.transaction(() => {
    for (const member of members.values()) {
      if (member.user.bot) continue;
      const roles = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.id);
      upsertMemberRolesStmt.run(guild.id, member.id, JSON.stringify(roles), now);
    }
  });
  write();
  return members.size;
}

// Capture la structure complète du serveur pour le backup
async function captureServer(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => !r.managed || r.id === guild.id) // les rôles gérés (bots, boosts) ne sont pas recréables
    .sort((a, b) => b.position - a.position) // du plus haut au plus bas
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      everyone: r.id === guild.id,
    }));

  const channels = [...guild.channels.cache.values()]
    .filter((c) => CAPTURED_CHANNEL_TYPES.includes(c.type))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      parentId: c.parentId ?? null,
      topic: c.topic ?? null,
      nsfw: c.nsfw ?? false,
      rateLimitPerUser: c.rateLimitPerUser ?? 0,
      bitrate: c.bitrate ?? null,
      userLimit: c.userLimit ?? null,
      overwrites: [...c.permissionOverwrites.cache.values()].map((o) => ({
        id: o.id,
        type: o.type, // 0 = rôle, 1 = membre
        allow: o.allow.bitfield.toString(),
        deny: o.deny.bitfield.toString(),
      })),
    }));

  let icon = null;
  const iconURL = guild.iconURL({ size: 512, extension: 'png' });
  if (iconURL) {
    const response = await fetch(iconURL).catch(() => null);
    if (response?.ok) icon = Buffer.from(await response.arrayBuffer()).toString('base64');
  }

  return {
    name: guild.name,
    icon,
    verificationLevel: guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter: guild.explicitContentFilter,
    afkTimeout: guild.afkTimeout,
    afkChannelId: guild.afkChannelId,
    systemChannelId: guild.systemChannelId,
    roles,
    channels,
  };
}

// ── Restauration ──────────────────────────────────────────────────────────────

// Overwrites du backup → overwrites applicables (rôles remappés vers les nouveaux ids)
function mapOverwrites(overwrites, idMap) {
  return (overwrites ?? [])
    .map((o) => ({
      id: o.type === 0 ? (idMap[o.id] ?? null) : o.id, // les membres gardent leur id
      type: o.type,
      allow: BigInt(o.allow),
      deny: BigInt(o.deny),
    }))
    .filter((o) => o.id);
}

function channelCreateOptions(guild, c, idMap) {
  const options = {
    name: c.name,
    type: c.type,
    reason: 'Restauration du backup serveur',
    permissionOverwrites: mapOverwrites(c.overwrites, idMap),
  };
  if (c.parentId && idMap[c.parentId]) options.parent = idMap[c.parentId];
  if (c.topic) options.topic = c.topic.slice(0, 1024);
  if (c.nsfw) options.nsfw = true;
  if (c.rateLimitPerUser) options.rateLimitPerUser = c.rateLimitPerUser;
  if (c.bitrate) options.bitrate = Math.min(c.bitrate, guild.maximumBitrate ?? 96_000);
  if (c.userLimit) options.userLimit = c.userLimit;
  return options;
}

async function applyGuildSettings(guild, server, idMap) {
  await guild
    .edit({
      name: server.name,
      verificationLevel: server.verificationLevel,
      defaultMessageNotifications: server.defaultMessageNotifications,
      explicitContentFilter: server.explicitContentFilter,
      afkTimeout: server.afkTimeout,
      afkChannel: (server.afkChannelId && idMap[server.afkChannelId]) || null,
      systemChannel: (server.systemChannelId && idMap[server.systemChannelId]) || null,
      reason: 'Restauration du backup serveur',
    })
    .catch(() => {});
  if (server.icon)
    await guild.setIcon(Buffer.from(server.icon, 'base64'), 'Restauration du backup serveur').catch(() => {});
}

// 🔧 RÉPARER : recrée ce qui manque et réapplique les permissions, sans rien
// supprimer. Les rôles/salons existants sont retrouvés par id, sinon par nom.
async function repairServer(guild, server, progress = async () => {}) {
  const idMap = {};
  const me = guild.members.me;
  let createdRoles = 0;
  let createdChannels = 0;

  await progress('🎭 Réparation des rôles…');
  for (const r of server.roles) {
    if (r.everyone) {
      idMap[r.id] = guild.id;
      await guild.roles.everyone.setPermissions(BigInt(r.permissions)).catch(() => {});
      continue;
    }
    let existing = guild.roles.cache.get(r.id) ?? guild.roles.cache.find((x) => x.name === r.name && !x.managed);
    if (existing) {
      idMap[r.id] = existing.id;
      if (!existing.managed && me.roles.highest.comparePositionTo(existing) > 0) {
        await existing
          .edit({
            name: r.name,
            colors: { primaryColor: r.color },
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: BigInt(r.permissions),
            reason: 'Réparation du backup serveur',
          })
          .catch(() => {});
      }
    } else {
      const created = await guild.roles
        .create({
          name: r.name,
          colors: { primaryColor: r.color },
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: BigInt(r.permissions),
          reason: 'Réparation du backup serveur',
        })
        .catch(() => null);
      if (created) {
        idMap[r.id] = created.id;
        createdRoles++;
      }
    }
  }

  await progress('📁 Réparation des salons…');
  const categories = server.channels.filter((c) => c.type === ChannelType.GuildCategory);
  const others = server.channels.filter((c) => c.type !== ChannelType.GuildCategory);
  for (const c of [...categories, ...others]) {
    let existing = guild.channels.cache.get(c.id);
    if (!existing) {
      existing = guild.channels.cache.find(
        (x) => x.name === c.name && x.type === c.type && (!c.parentId || x.parentId === idMap[c.parentId]),
      );
    }
    if (existing) {
      idMap[c.id] = existing.id;
      await existing.permissionOverwrites
        .set(mapOverwrites(c.overwrites, idMap), 'Réparation du backup serveur')
        .catch(() => {});
    } else {
      const created = await guild.channels.create(channelCreateOptions(guild, c, idMap)).catch(() => null);
      if (created) {
        idMap[c.id] = created.id;
        createdChannels++;
      }
    }
  }

  await progress('⚙️ Réglages du serveur…');
  await applyGuildSettings(guild, server, idMap);
  return { idMap, createdRoles, createdChannels };
}

// 🏗️ RECONSTRUIRE 1:1 : supprime tous les salons et rôles supprimables, puis
// recrée tout depuis le backup. Pensé pour un serveur neuf ou dévasté.
async function rebuildServer(guild, server, progress = async () => {}) {
  const idMap = {};
  const me = guild.members.me;

  await progress('🗑️ Suppression des salons actuels…');
  for (const channel of [...guild.channels.cache.values()]) {
    await channel.delete('Reconstruction depuis le backup').catch(() => {});
  }

  await progress('🗑️ Suppression des rôles actuels…');
  for (const role of [...guild.roles.cache.values()].sort((a, b) => b.position - a.position)) {
    if (role.id === guild.id || role.managed) continue;
    if (me.roles.highest.comparePositionTo(role) <= 0) continue;
    await role.delete('Reconstruction depuis le backup').catch(() => {});
  }

  await progress(`🎭 Création des ${server.roles.length} rôles…`);
  for (const r of server.roles) {
    if (r.everyone) {
      idMap[r.id] = guild.id;
      await guild.roles.everyone.setPermissions(BigInt(r.permissions)).catch(() => {});
      continue;
    }
    // Créés du plus haut au plus bas : chaque nouveau rôle apparaît sous les précédents
    const created = await guild.roles
      .create({
        name: r.name,
        colors: { primaryColor: r.color },
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: BigInt(r.permissions),
        reason: 'Reconstruction depuis le backup',
      })
      .catch(() => null);
    if (created) idMap[r.id] = created.id;
  }

  await progress(`📁 Création des ${server.channels.length} salons…`);
  const categories = server.channels.filter((c) => c.type === ChannelType.GuildCategory);
  const others = server.channels.filter((c) => c.type !== ChannelType.GuildCategory);
  for (const c of [...categories, ...others]) {
    const created = await guild.channels.create(channelCreateOptions(guild, c, idMap)).catch(() => null);
    if (created) idMap[c.id] = created.id;
  }

  await progress('⚙️ Réglages du serveur (nom, icône, vérification)…');
  await applyGuildSettings(guild, server, idMap);
  return { idMap, createdRoles: server.roles.length, createdChannels: server.channels.length };
}

// ── Remappage anciens ids → nouveaux ──────────────────────────────────────────

// Remplace tous les anciens ids (rôles, salons) par les nouveaux dans un texte
// JSON — utilisé sur la config du bot et sur les rôles mémorisés des membres
function remapIdsInText(text, idMap) {
  let out = text;
  for (const [oldId, newId] of Object.entries(idMap)) {
    if (oldId !== newId) out = out.split(oldId).join(newId);
  }
  return out;
}

function remapMemberRoles(guildId, idMap) {
  const rows = allMemberRolesStmt.all(guildId);
  const write = db.transaction(() => {
    for (const row of rows) setMemberRolesStmt.run(remapIdsInText(row.roles, idMap), guildId, row.user_id);
  });
  write();
}

// ── Réattribution des rôles mémorisés ─────────────────────────────────────────

// Remet à un membre les rôles qui lui manquent parmi ceux mémorisés au dernier
// backup. Retourne le nombre de rôles ajoutés.
async function applySavedRoles(member, reason) {
  const row = getMemberRolesStmt.get(member.guild.id, member.id);
  if (!row) return 0;
  let saved = [];
  try {
    saved = JSON.parse(row.roles);
  } catch {
    return 0;
  }
  const me = member.guild.members.me;
  const roles = saved
    .map((id) => member.guild.roles.cache.get(id))
    .filter(
      (role) =>
        role && !role.managed && !member.roles.cache.has(role.id) && me.roles.highest.comparePositionTo(role) > 0,
    );
  if (!roles.length) return 0;
  await member.roles.add(roles, reason).catch(() => {});
  return roles.length;
}

// Retour d'un membre : ses rôles d'avant lui sont remis
async function reassignRolesOnJoin(member) {
  if (member.user.bot || !isModuleEnabled(member.guild.id, 'backups')) return 0;
  return applySavedRoles(member, 'Retour sur le serveur : rôles restaurés depuis le backup');
}

// Après une réparation/reconstruction : les membres DÉJÀ présents récupèrent
// aussi leurs rôles (aucun événement "join" ne se déclenche pour eux)
async function reassignRolesForPresentMembers(guild) {
  const members = await fetchAllMembers(guild);
  let touched = 0;
  let total = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const added = await applySavedRoles(member, 'Restauration du backup : rôles remis aux membres présents');
    if (added) {
      touched++;
      total += added;
    }
  }
  return { members: touched, roles: total };
}

module.exports = {
  snapshotMemberRoles,
  captureServer,
  repairServer,
  rebuildServer,
  remapIdsInText,
  remapMemberRoles,
  reassignRolesOnJoin,
  reassignRolesForPresentMembers,
};
