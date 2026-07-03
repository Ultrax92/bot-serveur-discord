const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../../core/utils');

module.exports = {
  module: 'utility',
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Affiche les informations d\'un utilisateur')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (défaut : toi)')),

  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const member = interaction.options.getMember('membre') ?? interaction.member;

    const embed = baseEmbed(interaction)
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🆔 ID', value: user.id, inline: true },
        { name: '🤖 Bot', value: user.bot ? 'Oui' : 'Non', inline: true },
        { name: '📅 Compte créé', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      );

    if (member) {
      const roles = member.roles.cache
        .filter((r) => r.id !== interaction.guild.roles.everyone.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => `${r}`)
        .slice(0, 15);
      embed.addFields(
        { name: '📥 A rejoint', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu', inline: true },
        { name: `🎭 Rôles (${roles.length})`, value: roles.join(' ') || 'Aucun', inline: false },
      );
    }

    return interaction.reply({ embeds: [embed] });
  },
};
