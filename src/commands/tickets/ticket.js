const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getSettings } = require('../../core/settings');
const { getTicketByChannel, canManageTicket, closeTicketChannel, setClaim } = require('../../core/tickets');
const { successEmbed, errorEmbed, extractId } = require('../../core/utils');

module.exports = {
  module: 'tickets',
  // Accessible sans être admin du bot : la commande vérifie elle-même que la
  // cible est un ticket et que l'on est l'ouvreur ou le staff
  public: true,
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gère un ticket (celui où tu es, ou celui indiqué)')
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription("L'action à effectuer")
        .setRequired(true)
        .addChoices(
          { name: '➕ Ajouter un membre', value: 'add' },
          { name: '➖ Retirer un membre', value: 'del' },
          { name: '🙋 Claim', value: 'claim' },
          { name: '🔒 Fermer', value: 'close' },
        ),
    )
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (requis pour ajouter/retirer)'))
    .addStringOption((opt) =>
      opt.setName('ticket').setDescription('ID ou lien du salon ticket (vide = ticket actuel)'),
    ),

  async execute(interaction) {
    const action = interaction.options.getString('action');

    // Ticket ciblé : par ID/lien, sinon le salon courant
    let channel = interaction.channel;
    const rawTicket = interaction.options.getString('ticket');
    if (rawTicket) {
      const id = extractId(rawTicket);
      channel = id && (await interaction.guild.channels.fetch(id).catch(() => null));
      if (!channel) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, `Aucun salon trouvé pour \`${rawTicket.slice(0, 100)}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    const row = getTicketByChannel(channel.id);
    if (!row || row.status !== 'open') {
      return interaction.reply({
        embeds: [errorEmbed(interaction, `${channel} n'est pas un ticket ouvert.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const type = getSettings(interaction.guildId).ticketsConfig.types.find((t) => t.id === row.type_id);
    const isOpener = interaction.user.id === row.user_id;
    const isStaff = canManageTicket(interaction.member, type);
    const remote = channel.id !== interaction.channelId;

    if (action === 'claim') {
      if (!isStaff) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, 'Seul le staff peut claim un ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (row.claimed_by) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, `Ce ticket est déjà pris en charge par <@${row.claimed_by}>.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      setClaim(channel.id, interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`🙋 Ticket pris en charge par ${interaction.user}.`);
      await channel.send({ embeds: [embed] }).catch(() => {});
      return interaction.reply({
        embeds: [successEmbed(interaction, `Tu as claim le ticket ${channel}.`)],
        flags: remote ? MessageFlags.Ephemeral : undefined,
      });
    }

    if (action === 'close') {
      if (!isOpener && !isStaff) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, "Seuls l'ouvreur du ticket et le staff peuvent le fermer.")],
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.reply({
        content: `🔒 Fermeture de ${channel} : génération du transcript…`,
        flags: remote ? MessageFlags.Ephemeral : undefined,
      });
      return closeTicketChannel(channel, row, interaction.user);
    }

    // add / del : membre requis
    const member = interaction.options.getMember('membre');
    if (!member) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Précise le membre à ajouter ou retirer.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!isOpener && !isStaff) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, "Seuls l'ouvreur du ticket et le staff peuvent gérer ses membres.")],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (member.user.bot) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, "Impossible d'ajouter ou retirer un bot.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'add') {
      await channel.permissionOverwrites.edit(
        member.id,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
        },
        { reason: `Ajouté au ticket par ${interaction.user.tag}` },
      );
      return interaction.reply({ embeds: [successEmbed(interaction, `${member} a été ajouté au ticket ${channel}.`)] });
    }

    if (action === 'del') {
      if (member.id === row.user_id) {
        return interaction.reply({
          embeds: [
            errorEmbed(interaction, "Impossible de retirer l'ouvreur de son propre ticket (utilise 🔒 Fermer)."),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      await channel.permissionOverwrites
        .delete(member.id, `Retiré du ticket par ${interaction.user.tag}`)
        .catch(() => {});
      return interaction.reply({ embeds: [successEmbed(interaction, `${member} a été retiré du ticket ${channel}.`)] });
    }
  },
};
