const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canManageAdmins, removeAdmin } = require('../../core/permissions');
const { successEmbed, errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('del-admin')
    .setDescription('Retire l\'accès aux commandes du bot à un membre')
    .addUserOption((opt) => opt.setName('utilisateur').setDescription('Le membre qui perd son accès admin').setRequired(true)),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guildId, 'Seul le propriétaire peut gérer les admins du bot.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('utilisateur');
    const removed = removeAdmin(interaction.guildId, user.id);
    if (!removed) {
      return interaction.reply({ embeds: [errorEmbed(interaction.guildId, `**${user.tag}** n'est pas admin du bot.`)], flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ embeds: [successEmbed(interaction.guildId, `**${user.tag}** n'est plus admin du bot.`)] });
  },
};
