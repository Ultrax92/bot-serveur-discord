const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getSettings } = require('../../core/settings');
const { getTicketByChannel, canManageTicket } = require('../../core/tickets');
const { successEmbed, errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'tickets',
  // Accessible sans être admin du bot : la commande vérifie elle-même que l'on
  // est dans un ticket et que l'on est l'ouvreur ou le staff
  public: true,
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Ajoute un membre au ticket actuel')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à ajouter (mention ou ID)').setRequired(true)),

  async execute(interaction) {
    const row = getTicketByChannel(interaction.channelId);
    if (!row || row.status !== 'open') {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Cette commande ne fonctionne que dans un ticket ouvert.')], flags: MessageFlags.Ephemeral });
    }

    const type = getSettings(interaction.guildId).ticketsConfig.types.find((t) => t.id === row.type_id);
    const isOpener = interaction.user.id === row.user_id;
    if (!isOpener && !canManageTicket(interaction.member, type)) {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Seuls l\'ouvreur du ticket et le staff peuvent ajouter un membre.')], flags: MessageFlags.Ephemeral });
    }

    const member = interaction.options.getMember('membre');
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Membre introuvable sur ce serveur.')], flags: MessageFlags.Ephemeral });
    }
    if (member.user.bot) {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Impossible d\'ajouter un bot au ticket.')], flags: MessageFlags.Ephemeral });
    }

    await interaction.channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    }, { reason: `Ajouté au ticket par ${interaction.user.tag}` });

    return interaction.reply({ embeds: [successEmbed(interaction, `${member} a été ajouté au ticket.`)] });
  },
};
