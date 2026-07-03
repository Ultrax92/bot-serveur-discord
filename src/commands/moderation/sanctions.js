const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getSanctions, deleteSanction, clearSanctions } = require('../../core/sanctions');
const { baseEmbed, successEmbed, errorEmbed } = require('../../core/utils');

const TYPE_EMOJI = { warn: '⚠️', mute: '🔇', kick: '👢', ban: '🔨' };

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('sanctions')
    .setDescription('Gère les sanctions des membres')
    .addSubcommand((sub) =>
      sub.setName('voir')
        .setDescription('Affiche les sanctions d\'un membre')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre concerné').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('supprimer')
        .setDescription('Supprime une sanction par son numéro')
        .addIntegerOption((opt) => opt.setName('numéro').setDescription('Le numéro de la sanction (visible dans /sanctions voir)').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('reset')
        .setDescription('Supprime toutes les sanctions d\'un membre')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre concerné').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const user = interaction.options.getUser('membre');
      const sanctions = getSanctions(interaction.guildId, user.id);
      if (sanctions.length === 0) {
        return interaction.reply({ embeds: [successEmbed(interaction.guildId, `**${user.tag}** n'a aucune sanction. 🎉`)] });
      }
      const lines = sanctions.slice(0, 20).map((s) =>
        `\`#${s.id}\` ${TYPE_EMOJI[s.type] ?? ''} **${s.type}** — <t:${Math.floor(s.created_at / 1000)}:R> par <@${s.moderator_id}>\n> ${s.reason ?? 'Aucune raison'}`);
      const embed = baseEmbed(interaction.guildId)
        .setTitle(`Sanctions de ${user.tag} (${sanctions.length})`)
        .setDescription(lines.join('\n'))
        .setThumbnail(user.displayAvatarURL());
      if (sanctions.length > 20) embed.setFooter({ text: `… et ${sanctions.length - 20} autres` });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'supprimer') {
      const id = interaction.options.getInteger('numéro');
      const ok = deleteSanction(interaction.guildId, id);
      if (!ok) {
        return interaction.reply({ embeds: [errorEmbed(interaction.guildId, `Aucune sanction \`#${id}\` sur ce serveur.`)], flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ embeds: [successEmbed(interaction.guildId, `Sanction \`#${id}\` supprimée.`)] });
    }

    if (sub === 'reset') {
      const user = interaction.options.getUser('membre');
      const count = clearSanctions(interaction.guildId, user.id);
      return interaction.reply({ embeds: [successEmbed(interaction.guildId, `**${count}** sanction(s) de **${user.tag}** supprimée(s).`)] });
    }
  },
};
