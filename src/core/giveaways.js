const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('./db');
const { getSettings, updateSettings } = require('./settings');
const { isBotAdmin } = require('./permissions');
const { parseDuration } = require('./utils');

const insertStmt = db.prepare(`
  INSERT INTO giveaways (guild_id, channel_id, prize, winners, host_id, required_role, ends_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const byIdStmt = db.prepare('SELECT * FROM giveaways WHERE id = ?');
const setMessageStmt = db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?');
const setParticipantsStmt = db.prepare('UPDATE giveaways SET participants = ? WHERE id = ?');
const markEndedStmt = db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?');
const dueStmt = db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?');
const activeOfGuildStmt = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at');

const participantsOf = (row) => JSON.parse(row.participants);

function buildActiveEmbed(row, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎉 ${row.prize}`)
    .setDescription(
      [
        'Clique sur le bouton 🎉 pour participer (re-clique pour te retirer) !',
        '',
        `🏆 **Gagnants :** ${row.winners}`,
        `⏰ **Fin :** <t:${Math.floor(row.ends_at / 1000)}:R> (<t:${Math.floor(row.ends_at / 1000)}:f>)`,
        `👥 **Participants :** ${participantsOf(row).length}`,
        row.required_role ? `🎭 **Réservé à :** <@&${row.required_role}>` : null,
        `🎤 **Organisé par :** <@${row.host_id}>`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setTimestamp(row.ends_at);
}

function activeButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw:join:${id}`)
      .setLabel('Participer')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`gw:end:${id}`).setLabel('Terminer').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
  );
}

function buildEndedEmbed(row, winnerIds) {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setTitle(`🏁 ${row.prize}`)
    .setDescription(
      [
        '**Giveaway terminé !**',
        '',
        `🏆 **Gagnant(s) :** ${winnerIds.length ? winnerIds.map((id) => `<@${id}>`).join(' ') : '*aucun participant* 😢'}`,
        `👥 **Participants :** ${participantsOf(row).length}`,
        `🎤 **Organisé par :** <@${row.host_id}>`,
      ].join('\n'),
    )
    .setTimestamp();
}

function pickWinners(list, count) {
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

async function createGiveaway(interaction, { prize, durationMs, winners }) {
  const settings = getSettings(interaction.guildId);
  const info = insertStmt.run(
    interaction.guildId,
    interaction.channelId,
    prize,
    winners,
    interaction.user.id,
    settings.giveawaysConfig.requiredRole,
    Date.now() + durationMs,
  );
  const row = byIdStmt.get(info.lastInsertRowid);

  const message = await interaction.channel
    .send({
      embeds: [buildActiveEmbed(row, settings.color)],
      components: [activeButtons(row.id)],
    })
    .catch(() => null);
  if (!message) return null;

  setMessageStmt.run(message.id, row.id);
  updateSettings(interaction.guildId, (s) => {
    s.modules.giveaways = true;
  });
  return message;
}

async function endGiveaway(client, row, { reroll = false } = {}) {
  if (!reroll) markEndedStmt.run(row.id);
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel) return;

  const winnerIds = pickWinners(participantsOf(row), row.winners);

  if (!reroll && row.message_id) {
    const message = await channel.messages.fetch(row.message_id).catch(() => null);
    if (message) {
      const rerollRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`gw:reroll:${row.id}`)
          .setLabel('Reroll')
          .setEmoji('🔁')
          .setStyle(ButtonStyle.Secondary),
      );
      await message.edit({ embeds: [buildEndedEmbed(row, winnerIds)], components: [rerollRow] }).catch(() => {});
    }
  }

  if (winnerIds.length) {
    await channel
      .send(
        `🎉 ${reroll ? '**Reroll !** Nouveau tirage : félicitations' : 'Félicitations'} ${winnerIds.map((id) => `<@${id}>`).join(' ')} ! ` +
          `Vous remportez **${row.prize}** ! (organisé par <@${row.host_id}>)`,
      )
      .catch(() => {});
  } else {
    await channel.send(`😢 Personne n'a participé au giveaway **${row.prize}**, pas de gagnant.`).catch(() => {});
  }
}

async function handleJoin(interaction, row) {
  if (row.ended) {
    return interaction.reply({ content: 'Ce giveaway est terminé.', flags: MessageFlags.Ephemeral });
  }
  const list = participantsOf(row);
  const index = list.indexOf(interaction.user.id);

  if (index !== -1) {
    list.splice(index, 1);
    setParticipantsStmt.run(JSON.stringify(list), row.id);
  } else {
    if (row.required_role && !interaction.member.roles.cache.has(row.required_role)) {
      return interaction.reply({
        content: `Ce giveaway est réservé aux membres avec le rôle <@&${row.required_role}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    list.push(interaction.user.id);
    setParticipantsStmt.run(JSON.stringify(list), row.id);
  }

  const updated = byIdStmt.get(row.id);
  await interaction.message
    .edit({ embeds: [buildActiveEmbed(updated, getSettings(interaction.guildId).color)] })
    .catch(() => {});
  return interaction.reply({
    content: index !== -1 ? 'Ta participation a été retirée.' : '🎉 Participation enregistrée, bonne chance !',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleGiveawayComponent(interaction) {
  const [, action, id] = interaction.customId.split(':');

  // Formulaire de création (ouvert par /giveaway)
  if (action === 'create' && interaction.isModalSubmit()) {
    if (!isBotAdmin(interaction)) return;
    const prize = interaction.fields.getTextInputValue('prize').trim();
    const durationMs = parseDuration(interaction.fields.getTextInputValue('duration').trim());
    const winners = parseInt(interaction.fields.getTextInputValue('winners').trim(), 10);
    if (!durationMs || durationMs < 60_000) {
      return interaction.reply({
        content: '❌ Durée invalide (1 minute minimum). Exemples : `30m`, `2h`, `3j`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!Number.isInteger(winners) || winners < 1 || winners > 20) {
      return interaction.reply({ content: '❌ Nombre de gagnants invalide (1 à 20).', flags: MessageFlags.Ephemeral });
    }
    const message = await createGiveaway(interaction, { prize, durationMs, winners });
    return interaction.reply({
      content: message
        ? '🎉 Giveaway lancé dans ce salon !'
        : '❌ Impossible de publier le giveaway (vérifie mes permissions).',
      flags: MessageFlags.Ephemeral,
    });
  }

  const row = byIdStmt.get(id);
  if (!row) {
    return interaction.reply({ content: "Ce giveaway n'existe plus.", flags: MessageFlags.Ephemeral });
  }

  if (action === 'join') return handleJoin(interaction, row);

  if (action === 'end') {
    if (!isBotAdmin(interaction)) {
      return interaction.reply({
        content: 'Seuls les admins du bot peuvent terminer un giveaway.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (row.ended) {
      return interaction.reply({ content: 'Ce giveaway est déjà terminé.', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({
      content: '⏹️ Giveaway terminé en avance, tirage en cours…',
      flags: MessageFlags.Ephemeral,
    });
    return endGiveaway(interaction.client, row);
  }

  if (action === 'reroll') {
    if (!isBotAdmin(interaction)) {
      return interaction.reply({
        content: 'Seuls les admins du bot peuvent reroll un giveaway.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!row.ended) {
      return interaction.reply({ content: "Ce giveaway n'est pas encore terminé.", flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: '🔁 Nouveau tirage en cours…', flags: MessageFlags.Ephemeral });
    return endGiveaway(interaction.client, row, { reroll: true });
  }
}

// Worker : termine les giveaways arrivés à échéance (survit aux redémarrages)
function startGiveawayWorker(client) {
  setInterval(async () => {
    for (const row of dueStmt.all(Date.now())) {
      await endGiveaway(client, row).catch((error) => console.error('Erreur fin de giveaway :', error));
    }
  }, 15_000);
}

function activeGiveaways(guildId) {
  return activeOfGuildStmt.all(guildId);
}

module.exports = { createGiveaway, handleGiveawayComponent, startGiveawayWorker, activeGiveaways };
