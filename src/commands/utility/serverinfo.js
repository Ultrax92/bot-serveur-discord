const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { baseEmbed } = require('../../core/utils');

module.exports = {
  module: 'utility',
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur'),

  async execute(interaction) {
    const { guild } = interaction;
    const owner = await guild.fetchOwner();
    const channels = guild.channels.cache;

    const embed = baseEmbed(interaction)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: '👑 Propriétaire', value: `${owner.user}`, inline: true },
        { name: '🆔 ID', value: guild.id, inline: true },
        { name: '📅 Créé le', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
        { name: '👥 Membres', value: `${guild.memberCount}`, inline: true },
        {
          name: '💬 Salons',
          value: `${channels.filter((c) => c.type === ChannelType.GuildText).size} textuels · ${channels.filter((c) => c.type === ChannelType.GuildVoice).size} vocaux`,
          inline: true,
        },
        { name: '🎭 Rôles', value: `${guild.roles.cache.size}`, inline: true },
        { name: '😀 Émojis', value: `${guild.emojis.cache.size}`, inline: true },
        {
          name: '🚀 Boosts',
          value: `${guild.premiumSubscriptionCount ?? 0} (niveau ${guild.premiumTier})`,
          inline: true,
        },
        { name: '🔒 Vérification', value: `${guild.verificationLevel}`, inline: true },
      );
    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));

    return interaction.reply({ embeds: [embed] });
  },
};
