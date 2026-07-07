const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { schedulePanel } = require('../../core/scheduler');

module.exports = {
  module: 'scheduler',
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Gère les messages programmés récurrents (annonces auto, rappels…)'),

  async execute(interaction) {
    return interaction.reply({ ...schedulePanel(interaction.guild), flags: MessageFlags.Ephemeral });
  },
};
