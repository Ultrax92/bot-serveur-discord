const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  module: 'giveaways',
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Lance un giveaway dans ce salon'),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('gw:create')
      .setTitle('Nouveau giveaway')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('prize').setLabel('Lot à gagner')
            .setPlaceholder('Nitro 1 mois').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('duration').setLabel('Durée (ex: 30m, 2h, 3j)')
            .setPlaceholder('1j').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('winners').setLabel('Nombre de gagnants (1 à 20)')
            .setValue('1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
        ),
      );
    return interaction.showModal(modal);
  },
};
