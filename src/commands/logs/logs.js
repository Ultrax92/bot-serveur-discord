const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { LOG_TYPES, autoConfigureLogs } = require('../../core/logs');
const { getSettings, updateSettings } = require('../../core/settings');
const { baseEmbed, successEmbed, errorEmbed } = require('../../core/utils');

const typeChoices = Object.entries(LOG_TYPES).map(([value, m]) => ({ name: m.label, value }));

module.exports = {
  module: 'logs',
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configure les salons de logs')
    .addSubcommand((sub) =>
      sub.setName('auto')
        .setDescription('Crée automatiquement une catégorie avec un salon par type de log'))
    .addSubcommand((sub) =>
      sub.setName('set')
        .setDescription('Définit le salon d\'un type de log')
        .addStringOption((opt) => opt.setName('type').setDescription('Le type de log').setRequired(true).addChoices(...typeChoices))
        .addChannelOption((opt) =>
          opt.setName('salon').setDescription('Le salon où envoyer ces logs').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) =>
      sub.setName('off')
        .setDescription('Désactive un type de log')
        .addStringOption((opt) => opt.setName('type').setDescription('Le type de log à désactiver').setRequired(true).addChoices(...typeChoices)))
    .addSubcommand((sub) => sub.setName('view').setDescription('Affiche la configuration des logs')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'auto') {
      await interaction.deferReply();
      const created = await autoConfigureLogs(interaction.guild);
      return interaction.editReply({
        embeds: [successEmbed(interaction.guildId, created.length
          ? `Salons de logs créés :\n${created.join('\n')}`
          : 'Tous les salons de logs étaient déjà configurés.')],
      });
    }

    if (sub === 'set') {
      const type = interaction.options.getString('type');
      const channel = interaction.options.getChannel('salon');
      updateSettings(interaction.guildId, (s) => { s.logsChannels[type] = channel.id; });
      return interaction.reply({
        embeds: [successEmbed(interaction.guildId, `Les logs **${LOG_TYPES[type].label}** seront envoyés dans ${channel}.`)],
      });
    }

    if (sub === 'off') {
      const type = interaction.options.getString('type');
      const settings = getSettings(interaction.guildId);
      if (!settings.logsChannels[type]) {
        return interaction.reply({ embeds: [errorEmbed(interaction.guildId, `Les logs **${LOG_TYPES[type].label}** ne sont pas configurés.`)], flags: MessageFlags.Ephemeral });
      }
      updateSettings(interaction.guildId, (s) => { delete s.logsChannels[type]; });
      return interaction.reply({ embeds: [successEmbed(interaction.guildId, `Logs **${LOG_TYPES[type].label}** désactivés.`)] });
    }

    if (sub === 'view') {
      const settings = getSettings(interaction.guildId);
      const lines = Object.entries(LOG_TYPES).map(([type, meta]) => {
        const channelId = settings.logsChannels[type];
        const channel = channelId && interaction.guild.channels.cache.get(channelId);
        return `${meta.emoji} **${meta.label}** — ${channel ? `${channel}` : '🔴 désactivé'}`;
      });
      const embed = baseEmbed(interaction.guildId)
        .setTitle('Configuration des logs')
        .setDescription(lines.join('\n'))
        .setFooter({ text: '/logs auto pour tout créer d\'un coup, /logs set pour un salon précis' });
      return interaction.reply({ embeds: [embed] });
    }
  },
};
