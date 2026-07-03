const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hubView, watchPanel } = require('../../core/setupPanel');
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
        embeds: [errorEmbed(interaction, 'Seul le propriétaire peut lancer le setup.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.reply(hubView(interaction.guild));
    // Le panneau se ferme tout seul après 1 minute sans interaction
    watchPanel(await interaction.fetchReply().catch(() => null));
  },
};
