const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { customView, watchPanel } = require('../../core/setupPanel');
const { canManageAdmins } = require('../../core/permissions');
const { errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'custom',
  data: new SlashCommandBuilder()
    .setName('custom')
    .setDescription('Gère les commandes custom du serveur (+regles, !boutique…)'),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Seul le propriétaire peut gérer les commandes custom.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.reply(customView(interaction.guild));
    // Même panneau que /setup → 🧩, avec fermeture auto après inactivité
    watchPanel(await interaction.fetchReply().catch(() => null));
  },
};
