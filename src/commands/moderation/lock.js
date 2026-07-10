const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { successEmbed, restrictChannel } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouille ou déverrouille un salon')
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription("L'action à effectuer")
        .setRequired(true)
        .addChoices({ name: '🔒 Verrouiller', value: 'on' }, { name: '🔓 Déverrouiller', value: 'off' }),
    )
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon concerné (défaut : salon actuel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
    ),

  async execute(interaction) {
    const lock = interaction.options.getString('action') === 'on';
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;

    // Rôle-conscient : les rôles autorisés (ex. « membre ») sont aussi restreints,
    // sinon leur allow écraserait le deny de @everyone et le verrou n'aurait aucun effet
    const permNames = channel.type === ChannelType.GuildVoice ? ['Connect', 'Speak'] : ['SendMessages'];
    await restrictChannel(channel, permNames, lock, {
      reason: `Salon ${lock ? 'verrouillé' : 'déverrouillé'} par ${interaction.user.tag}`,
    });

    return interaction.reply({
      embeds: [
        successEmbed(interaction, lock ? `🔒 ${channel} a été verrouillé.` : `🔓 ${channel} a été déverrouillé.`),
      ],
    });
  },
};
