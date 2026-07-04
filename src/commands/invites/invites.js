const { SlashCommandBuilder } = require('discord.js');
const { getStats } = require('../../core/invites');
const { baseEmbed } = require('../../core/utils');

module.exports = {
  module: 'invites',
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Affiche les invitations d\'un membre')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (défaut : toi)')),

  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const stats = getStats(interaction.guildId, user.id);

    const embed = baseEmbed(interaction)
      .setTitle(`📨 Invitations de ${user.username}`)
      .setThumbnail(user.displayAvatarURL())
      .setDescription([
        `✅ **${stats.active}** invitation(s) active(s)`,
        `📤 **${stats.leaves}** parti(s)`,
        `⚠️ **${stats.fakes}** suspecte(s) (comptes récents)`,
      ].join('\n'));
    return interaction.reply({ embeds: [embed] });
  },
};
