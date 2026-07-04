const { SlashCommandBuilder } = require('discord.js');
const { closeTicket } = require('../../core/tickets');

module.exports = {
  module: 'tickets',
  // Accessible sans être admin du bot : la commande vérifie elle-même que l'on
  // est dans un ticket et que l'on est l'ouvreur ou le staff
  public: true,
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Ferme le ticket actuel (transcript puis suppression du salon)'),

  async execute(interaction) {
    return closeTicket(interaction);
  },
};
