const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { logModAction } = require('../../core/logs');
const { successEmbed, errorEmbed } = require('../../core/utils');

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprime des messages dans le salon actuel')
    .addIntegerOption((opt) =>
      opt.setName('nombre').setDescription('Nombre de messages à supprimer (1 à 100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((opt) => opt.setName('membre').setDescription('Ne supprimer que les messages de ce membre')),

  async execute(interaction) {
    const amount = interaction.options.getInteger('nombre');
    const target = interaction.options.getUser('membre');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let deleted = 0;
    if (target) {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const targetMessages = [...messages.filter((m) => m.author.id === target.id).values()].slice(0, amount);
      const result = await interaction.channel.bulkDelete(targetMessages, true);
      deleted = result.size;
    } else {
      const result = await interaction.channel.bulkDelete(amount, true);
      deleted = result.size;
    }

    if (deleted === 0) {
      return interaction.editReply({ embeds: [errorEmbed(interaction.guildId, 'Aucun message supprimé (les messages de plus de 14 jours ne peuvent pas être supprimés en masse).')] });
    }
    await logModAction(interaction, {
      emoji: '🧹',
      action: `Clear (${deleted} messages dans #${interaction.channel.name})`,
      target: target ?? null,
    });
    return interaction.editReply({
      embeds: [successEmbed(interaction.guildId, `🧹 **${deleted}** message(s) supprimé(s)${target ? ` de **${target.tag}**` : ''}.`)],
    });
  },
};
