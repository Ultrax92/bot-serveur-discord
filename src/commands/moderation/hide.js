const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { successEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('hide')
    .setDescription('Cache ou ré-affiche un salon')
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription("L'action à effectuer")
        .setRequired(true)
        .addChoices({ name: '🙈 Cacher', value: 'on' }, { name: '👁️ Afficher', value: 'off' }),
    )
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon concerné (défaut : salon actuel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
    ),

  async execute(interaction) {
    const hide = interaction.options.getString('action') === 'on';
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: hide ? false : null });

    return interaction.reply({
      embeds: [
        successEmbed(interaction, hide ? `🙈 ${channel} a été caché.` : `👁️ ${channel} est de nouveau visible.`),
      ],
    });
  },
};
