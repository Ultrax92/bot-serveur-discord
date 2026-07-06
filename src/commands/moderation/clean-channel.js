const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { canManageAdmins } = require('../../core/permissions');
const { logModAction } = require('../../core/logs');
const { errorEmbed, formatDuration, extractId } = require('../../core/utils');

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Salons en cours de purge : évite les purges parallèles et permet à
// l'événement messageDelete de ne pas inonder les logs pendant une purge
const purging = new Set();

// Supprime jusqu'à `limit` messages : bulkDelete par paquets de 100 pour les
// messages récents, suppression une par une pour ceux de plus de 14 jours
// (limite imposée par Discord, c'est ce qui rend la purge longue).
async function runPurge(channel, limit) {
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let beforeId;

  while (scanned < limit) {
    const batch = await channel.messages
      .fetch({ limit: Math.min(100, limit - scanned), before: beforeId })
      .catch(() => null);
    if (!batch || batch.size === 0) break;
    scanned += batch.size;
    beforeId = batch.last().id;

    const bulkDeleted = await channel.bulkDelete(batch, true).catch(() => new Map());
    deleted += bulkDeleted.size;

    // Messages trop vieux pour le bulkDelete : un par un, en douceur pour le rate limit
    const remaining = batch.filter((m) => !bulkDeleted.has(m.id));
    for (const message of remaining.values()) {
      const ok = await message
        .delete()
        .then(() => true)
        .catch(() => false);
      if (ok) deleted++;
      else failed++;
      await sleep(350);
    }
  }

  return { scanned, deleted, failed };
}

module.exports = {
  module: 'moderation',
  purging,
  data: new SlashCommandBuilder()
    .setName('clean-channel')
    .setDescription("[Owner] Supprime tous les messages d'un salon (défaut : salon courant)")
    .addChannelOption((opt) =>
      opt
        .setName('salon')
        .setDescription('Le salon à purger (défaut : salon courant)')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((opt) => opt.setName('salon_id').setDescription('Ou son ID / mention <#…> / lien collé'))
    .addIntegerOption((opt) =>
      opt
        .setName('limite')
        .setDescription('Nombre max de messages à parcourir (défaut 1000, max 10000)')
        .setMinValue(1)
        .setMaxValue(10000),
    ),

  async execute(interaction) {
    if (!canManageAdmins(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Seul le propriétaire peut purger un salon.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Salon cible : salon_id (ID/mention/lien) > salon (sélecteur) > salon courant
    let channel;
    const rawId = interaction.options.getString('salon_id');
    if (rawId) {
      const id = extractId(rawId);
      channel = id && (await interaction.guild.channels.fetch(id).catch(() => null));
      if (!channel) {
        return interaction.reply({
          embeds: [errorEmbed(interaction, `Aucun salon trouvé sur ce serveur pour \`${rawId.slice(0, 100)}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      channel = interaction.options.getChannel('salon') ?? interaction.channel;
    }

    if (!channel?.bulkDelete) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Ce type de salon ne peut pas être purgé.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (purging.has(channel.id)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Une purge est déjà en cours dans ce salon.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const limit = interaction.options.getInteger('limite') ?? 1000;

    // Réponse immédiate (fenêtre de 3s de l'interaction), la purge tourne ensuite
    // en arrière-plan sans limite de temps et poste son rapport à la fin.
    const embedStart = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🧹 Purge lancée en arrière-plan')
      .setDescription(
        [
          `Nettoyage de ${channel} : jusqu'à **${limit}** messages parcourus.`,
          'Le résultat sera posté dans le salon purgé à la fin (les messages de plus de 14 jours se suppriment un par un, ça peut prendre plusieurs minutes selon le volume).',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embedStart], flags: MessageFlags.Ephemeral });

    purging.add(channel.id);
    const startedAt = Date.now();
    runPurge(channel, limit)
      .then(async ({ scanned, deleted, failed }) => {
        await logModAction(interaction, {
          emoji: '🧹',
          action: `Purge de #${channel.name} (${deleted} supprimés / ${scanned} parcourus)`,
        });
        const report = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('🧹 Purge terminée')
          .setDescription(
            [
              `**${deleted}** message(s) supprimé(s) sur **${scanned}** parcouru(s)${failed ? ` — ${failed} échec(s)` : ''}.`,
              `⏱️ Durée : ${formatDuration(Date.now() - startedAt)} · demandé par ${interaction.user}`,
            ].join('\n'),
          );
        await channel.send({ embeds: [report] }).catch(() => {});
      })
      .catch((error) => console.error(`Erreur pendant la purge de #${channel.name} :`, error))
      .finally(() => purging.delete(channel.id));
  },
};
