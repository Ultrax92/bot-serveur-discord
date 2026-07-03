const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addSanction } = require('../../core/sanctions');
const { getSettings } = require('../../core/settings');
const { logModAction } = require('../../core/logs');
const { successEmbed, errorEmbed, checkHierarchy } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Avertit un membre')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à avertir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison de l\'avertissement')),

  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Membre introuvable sur ce serveur.')], flags: MessageFlags.Ephemeral });
    }
    const hierarchyError = checkHierarchy(interaction, member);
    if (hierarchyError) {
      return interaction.reply({ embeds: [errorEmbed(interaction, hierarchyError)], flags: MessageFlags.Ephemeral });
    }

    addSanction({
      guildId: interaction.guildId,
      userId: member.id,
      moderatorId: interaction.user.id,
      type: 'warn',
      reason,
    });

    if (getSettings(interaction.guildId).moderationConfig.dmOnSanction) {
      await member.send(`⚠️ Tu as reçu un avertissement sur **${interaction.guild.name}** : ${reason}`).catch(() => {});
    }
    await logModAction(interaction, { emoji: '⚠️', action: 'Warn', target: member.user, reason });
    return interaction.reply({ embeds: [successEmbed(interaction, `**${member.user.tag}** a été averti.\n**Raison :** ${reason}`)] });
  },
};
