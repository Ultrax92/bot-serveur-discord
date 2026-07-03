const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { successEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouille ou déverrouille un salon')
    .addSubcommand((sub) =>
      sub.setName('on')
        .setDescription('Verrouille un salon (personne ne peut plus écrire)')
        .addChannelOption((opt) =>
          opt.setName('salon').setDescription('Le salon à verrouiller (défaut : salon actuel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)))
    .addSubcommand((sub) =>
      sub.setName('off')
        .setDescription('Déverrouille un salon')
        .addChannelOption((opt) =>
          opt.setName('salon').setDescription('Le salon à déverrouiller (défaut : salon actuel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    const everyone = interaction.guild.roles.everyone;
    const lock = sub === 'on';

    if (channel.type === ChannelType.GuildVoice) {
      await channel.permissionOverwrites.edit(everyone, { Connect: lock ? false : null, Speak: lock ? false : null });
    } else {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: lock ? false : null });
    }

    return interaction.reply({
      embeds: [successEmbed(interaction.guildId, lock ? `🔒 ${channel} a été verrouillé.` : `🔓 ${channel} a été déverrouillé.`)],
    });
  },
};
