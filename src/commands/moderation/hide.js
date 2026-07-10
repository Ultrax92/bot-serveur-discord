const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { successEmbed, restrictChannel } = require('../../core/utils');

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

    // Rôle-conscient : les rôles qui voient le salon sont aussi cachés, sinon leur
    // allow ViewChannel écraserait le deny de @everyone et le salon resterait visible
    await restrictChannel(channel, ['ViewChannel'], hide, {
      reason: `Salon ${hide ? 'caché' : 'affiché'} par ${interaction.user.tag}`,
    });

    return interaction.reply({
      embeds: [
        successEmbed(interaction, hide ? `🙈 ${channel} a été caché.` : `👁️ ${channel} est de nouveau visible.`),
      ],
    });
  },
};
