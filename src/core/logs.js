const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');

const LOG_TYPES = {
  mod: { label: 'Modération', emoji: '🔨', channelName: 'logs-moderation' },
  message: { label: 'Messages', emoji: '💬', channelName: 'logs-messages' },
  voice: { label: 'Vocal', emoji: '🔊', channelName: 'logs-vocal' },
  role: { label: 'Rôles', emoji: '🎭', channelName: 'logs-roles' },
  boost: { label: 'Boosts', emoji: '🚀', channelName: 'logs-boosts' },
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

// Crée une catégorie "📜 Logs" avec un salon par type, visible uniquement par les admins,
// et enregistre le tout dans les settings. Réutilise les salons déjà configurés.
async function autoConfigureLogs(guild) {
  const settings = getSettings(guild.id);
  const created = [];

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

  const channels = { ...settings.logsChannels };
  for (const [type, meta] of Object.entries(LOG_TYPES)) {
    const existing = channels[type] && guild.channels.cache.get(channels[type]);
    if (existing) continue;
    const channel = await guild.channels.create({
      name: meta.channelName,
      type: ChannelType.GuildText,
      parent: category.id,
    });
    channels[type] = channel.id;
    created.push(`${meta.emoji} ${channel}`);
  }

  updateSettings(guild.id, (s) => {
    s.logsChannels = channels;
    s.modules.logs = true;
  });

  return created;
}

module.exports = { LOG_TYPES, sendLog, logModAction, autoConfigureLogs };
