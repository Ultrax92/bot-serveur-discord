const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { successEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('hide')
    .setDescription('Cache ou affiche un salon')
    .addSubcommand((sub) =>
      sub.setName('on')
        .setDescription('Cache un salon pour tout le monde')
        .addChannelOption((opt) =>
          opt.setName('salon').setDescription('Le salon à cacher (défaut : salon actuel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)))
    .addSubcommand((sub) =>
      sub.setName('off')
        .setDescription('Ré-affiche un salon caché')
        .addChannelOption((opt) =>
          opt.setName('salon').setDescription('Le salon à ré-afficher (défaut : salon actuel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    const hide = sub === 'on';

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: hide ? false : null });

    return interaction.reply({
      embeds: [successEmbed(interaction, hide ? `🙈 ${channel} a été caché.` : `👁️ ${channel} est de nouveau visible.`)],
    });
  },
};
