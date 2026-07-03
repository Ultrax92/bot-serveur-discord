const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hubView } = require('../../core/setupPanel');
const { canManageAdmins } = require('../../core/permissions');
const { errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Ouvre le panneau de configuration interactif du bot'),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guildId, 'Seul le propriétaire peut lancer le setup.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply(hubView(interaction.guild));
  },
};
