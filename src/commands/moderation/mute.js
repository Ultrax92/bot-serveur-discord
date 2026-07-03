const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addSanction } = require('../../core/sanctions');
const { getSettings } = require('../../core/settings');
const { logModAction } = require('../../core/logs');
const { parseDuration, formatDuration, successEmbed, errorEmbed, checkHierarchy } = require('../../core/utils');

const MAX_TIMEOUT_MS = 28 * 86_400_000; // limite Discord : 28 jours

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute un membre (timeout Discord)')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à mute').setRequired(true))
    .addStringOption((opt) => opt.setName('durée').setDescription('Durée du mute, ex: 1h, 30m, 2j (max 28j, défaut 1h)'))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison du mute')),

  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const durationInput = interaction.options.getString('durée');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Membre introuvable sur ce serveur.')], flags: MessageFlags.Ephemeral });
    }
    const hierarchyError = checkHierarchy(interaction, member);
    if (hierarchyError) {
      return interaction.reply({ embeds: [errorEmbed(interaction, hierarchyError)], flags: MessageFlags.Ephemeral });
    }

    // Durée par défaut configurable via /setup → Modération
    let duration = parseDuration(getSettings(interaction.guildId).moderationConfig.defaultMuteDuration) ?? 3_600_000;
    if (durationInput) {
      duration = parseDuration(durationInput);
      if (!duration) {
        return interaction.reply({ embeds: [errorEmbed(interaction, 'Durée invalide. Exemples : `30m`, `1h`, `2j`, `1j12h`.')], flags: MessageFlags.Ephemeral });
      }
      if (duration > MAX_TIMEOUT_MS) duration = MAX_TIMEOUT_MS;
    }

    await member.timeout(duration, `${reason} (par ${interaction.user.tag})`);
    addSanction({
      guildId: interaction.guildId,
      userId: member.id,
      moderatorId: interaction.user.id,
      type: 'mute',
      reason,
      expiresAt: Date.now() + duration,
    });

    await logModAction(interaction, { emoji: '🔇', action: 'Mute', target: member.user, reason, duration: formatDuration(duration) });
    return interaction.reply({
      embeds: [successEmbed(interaction, `🔇 **${member.user.tag}** a été mute pour **${formatDuration(duration)}**.\n**Raison :** ${reason}`)],
    });
  },
};
