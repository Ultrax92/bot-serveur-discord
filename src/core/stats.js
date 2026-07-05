const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');

// Salons compteurs : visibles par tous mais totalement inutilisables — tout est
// explicitement refusé à @everyone sauf voir (même logique que les vocaux temp,
// aucune permission en héritage exploitable)
const P = PermissionFlagsBits;
const STATS_DENY = [
  P.Connect, P.Speak, P.Stream, P.CreateInstantInvite,
  P.SendMessages, P.AddReactions, P.EmbedLinks, P.AttachFiles,
  P.UseSoundboard, P.UseExternalSounds, P.UseVAD, P.PrioritySpeaker,
  P.SendTTSMessages, P.SendVoiceMessages, P.SendPolls,
  P.MentionEveryone, P.UseExternalEmojis, P.UseExternalStickers,
  P.UseApplicationCommands, P.UseEmbeddedActivities, P.UseExternalApps,
  P.CreateEvents, P.ManageEvents,
].filter(Boolean);

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
    category = await guild.channels.create({
      name: config.categoryName.slice(0, 100),
      type: ChannelType.GuildCategory,
      position: 0,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: STATS_DENY }],
    }).catch(() => null);
    if (category) updateSettings(guild.id, (s) => { s.statsConfig.categoryId = category.id; });
  }
  return category;
}

// Renomme la catégorie (et la mémorise pour les prochains compteurs)
async function renameStatsCategory(guild, name) {
  updateSettings(guild.id, (s) => { s.statsConfig.categoryName = name; });
  const config = getSettings(guild.id).statsConfig;
  const category = config.categoryId && guild.channels.cache.get(config.categoryId);
  if (category) await category.setName(name.slice(0, 100)).catch(() => {});
}

// Crée le salon vocal compteur dans la catégorie de stats
async function createCounter(guild, { type, roleId = null }) {
  // Nom du rôle tel quel sur le serveur, sans emoji ajouté
  const label = type === 'members'
    ? '👥 Membres : {n}'
    : `${guild.roles.cache.get(roleId)?.name ?? 'Rôle'} : {n}`;

  await guild.members.fetch().catch(() => {});
  const counter = { id: `s${Date.now().toString(36)}`, type, roleId, channelId: null, label };
  const count = countFor(guild, counter);
  const category = await ensureStatsCategory(guild);

  const channel = await guild.channels.create({
    name: label.replace('{n}', count).slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: category?.id ?? null,
    permissionOverwrites: [{ id: guild.roles.everyone.id, deny: STATS_DENY }],
  }).catch(() => null);
  if (!channel) return null;

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
    await guild.channels.cache.get(counter.channelId)?.delete('Compteur de stats retiré').catch(() => {});
  }
  updateSettings(guild.id, (s) => {
    s.statsConfig.counters = s.statsConfig.counters.filter((c) => c.id !== counterId);
  });
}

async function updateCounters(guild) {
  const { counters } = getSettings(guild.id).statsConfig;
  if (!counters.length) return;
  await guild.members.fetch().catch(() => {});

  for (const counter of counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (!channel) continue; // salon supprimé à la main : retirable depuis le panneau
    const newName = counter.label.replace('{n}', countFor(guild, counter)).slice(0, 100);
    if (channel.name !== newName) await channel.setName(newName).catch(() => {});
  }
}

// Discord limite les renommages de salons à 2 par 10 min : on actualise toutes les 10 min
function startStatsWorker(client) {
  const tick = async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!isModuleEnabled(guild.id, 'stats')) continue;
      await updateCounters(guild).catch((error) => console.error('Erreur stats :', error));
    }
  };
  setTimeout(tick, 30_000);          // première mise à jour peu après le démarrage
  setInterval(tick, 10 * 60_000);
}

module.exports = { createCounter, removeCounter, updateCounters, renameStatsCategory, startStatsWorker };
