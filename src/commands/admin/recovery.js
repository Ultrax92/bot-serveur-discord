const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { recoveryPanel } = require('../../core/recovery');
const { canManageAdmins } = require('../../core/permissions');
const { errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'backups',
  data: new SlashCommandBuilder()
    .setName('recovery')
    .setDescription("[Owner] Rappelle les anciens membres par MP avec l'invitation du serveur"),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Seul le propriétaire peut lancer une campagne de rappel.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      ...(await recoveryPanel(interaction.guild)),
      flags: MessageFlags.Ephemeral,
    });
  },
};
