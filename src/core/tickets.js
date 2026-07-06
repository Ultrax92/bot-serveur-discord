const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const db = require('./db');

const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');
const { getSettings, isModuleEnabled } = require('./settings');
const { isBotAdminMember } = require('./permissions');
const { sendLog, userAuthor, idLine } = require('./logs');

const countOpenStmt = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'");
// Numérotation de 1 à 9999, puis on repart à 1
const nextNumberStmt = db.prepare('SELECT (COALESCE(MAX(number), 0) % 9999) + 1 AS n FROM tickets WHERE guild_id = ?');
const insertStmt = db.prepare(`
  INSERT INTO tickets (guild_id, channel_id, user_id, number, type_id, created_at, last_activity_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const byChannelStmt = db.prepare('SELECT * FROM tickets WHERE channel_id = ?');
const openByUserStmt = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'");
const openByGuildStmt = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'open'");
const claimStmt = db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?');
const closeStmt = db.prepare("UPDATE tickets SET status = 'closed' WHERE channel_id = ?");
const setActivityStmt = db.prepare('UPDATE tickets SET last_activity_at = ?, warned_at = NULL WHERE channel_id = ?');
const setWarnedStmt = db.prepare('UPDATE tickets SET warned_at = ? WHERE channel_id = ?');

// Le panneau publié : embed + sélecteur des types de tickets
function buildTicketPanel(guild, publisher = null) {
  const settings = getSettings(guild.id);
  const tc = settings.ticketsConfig;

  const embed = new EmbedBuilder()
    .setColor(settings.color)
    .setDescription(tc.panelMessage.slice(0, 4096));
  if (tc.panelTitle) embed.setTitle(tc.panelTitle.slice(0, 256));
  if (publisher) embed.setFooter({ text: publisher.username, iconURL: publisher.displayAvatarURL() });

  const files = [];
  if (tc.panelImage?.startsWith('file:')) {
    const filePath = path.join(imagesDir, tc.panelImage.slice(5));
    if (fs.existsSync(filePath)) {
      files.push(new AttachmentBuilder(filePath));
      embed.setImage(`attachment://${path.basename(filePath)}`);
    }
  } else if (tc.panelImage) {
    embed.setImage(tc.panelImage);
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder('Fais un choix')
    .addOptions(tc.types.map((type) => {
      const option = new StringSelectMenuOptionBuilder()
        .setValue(type.id)
        .setLabel(`${type.emoji ? `${type.emoji} ` : ''}${type.label}`.slice(0, 100));
      if (type.description) option.setDescription(type.description.slice(0, 100));
      return option;
    }));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], files };
}

// Le membre peut-il gérer ce ticket (claim/close des autres) ?
function canManageTicket(member, type) {
  if (isBotAdminMember(member)) return true;
  return (type?.accessRoles ?? []).some((roleId) => member.roles.cache.has(roleId));
}

async function openTicket(interaction) {
  const guild = interaction.guild;
  if (!isModuleEnabled(guild.id, 'tickets')) {
    return interaction.reply({ content: 'Le système de tickets est désactivé.', flags: MessageFlags.Ephemeral });
  }
  const tc = getSettings(guild.id).ticketsConfig;
  const type = tc.types.find((t) => t.id === interaction.values[0]);
  if (!type) {
    return interaction.reply({ content: '⚠️ Ce type de ticket n\'existe plus. Préviens un admin.', flags: MessageFlags.Ephemeral });
  }
  if (tc.requiredRole && !interaction.member.roles.cache.has(tc.requiredRole)) {
    return interaction.reply({ content: `Il te faut le rôle <@&${tc.requiredRole}> pour ouvrir un ticket.`, flags: MessageFlags.Ephemeral });
  }
  if (countOpenStmt.get(guild.id, interaction.user.id).c >= tc.maxPerUser) {
    return interaction.reply({
      content: `Tu as déjà ${tc.maxPerUser > 1 ? `${tc.maxPerUser} tickets ouverts` : 'un ticket ouvert'}. Ferme-le avant d'en ouvrir un autre.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const number = nextNumberStmt.get(guild.id).n;
  const category = type.categoryId && guild.channels.cache.get(type.categoryId);
  const accessRoles = (type.accessRoles ?? []).filter((id) => guild.roles.cache.has(id));

  const channel = await guild.channels.create({
    name: String(number),
    type: ChannelType.GuildText,
    parent: category?.id ?? null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      },
      {
        id: guild.members.me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
      },
      ...accessRoles.map((id) => ({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      })),
    ],
  }).catch(() => null);

  if (!channel) {
    return interaction.editReply('❌ Impossible de créer le salon du ticket (vérifie mes permissions et la catégorie configurée).');
  }

  const createdAt = Date.now();
  insertStmt.run(guild.id, channel.id, interaction.user.id, number, type.id, createdAt, createdAt);

  const mentions = [`${interaction.user}`, ...(type.mentionRoles ?? []).map((id) => `<@&${id}>`)].join(' ');
  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setAuthor(userAuthor(interaction.user))
    .setDescription([
      `🎫 **Ticket ${type.emoji ? `${type.emoji} ` : ''}${type.label}**`,
      '',
      type.openMessage || 'Merci de nous avoir contactés, précise ce que tu souhaites.',
    ].join('\n'))
    .setTimestamp();
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('🙋 Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
  );
  await channel.send({ content: mentions, embeds: [embed], components: [buttons] }).catch(() => {});

  const logEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor(userAuthor(interaction.user))
    .setDescription([
      `🎫 **Ticket ouvert** — ${channel} (n°${number}, ${type.label})`,
      idLine(interaction.user),
    ].join('\n'))
    .setTimestamp();
  await sendLog(guild, 'ticket', logEmbed);

  return interaction.editReply(`🎫 Ton ticket est ouvert : ${channel}`);
}

async function claimTicket(interaction) {
  const row = byChannelStmt.get(interaction.channelId);
  if (!row) {
    return interaction.reply({ content: 'Ce salon n\'est pas un ticket.', flags: MessageFlags.Ephemeral });
  }
  const type = getSettings(interaction.guildId).ticketsConfig.types.find((t) => t.id === row.type_id);
  if (!canManageTicket(interaction.member, type)) {
    return interaction.reply({ content: 'Seul le staff peut claim un ticket.', flags: MessageFlags.Ephemeral });
  }
  if (row.claimed_by) {
    return interaction.reply({ content: `Ce ticket est déjà pris en charge par <@${row.claimed_by}>.`, flags: MessageFlags.Ephemeral });
  }

  claimStmt.run(interaction.user.id, interaction.channelId);
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(`🙋 Ticket pris en charge par ${interaction.user}.`);
  return interaction.reply({ embeds: [embed] });
}

// Génère le transcript texte complet du salon (parcourt tout l'historique)
async function buildTranscript(channel) {
  const lines = [];
  let beforeId;
  // Garde-fou à 20 000 messages pour ne pas bloquer le bot sur un ticket anormal
  for (let i = 0; i < 200; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before: beforeId }).catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const message of batch.values()) {
      const time = new Date(message.createdTimestamp).toLocaleString('fr-FR');
      const attachments = message.attachments.size ? ` [pièces jointes : ${message.attachments.map((a) => a.url).join(' ')}]` : '';
      const embeds = message.embeds.length ? ' [embed]' : '';
      lines.push(`[${time}] ${message.author.tag} : ${message.content}${attachments}${embeds}`);
    }
    beforeId = batch.last().id;
    if (batch.size < 100) break;
  }
  return lines.reverse().join('\n') || 'Aucun message.';
}

// Fermeture générique : transcript, log, MP, suppression du salon.
// reason distingue les fermetures automatiques : 'leave' (membre parti) | 'inactivity'
async function closeTicketChannel(channel, row, closedBy, reason = 'leave') {
  closeStmt.run(channel.id);
  const guild = channel.guild;
  const tc = getSettings(guild.id).ticketsConfig;
  const type = tc.types.find((t) => t.id === row.type_id);

  const transcript = await buildTranscript(channel);
  const makeFile = () => new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `transcript-ticket-${row.number}.txt` });

  const logEmbed = new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription([
      `🔒 **Ticket fermé** — n°${row.number}${type ? ` (${type.label})` : ''}`,
      `**Ouvert par :** <@${row.user_id}> · \`${row.user_id}\``,
      `**Fermé par :** ${closedBy ? `${closedBy} · \`${closedBy.id}\`` : reason === 'inactivity' ? 'automatique (inactivité)' : 'automatique (membre parti)'}`,
      row.claimed_by ? `**Pris en charge par :** <@${row.claimed_by}>` : null,
    ].filter(Boolean).join('\n'))
    .setTimestamp();

  const logChannelId = getSettings(guild.id).logsChannels.ticket;
  const logChannel = logChannelId && guild.channels.cache.get(logChannelId);
  if (logChannel) await logChannel.send({ embeds: [logEmbed], files: [makeFile()] }).catch(() => {});

  if (tc.transcriptDM) {
    const opener = await guild.client.users.fetch(row.user_id).catch(() => null);
    if (opener) {
      await opener.send({
        content: `🔒 Ton ticket n°${row.number} sur **${guild.name}** a été fermé. Voici le transcript :`,
        files: [makeFile()],
      }).catch(() => {});
    }
  }

  // Notation du ticket : demande d'avis en MP (ou avis 5⭐ auto si le membre est parti).
  // Fermé pour inactivité = le membre est encore là : il reçoit la demande d'avis normale.
  // Le transcript est conservé avec l'avis : le salon n'existera plus au moment de la validation.
  const { requestReview } = require('./ticketReviews');
  const reviewCloser = closedBy ?? (reason === 'inactivity' ? guild.client.user : null);
  await requestReview(guild, row, reviewCloser, transcript).catch((error) => console.error('[reviews] Erreur demande d\'avis :', error));

  await channel.delete('Ticket fermé').catch(() => {});
}

async function closeTicket(interaction) {
  const row = byChannelStmt.get(interaction.channelId);
  if (!row || row.status !== 'open') {
    return interaction.reply({ content: 'Ce salon n\'est pas un ticket ouvert.', flags: MessageFlags.Ephemeral });
  }
  const type = getSettings(interaction.guildId).ticketsConfig.types.find((t) => t.id === row.type_id);
  const isOpener = interaction.user.id === row.user_id;
  if (!isOpener && !canManageTicket(interaction.member, type)) {
    return interaction.reply({ content: 'Seuls l\'ouvreur du ticket et le staff peuvent le fermer.', flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({ content: '🔒 Fermeture du ticket : génération du transcript…' });
  await closeTicketChannel(interaction.channel, row, interaction.user);
}

// Ferme les tickets ouverts d'un membre qui quitte le serveur (si activé)
async function closeTicketsForMember(member) {
  if (!isModuleEnabled(member.guild.id, 'tickets')) return;
  if (!getSettings(member.guild.id).ticketsConfig.closeOnLeave) return;
  for (const row of openByUserStmt.all(member.guild.id, member.id)) {
    const channel = member.guild.channels.cache.get(row.channel_id);
    if (channel) await closeTicketChannel(channel, row, null).catch(() => {});
    else closeStmt.run(row.channel_id);
  }
}

async function handleTicketComponent(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'open') return openTicket(interaction);
  if (action === 'claim') return claimTicket(interaction);
  if (action === 'close') return closeTicket(interaction);
}

// ── Fermeture automatique des tickets inactifs ────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Seuls les messages de l'OUVREUR comptent comme activité : un staff qui relance
// sans réponse ne prolonge pas le ticket. Un message de l'ouvreur remet le
// compteur à zéro et annule l'avertissement en cours.
function trackTicketActivity(message) {
  if (!message.inGuild() || message.author.bot) return;
  const row = byChannelStmt.get(message.channelId);
  if (!row || row.status !== 'open' || row.user_id !== message.author.id) return;
  setActivityStmt.run(Date.now(), message.channelId);
}

// Avertissement avec mention à X-1 jours d'inactivité, fermeture 24 h plus tard
// sans réponse (X = ticketsConfig.autoCloseDays, 0 = désactivé)
function startTicketInactivityWorker(client) {
  const tick = async () => {
    const now = Date.now();
    for (const guild of client.guilds.cache.values()) {
      if (!isModuleEnabled(guild.id, 'tickets')) continue;
      const days = getSettings(guild.id).ticketsConfig.autoCloseDays;
      if (!days || days < 2) continue;

      for (const row of openByGuildStmt.all(guild.id)) {
        // Tickets d'avant la mise à jour : leur compteur démarre maintenant
        if (!row.last_activity_at) {
          setActivityStmt.run(now, row.channel_id);
          continue;
        }
        const channel = guild.channels.cache.get(row.channel_id);
        if (!channel) {
          closeStmt.run(row.channel_id); // salon supprimé à la main
          continue;
        }
        if (row.warned_at) {
          if (now - row.warned_at >= DAY_MS) {
            await closeTicketChannel(channel, row, null, 'inactivity').catch(() => {});
          }
        } else if (now - row.last_activity_at >= (days - 1) * DAY_MS) {
          const embed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setDescription([
              `⏰ **Ce ticket est inactif depuis ${days - 1} jour${days - 1 > 1 ? 's' : ''}.**`,
              `Sans message de <@${row.user_id}> dans les **24 heures**, il sera fermé automatiquement.`,
            ].join('\n'));
          const warning = await channel.send({ content: `<@${row.user_id}>`, embeds: [embed] }).catch(() => null);
          if (warning) setWarnedStmt.run(now, row.channel_id);
        }
      }
    }
  };
  tick().catch((error) => console.error('[tickets] Erreur fermeture auto :', error));
  setInterval(() => tick().catch((error) => console.error('[tickets] Erreur fermeture auto :', error)), 60 * 60 * 1000);
}

// Le salon est-il un ticket ouvert ? (utilisé par l'automod pour exempter les tickets)
function isOpenTicketChannel(channelId) {
  const row = byChannelStmt.get(channelId);
  return Boolean(row && row.status === 'open');
}

function getTicketByChannel(channelId) {
  return byChannelStmt.get(channelId);
}

function setClaim(channelId, userId) {
  claimStmt.run(userId, channelId);
}

module.exports = {
  buildTicketPanel, handleTicketComponent, closeTicketsForMember,
  closeTicket, closeTicketChannel, canManageTicket, isOpenTicketChannel, getTicketByChannel, setClaim,
  trackTicketActivity, startTicketInactivityWorker,
};
