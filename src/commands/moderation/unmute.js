const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { logModAction } = require('../../core/logs');
const { successEmbed, errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription("Retire le mute d'un membre")
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à unmute').setRequired(true)),

  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    if (!member) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Membre introuvable sur ce serveur.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!member.isCommunicationDisabled()) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, "Ce membre n'est pas mute.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await member.timeout(null, `Unmute par ${interaction.user.tag}`);
    await logModAction(interaction, { emoji: '🔊', action: 'Unmute', target: member.user });
    return interaction.reply({ embeds: [successEmbed(interaction, `🔊 **${member.user.tag}** n'est plus mute.`)] });
  },
};
