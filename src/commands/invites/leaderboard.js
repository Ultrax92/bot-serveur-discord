const { SlashCommandBuilder } = require('discord.js');
const { leaderboard } = require('../../core/invites');
const { baseEmbed } = require('../../core/utils');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  module: 'invites',
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Classement des inviteurs du serveur'),

  async execute(interaction) {
    const rows = leaderboard(interaction.guildId);
    const embed = baseEmbed(interaction).setTitle(`📨 Top inviteurs de ${interaction.guild.name}`);

    if (!rows.length) {
      embed.setDescription("Aucune invitation trackée pour l'instant. Le suivi démarre à l'activation du module 📨.");
    } else {
      embed.setDescription(
        rows
          .map(
            (row, index) =>
              `${MEDALS[index] ?? `**${index + 1}.**`} <@${row.inviter_id}> — **${row.active}** invitation(s)` +
              `${row.leaves ? ` · 📤 ${row.leaves} parti(s)` : ''}${row.fakes ? ` · ⚠️ ${row.fakes} suspecte(s)` : ''}`,
          )
          .join('\n'),
      );
    }
    return interaction.reply({ embeds: [embed] });
  },
};
