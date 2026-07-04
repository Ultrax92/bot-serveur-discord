const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');

function countFor(guild, counter) {
  if (counter.type === 'members') return guild.memberCount;
  if (counter.type === 'role') {
    return guild.members.cache.filter((m) => m.roles.cache.has(counter.roleId)).size;
  }
  return 0;
}

// Crée le salon vocal compteur, verrouillé pour tout le monde (connexion ET chat)
async function createCounter(guild, { type, roleId = null }) {
  const label = type === 'members'
    ? '👥 Membres : {n}'
    : `🎭 ${guild.roles.cache.get(roleId)?.name ?? 'Rôle'} : {n}`;

  await guild.members.fetch().catch(() => {});
  const counter = { id: `s${Date.now().toString(36)}`, type, roleId, channelId: null, label };
  const count = countFor(guild, counter);

  const channel = await guild.channels.create({
    name: label.replace('{n}', count).slice(0, 100),
    type: ChannelType.GuildVoice,
    position: 0,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages],
      },
    ],
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

module.exports = { createCounter, removeCounter, updateCounters, startStatsWorker };
