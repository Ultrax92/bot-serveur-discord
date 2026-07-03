const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { successEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouille ou déverrouille un salon')
    .addStringOption((opt) =>
      opt.setName('action').setDescription('L\'action à effectuer').setRequired(true)
        .addChoices(
          { name: '🔒 Verrouiller', value: 'on' },
          { name: '🔓 Déverrouiller', value: 'off' },
        ))
    .addChannelOption((opt) =>
      opt.setName('salon').setDescription('Le salon concerné (défaut : salon actuel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)),

  async execute(interaction) {
    const lock = interaction.options.getString('action') === 'on';
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    const everyone = interaction.guild.roles.everyone;

    if (channel.type === ChannelType.GuildVoice) {
      await channel.permissionOverwrites.edit(everyone, { Connect: lock ? false : null, Speak: lock ? false : null });
    } else {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: lock ? false : null });
    }

    return interaction.reply({
      embeds: [successEmbed(interaction, lock ? `🔒 ${channel} a été verrouillé.` : `🔓 ${channel} a été déverrouillé.`)],
    });
  },
};
