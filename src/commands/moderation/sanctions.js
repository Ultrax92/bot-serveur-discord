const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getSanctions, deleteSanction, clearSanctions } = require('../../core/sanctions');
const { baseEmbed, successEmbed, errorEmbed } = require('../../core/utils');

const TYPE_EMOJI = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🔨' };

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('sanctions')
    .setDescription('Gère les sanctions des membres')
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription("L'action à effectuer")
        .setRequired(true)
        .addChoices(
          { name: "📋 Voir le casier d'un membre", value: 'voir' },
          { name: '🗑️ Supprimer une sanction (par numéro)', value: 'supprimer' },
          { name: "♻️ Reset le casier d'un membre", value: 'reset' },
        ),
    )
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (requis pour voir/reset)'))
    .addIntegerOption((opt) =>
      opt.setName('numéro').setDescription('Le numéro de la sanction (requis pour supprimer)'),
    ),

  async execute(interaction) {
    const action = interaction.options.getString('action');
    const user = interaction.options.getUser('membre');
    const id = interaction.options.getInteger('numéro');

    if (action === 'voir') {
      if (!user) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, 'Précise le membre dont tu veux voir le casier.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const sanctions = getSanctions(interaction.guildId, user.id);
      if (sanctions.length === 0) {
        return interaction.reply({ embeds: [successEmbed(interaction, `**${user.tag}** n'a aucune sanction. 🎉`)] });
      }
      const lines = sanctions
        .slice(0, 20)
        .map(
          (s) =>
            `\`#${s.id}\` ${TYPE_EMOJI[s.type] ?? ''} **${s.type}** — <t:${Math.floor(s.created_at / 1000)}:R> par <@${s.moderator_id}>\n> ${s.reason ?? 'Aucune raison'}`,
        );
      const embed = baseEmbed(interaction)
        .setTitle(`Sanctions de ${user.tag} (${sanctions.length})`)
        .setDescription(lines.join('\n'))
        .setThumbnail(user.displayAvatarURL());
      if (sanctions.length > 20) embed.setFooter({ text: `… et ${sanctions.length - 20} autres` });
      return interaction.reply({ embeds: [embed] });
    }

    if (action === 'supprimer') {
      if (!id) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, 'Précise le numéro de la sanction (visible dans le casier).')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const ok = deleteSanction(interaction.guildId, id);
      if (!ok) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, `Aucune sanction \`#${id}\` sur ce serveur.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({ embeds: [successEmbed(interaction, `Sanction \`#${id}\` supprimée.`)] });
    }

    if (action === 'reset') {
      if (!user) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, 'Précise le membre dont tu veux reset le casier.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const count = clearSanctions(interaction.guildId, user.id);
      return interaction.reply({
        embeds: [successEmbed(interaction, `**${count}** sanction(s) de **${user.tag}** supprimée(s).`)],
      });
    }
  },
};
