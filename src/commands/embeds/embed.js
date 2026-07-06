const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { getSession, builderView } = require('../../core/embedBuilder');

module.exports = {
  module: 'core',
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Crée un embed avec aperçu privé, puis publie-le où tu veux')
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Salon de destination (défaut : salon courant)')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addUserOption((opt) => opt.setName('mp').setDescription("Envoyer en MP à ce membre au lieu d'un salon"))
    .addRoleOption((opt) =>
      opt.setName('mp_role').setDescription('Envoyer en MP à TOUS les membres de ce rôle (confirmation avant envoi)'),
    ),

  async execute(interaction) {
    const session = getSession(interaction.guildId, interaction.user.id);
    session.target = {
      channelId: interaction.options.getChannel('salon')?.id ?? null,
      userId: interaction.options.getUser('mp')?.id ?? null,
      roleId: interaction.options.getRole('mp_role')?.id ?? null,
    };
    return interaction.reply({ ...builderView(interaction.guild, interaction.user.id), flags: MessageFlags.Ephemeral });
  },
};
