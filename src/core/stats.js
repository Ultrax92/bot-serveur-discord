const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');

// Salons compteurs : visibles par tous mais totalement inutilisables — tout est
// explicitement refusé à @everyone sauf voir (même logique que les vocaux temp,
// aucune permission en héritage exploitable)
const P = PermissionFlagsBits;
const STATS_DENY = [
  // Gestion
  P.ManageChannels,
  P.ManageRoles,
  P.ManageWebhooks,
  // Vocal
  P.Connect,
  P.Speak,
  P.Stream,
  P.UseVAD,
  P.PrioritySpeaker,
  P.MuteMembers,
  P.DeafenMembers,
  P.MoveMembers,
  P.UseSoundboard,
  P.UseExternalSounds,
  P.SetVoiceChannelStatus,
  P.RequestToSpeak,
  // Chat
  P.SendMessages,
  P.SendMessagesInThreads,
  P.AddReactions,
  P.EmbedLinks,
  P.AttachFiles,
  P.SendTTSMessages,
  P.SendVoiceMessages,
  P.SendPolls,
  P.MentionEveryone,
  P.ManageMessages,
  P.ReadMessageHistory,
  P.UseExternalEmojis,
  P.UseExternalStickers,
  P.CreatePublicThreads,
  P.CreatePrivateThreads,
  P.ManageThreads,
  P.PinMessages,
  P.BypassSlowmode,
  // Divers
  P.CreateInstantInvite,
  P.UseApplicationCommands,
  P.UseEmbeddedActivities,
  P.UseExternalApps,
  P.CreateEvents,
  P.ManageEvents,
].filter(Boolean);

// Overwrites de la catégorie : sans rôles d'accès, visible par tous (mais
// inutilisable) ; avec rôles d'accès, everyone est TOTALEMENT refusé (voir
// compris) et les rôles n'ont que "Voir le salon"
function buildStatsOverwrites(guild) {
  const config = getSettings(guild.id).statsConfig;
  const accessRoles = (config.accessRoles ?? []).filter((id) => guild.roles.cache.has(id));
  if (!accessRoles.length) {
    return [{ id: guild.roles.everyone.id, deny: STATS_DENY }];
  }
  return [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel, ...STATS_DENY] },
    ...accessRoles.map((id) => ({ id, allow: [P.ViewChannel], deny: STATS_DENY })),
  ];
}

// Réapplique les permissions sur la catégorie et resynchronise tous les compteurs
async function applyStatsPermissions(guild) {
  const config = getSettings(guild.id).statsConfig;
  const category = config.categoryId && guild.channels.cache.get(config.categoryId);
  if (!category) return;
  await category.permissionOverwrites.set(buildStatsOverwrites(guild), 'Configuration des stats').catch(() => {});
  for (const counter of config.counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (channel?.parentId === category.id) await channel.lockPermissions().catch(() => {});
  }
}

function countFor(guild, counter) {
  if (counter.type === 'members') return guild.memberCount;
  if (counter.type === 'role') {
    return guild.members.cache.filter((m) => m.roles.cache.has(counter.roleId)).size;
  }
  return 0;
}

// Catégorie dédiée aux stats (nom configurable), créée au besoin
async function ensureStatsCategory(guild) {
  const config = getSettings(guild.id).statsConfig;
  let category = config.categoryId && guild.channels.cache.get(config.categoryId);
  if (!category) {
    category = await guild.channels
      .create({
        name: config.categoryName.slice(0, 100),
        type: ChannelType.GuildCategory,
        position: 0,
        permissionOverwrites: buildStatsOverwrites(guild),
      })
      .catch(() => null);
    if (category)
      updateSettings(guild.id, (s) => {
        s.statsConfig.categoryId = category.id;
      });
  }
  return category;
}

// Renomme la catégorie (et la mémorise pour les prochains compteurs)
async function renameStatsCategory(guild, name) {
  updateSettings(guild.id, (s) => {
    s.statsConfig.categoryName = name;
  });
  const config = getSettings(guild.id).statsConfig;
  const category = config.categoryId && guild.channels.cache.get(config.categoryId);
  if (category) await category.setName(name.slice(0, 100)).catch(() => {});
}

// Crée le salon vocal compteur dans la catégorie de stats
async function createCounter(guild, { type, roleId = null }) {
  // Aucun emoji ajouté : nom du rôle tel quel, ou simplement "Membres"
  const label = type === 'members' ? 'Membres : {n}' : `${guild.roles.cache.get(roleId)?.name ?? 'Rôle'} : {n}`;

  await guild.members.fetch().catch(() => {});
  const counter = { id: `s${Date.now().toString(36)}`, type, roleId, channelId: null, label };
  const count = countFor(guild, counter);
  const category = await ensureStatsCategory(guild);

  const channel = await guild.channels
    .create({
      name: label.replace('{n}', count).slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: category?.id ?? null,
    })
    .catch(() => null);
  if (!channel) return null;

  // Salon synchronisé avec la catégorie (héritage des permissions)
  if (category) await channel.lockPermissions().catch(() => {});
  else await channel.permissionOverwrites.set(buildStatsOverwrites(guild)).catch(() => {});

  counter.channelId = channel.id;
  updateSettings(guild.id, (s) => {
    s.statsConfig.counters.push(counter);
    s.modules.stats = true; // on configure → le module s'active
  });
  return counter;
}

async function removeCounter(guild, counterId) {
  const counter = getSettings(guild.id).statsConfig.counters.find((c) => c.id === counterId);
  if (counter?.channelId) {
    await guild.channels.cache
      .get(counter.channelId)
      ?.delete('Compteur de stats retiré')
      .catch(() => {});
  }
  updateSettings(guild.id, (s) => {
    s.statsConfig.counters = s.statsConfig.counters.filter((c) => c.id !== counterId);
  });
}

async function updateCounters(guild) {
  const { counters } = getSettings(guild.id).statsConfig;
  if (!counters.length) return;
  // Cache utilisé s'il est complet : évite les rate-limits gateway (opcode 8)
  const { fetchAllMembers } = require('./serverBackup');
  await fetchAllMembers(guild);

  for (const counter of counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (!channel) continue; // salon supprimé à la main : retirable depuis le panneau
    const newName = counter.label.replace('{n}', countFor(guild, counter)).slice(0, 100);
    if (channel.name !== newName) await channel.setName(newName).catch(() => {});
  }
}

// Mise à jour automatique : une fois au démarrage du bot, puis tous les jours à 4h.
// Les permissions sont réappliquées à chaque passage (les évolutions se propagent seules).
function startStatsWorker(client) {
  const tick = async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!isModuleEnabled(guild.id, 'stats')) continue;
      await applyStatsPermissions(guild).catch(() => {});
      await updateCounters(guild).catch((error) => console.error('Erreur stats :', error));
    }
  };

  setTimeout(tick, 30_000); // fraîcheur après un redémarrage/une config

  const scheduleNext4h = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(4, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(async () => {
      await tick();
      scheduleNext4h();
    }, next.getTime() - now.getTime());
  };
  scheduleNext4h();
}

module.exports = {
  createCounter,
  removeCounter,
  updateCounters,
  renameStatsCategory,
  applyStatsPermissions,
  startStatsWorker,
};
