const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canManageAdmins, addAdmin } = require('../../core/permissions');
const { successEmbed, errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('get-admin')
    .setDescription('Donne l\'accès à toutes les commandes du bot à un membre')
    .addUserOption((opt) => opt.setName('utilisateur').setDescription('Le membre qui devient admin du bot').setRequired(true)),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guildId, 'Seul le propriétaire peut gérer les admins du bot.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('utilisateur');
    if (user.bot) {
      return interaction.reply({ embeds: [errorEmbed(interaction.guildId, 'Un bot ne peut pas être admin.')], flags: MessageFlags.Ephemeral });
    }

    const added = addAdmin(interaction.guildId, user.id);
    if (!added) {
      return interaction.reply({ embeds: [errorEmbed(interaction.guildId, `**${user.tag}** est déjà admin du bot.`)], flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ embeds: [successEmbed(interaction.guildId, `👑 **${user.tag}** est maintenant admin du bot : il a accès à toutes les commandes.`)] });
  },
};
