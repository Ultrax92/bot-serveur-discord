const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../core/db');
const { getSettings } = require('../../core/settings');

const DAY_MS = 24 * 60 * 60 * 1000;

const openedStmt = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND created_at >= ?');
const closedStmt = db.prepare(
  "SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'closed' AND COALESCE(closed_at, created_at) >= ?",
);
const openNowStmt = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'open'");
const byTypeStmt = db.prepare(
  'SELECT type_id, COUNT(*) AS c FROM tickets WHERE guild_id = ? AND created_at >= ? GROUP BY type_id ORDER BY c DESC',
);
const byStaffStmt = db.prepare(
  'SELECT claimed_by, COUNT(*) AS c FROM tickets WHERE guild_id = ? AND created_at >= ? AND claimed_by IS NOT NULL GROUP BY claimed_by ORDER BY c DESC LIMIT 10',
);
const reviewsStmt = db.prepare(
  "SELECT COUNT(*) AS c, AVG(stars) AS avg FROM ticket_reviews WHERE guild_id = ? AND status = 'published' AND created_at >= ?",
);

module.exports = {
  module: 'tickets',
  data: new SlashCommandBuilder()
    .setName('ticket-stats')
    .setDescription('Statistiques des tickets : volume, types, staff, avis clients')
    .addIntegerOption((opt) =>
      opt
        .setName('periode')
        .setDescription('Période analysée (défaut : 30 derniers jours)')
        .addChoices(
          { name: '7 derniers jours', value: 7 },
          { name: '30 derniers jours', value: 30 },
          { name: '90 derniers jours', value: 90 },
          { name: 'Depuis toujours', value: 0 },
        ),
    ),

  async execute(interaction) {
    const days = interaction.options.getInteger('periode') ?? 30;
    const since = days ? Date.now() - days * DAY_MS : 0;
    const guildId = interaction.guildId;

    const opened = openedStmt.get(guildId, since).c;
    const closed = closedStmt.get(guildId, since).c;
    const openNow = openNowStmt.get(guildId).c;
    const byType = byTypeStmt.all(guildId, since);
    const byStaff = byStaffStmt.all(guildId, since);
    const reviews = reviewsStmt.get(guildId, since);

    const types = getSettings(guildId).ticketsConfig.types;
    const typeLabel = (typeId) => {
      const type = types.find((t) => t.id === typeId);
      return type ? `${type.emoji ? `${type.emoji} ` : ''}${type.label}` : '*type supprimé*';
    };

    const embed = new EmbedBuilder()
      .setColor(getSettings(guildId).color)
      .setTitle(`📊 Stats des tickets — ${days ? `${days} derniers jours` : 'depuis toujours'}`)
      .setDescription(
        [
          `🎫 **Ouverts sur la période :** ${opened} — 🔒 **fermés :** ${closed} — 🟢 **encore ouverts :** ${openNow}`,
          '',
          '**Par type :**',
          byType.length
            ? byType.map((r) => `• ${typeLabel(r.type_id)} — **${r.c}**`).join('\n')
            : '*Aucun ticket sur la période.*',
          '',
          '**Par staff (tickets claim) :**',
          byStaff.length
            ? byStaff.map((r, i) => `${['🥇', '🥈', '🥉'][i] ?? '•'} <@${r.claimed_by}> — **${r.c}**`).join('\n')
            : '*Aucun claim sur la période.*',
          '',
          `⭐ **Avis clients publiés :** ${reviews.c}${reviews.c ? ` — moyenne **${reviews.avg.toFixed(2)}/5**` : ''}`,
        ].join('\n'),
      )
      .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
