const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { logModAction } = require('../../core/logs');
const { successEmbed, errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannit un utilisateur')
    .addStringOption((opt) =>
      opt.setName('utilisateur').setDescription("L'ID de l'utilisateur à débannir").setRequired(true),
    ),

  async execute(interaction) {
    const userId = interaction.options.getString('utilisateur').trim();
    try {
      const user = await interaction.guild.bans.remove(userId, `Unban par ${interaction.user.tag}`);
      await logModAction(interaction, { emoji: '🔓', action: 'Unban', target: user ?? userId });
      return interaction.reply({ embeds: [successEmbed(interaction, `**${user?.tag ?? userId}** a été débanni.`)] });
    } catch {
      return interaction.reply({
        embeds: [errorEmbed(interaction, "Utilisateur introuvable dans la liste des bannis (vérifie l'ID).")],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
