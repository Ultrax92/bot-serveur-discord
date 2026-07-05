const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { backupPanel } = require('../../core/backups');
const { canManageAdmins } = require('../../core/permissions');
const { errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('[Owner] Sauvegarde/restaure la configuration du bot (export/import .json)'),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Seul le propriétaire peut gérer les backups.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({ ...backupPanel(interaction.guild, interaction.user.id), flags: MessageFlags.Ephemeral });
  },
};
