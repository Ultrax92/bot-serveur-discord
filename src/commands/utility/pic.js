const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../../core/utils');

module.exports = {
  module: 'utility',
  data: new SlashCommandBuilder()
    .setName('pic')
    .setDescription('Affiche la photo de profil ou la bannière de quelqu\'un')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (défaut : toi)'))
    .addStringOption((opt) =>
      opt.setName('type').setDescription('Avatar ou bannière (défaut : avatar)')
        .addChoices({ name: 'Avatar', value: 'avatar' }, { name: 'Bannière', value: 'banner' })),

  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const type = interaction.options.getString('type') ?? 'avatar';

    if (type === 'banner') {
      const fetched = await user.fetch(true);
      if (!fetched.bannerURL()) {
        return interaction.reply({ content: `**${user.tag}** n'a pas de bannière.`, ephemeral: true });
      }
      const embed = baseEmbed(interaction)
        .setTitle(`Bannière de ${user.tag}`)
        .setImage(fetched.bannerURL({ size: 1024 }));
      return interaction.reply({ embeds: [embed] });
    }

    const embed = baseEmbed(interaction)
      .setTitle(`Avatar de ${user.tag}`)
      .setImage(user.displayAvatarURL({ size: 1024 }));
    return interaction.reply({ embeds: [embed] });
  },
};
