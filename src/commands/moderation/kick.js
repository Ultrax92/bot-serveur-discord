const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addSanction } = require('../../core/sanctions');
const { getSettings } = require('../../core/settings');
const { logModAction } = require('../../core/logs');
const { successEmbed, errorEmbed, checkHierarchy } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulse un membre du serveur')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison de l\'expulsion')),

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

    if (getSettings(interaction.guildId).moderationConfig.dmOnSanction) {
      await member.send(`👢 Tu as été expulsé de **${interaction.guild.name}** : ${reason}`).catch(() => {});
    }
    await member.kick(`${reason} (par ${interaction.user.tag})`);
    addSanction({
      guildId: interaction.guildId,
      userId: member.id,
      moderatorId: interaction.user.id,
      type: 'kick',
      reason,
    });

    await logModAction(interaction, { emoji: '👢', action: 'Kick', target: member.user, reason });
    return interaction.reply({ embeds: [successEmbed(interaction, `👢 **${member.user.tag}** a été expulsé.\n**Raison :** ${reason}`)] });
  },
};
