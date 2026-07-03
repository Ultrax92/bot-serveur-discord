const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed, checkHierarchy } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Change le pseudo d\'un membre sur le serveur')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((opt) => opt.setName('pseudo').setDescription('Le nouveau pseudo (vide pour réinitialiser)').setMaxLength(32)),

  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const nickname = interaction.options.getString('pseudo');

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed(interaction.guildId, 'Membre introuvable sur ce serveur.')], flags: MessageFlags.Ephemeral });
    }
    const hierarchyError = checkHierarchy(interaction, member);
    if (hierarchyError) {
      return interaction.reply({ embeds: [errorEmbed(interaction.guildId, hierarchyError)], flags: MessageFlags.Ephemeral });
    }

    await member.setNickname(nickname ?? null, `Pseudo changé par ${interaction.user.tag}`);
    return interaction.reply({
      embeds: [successEmbed(interaction.guildId, nickname
        ? `Le pseudo de **${member.user.tag}** est maintenant **${nickname}**.`
        : `Le pseudo de **${member.user.tag}** a été réinitialisé.`)],
    });
  },
};
