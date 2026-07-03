const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');

const LOG_TYPES = {
  mod: { label: 'Modération', emoji: '🔨', channelName: 'logs-moderation' },
  message: { label: 'Messages', emoji: '💬', channelName: 'logs-messages' },
  voice: { label: 'Vocal', emoji: '🔊', channelName: 'logs-vocal' },
  role: { label: 'Rôles', emoji: '🎭', channelName: 'logs-roles' },
  boost: { label: 'Boosts', emoji: '🚀', channelName: 'logs-boosts' },
  join: { label: 'Arrivées', emoji: '📥', channelName: 'logs-join' },
  leave: { label: 'Départs', emoji: '📤', channelName: 'logs-leave' },
  verif: { label: 'Vérification', emoji: '✅', channelName: 'logs-verif' },
  ticket: { label: 'Tickets', emoji: '🎫', channelName: 'logs-tickets' },
  raid: { label: 'Antiraid', emoji: '🛡️', channelName: 'logs-raid' },
};

// Envoie un embed dans le salon de log du type donné (silencieux si non configuré)
async function sendLog(guild, type, embed) {
  if (!isModuleEnabled(guild.id, 'logs')) return;
  const channelId = getSettings(guild.id).logsChannels[type];
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;
  await channel.send({ embeds: [embed] }).catch(() => {});
}

// Log d'une action de modération effectuée via le bot
async function logModAction(interaction, { emoji, action, target, reason, duration }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setAuthor({ name: `${emoji} ${action}` })
    .addFields(
      { name: 'Membre', value: target ? `${target} (\`${target.id ?? target}\`)` : 'N/A', inline: true },
      { name: 'Modérateur', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
    )
    .setTimestamp();
  if (duration) embed.addFields({ name: 'Durée', value: duration, inline: true });
  if (reason) embed.addFields({ name: 'Raison', value: reason });
  await sendLog(interaction.guild, 'mod', embed);
}

// Catégorie "📜 Logs" cachée des membres (créée si absente)
async function ensureLogsCategory(guild) {
  let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === '📜 Logs');
  if (!category) {
    category = await guild.channels.create({
      name: '📜 Logs',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });
  }
  return category;
}

// Crée le salon d'un type de log et l'enregistre dans les settings
async function createLogChannel(guild, type) {
  const category = await ensureLogsCategory(guild);
  const channel = await guild.channels.create({
    name: LOG_TYPES[type].channelName,
    type: ChannelType.GuildText,
    parent: category.id,
  });
  updateSettings(guild.id, (s) => { s.logsChannels[type] = channel.id; });
  return channel;
}

// Crée tous les salons de logs manquants. Réutilise ceux déjà configurés.
async function autoConfigureLogs(guild) {
  const settings = getSettings(guild.id);
  const created = [];

  for (const [type, meta] of Object.entries(LOG_TYPES)) {
    const existing = settings.logsChannels[type] && guild.channels.cache.get(settings.logsChannels[type]);
    if (existing) continue;
    const channel = await createLogChannel(guild, type);
    created.push(`${meta.emoji} ${channel}`);
  }

  updateSettings(guild.id, (s) => { s.modules.logs = true; });
  return created;
}

module.exports = { LOG_TYPES, sendLog, logModAction, ensureLogsCategory, createLogChannel, autoConfigureLogs };
