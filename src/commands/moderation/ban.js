const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { addSanction } = require('../../core/sanctions');
const { parseDuration, formatDuration, successEmbed, errorEmbed, checkHierarchy } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannit un membre du serveur (définitif ou temporaire)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption((opt) => opt.setName('durée').setDescription('Durée du ban, ex: 7j, 12h — vide = définitif'))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison du bannissement'))
    .addIntegerOption((opt) =>
      opt.setName('supprimer_messages')
        .setDescription('Supprimer ses messages des derniers jours (0 à 7)')
        .setMinValue(0)
        .setMaxValue(7)),

  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const member = interaction.options.getMember('membre');
    const durationInput = interaction.options.getString('durée');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';
    const deleteDays = interaction.options.getInteger('supprimer_messages') ?? 0;

    if (member) {
      const hierarchyError = checkHierarchy(interaction, member);
      if (hierarchyError) {
        return interaction.reply({ embeds: [errorEmbed(interaction.guildId, hierarchyError)], flags: MessageFlags.Ephemeral });
      }
    }

    let expiresAt = null;
    let durationText = '';
    if (durationInput) {
      const duration = parseDuration(durationInput);
      if (!duration) {
        return interaction.reply({ embeds: [errorEmbed(interaction.guildId, 'Durée invalide. Exemples : `12h`, `7j`, `1j12h`.')], flags: MessageFlags.Ephemeral });
      }
      expiresAt = Date.now() + duration;
      durationText = ` pour **${formatDuration(duration)}**`;
    }

    await user.send(`🔨 Tu as été banni de **${interaction.guild.name}**${durationText ? durationText.replaceAll('**', '') : ''} : ${reason}`).catch(() => {});
    await interaction.guild.bans.create(user.id, {
      reason: `${reason} (par ${interaction.user.tag})`,
      deleteMessageSeconds: deleteDays * 86_400,
    });
    addSanction({
      guildId: interaction.guildId,
      userId: user.id,
      moderatorId: interaction.user.id,
      type: 'ban',
      reason,
      expiresAt,
    });

    return interaction.reply({ embeds: [successEmbed(interaction.guildId, `🔨 **${user.tag}** a été banni${durationText}.\n**Raison :** ${reason}`)] });
  },
};
