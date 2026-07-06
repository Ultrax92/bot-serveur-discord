const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const db = require('./db');
const { getSettings } = require('./settings');
const { isBotAdminMember, isOwner } = require('./permissions');
const { userAuthor, idLine } = require('./logs');

// Délai laissé au client pour noter, avant l'avis 5⭐ automatique
const REVIEW_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

// Textes génériques des avis 5⭐ automatiques (client parti ou sans réponse sous 7 jours)
const AUTO_REVIEW_TEXTS = [
  'Rien à redire, tout s\'est parfaitement passé. Merci !',
  'Service rapide et efficace, je recommande.',
  'Très bonne expérience, équipe au top.',
  'Nickel du début à la fin, merci à l\'équipe.',
  'Réponse rapide et demande réglée, parfait.',
  'Super service, rien à signaler.',
  'Tout est OK, merci pour la prise en charge.',
  'Efficace et sérieux, comme toujours.',
  'Parfait, je reviendrai sans hésiter.',
  'Prise en charge rapide, très satisfait.',
];

const insertStmt = db.prepare(`
  INSERT INTO ticket_reviews (guild_id, user_id, ticket_number, type_id, type_label, status, stars, comment, auto, deadline, transcript, created_at)
  VALUES (@guild_id, @user_id, @ticket_number, @type_id, @type_label, @status, @stars, @comment, @auto, @deadline, @transcript, @created_at)
`);
const getStmt = db.prepare('SELECT * FROM ticket_reviews WHERE id = ?');
const dueStmt = db.prepare("SELECT * FROM ticket_reviews WHERE status = 'pending' AND deadline IS NOT NULL AND deadline <= ?");
const setDmMessageStmt = db.prepare('UPDATE ticket_reviews SET dm_channel_id = ?, dm_message_id = ? WHERE id = ?');
const setStarsStmt = db.prepare("UPDATE ticket_reviews SET stars = ?, status = 'awaiting' WHERE id = ?");
const setValidationMsgStmt = db.prepare('UPDATE ticket_reviews SET review_channel_id = ?, review_message_id = ? WHERE id = ?');
const setCommentStmt = db.prepare('UPDATE ticket_reviews SET comment = ? WHERE id = ?');
const setStatusStmt = db.prepare('UPDATE ticket_reviews SET status = ? WHERE id = ?');
const publishAutoStmt = db.prepare("UPDATE ticket_reviews SET status = 'published', stars = 5, comment = ?, auto = 1 WHERE id = ?");
// Une fois l'avis traité, le transcript ne sert plus : purgé pour garder la base et les backups légers
const clearTranscriptStmt = db.prepare('UPDATE ticket_reviews SET transcript = NULL WHERE id = ?');

// La notation est active dès qu'un salon de feedback est configuré
function reviewsEnabled(guildId) {
  return Boolean(getSettings(guildId).ticketsConfig.feedbackChannel);
}

function starsLine(stars) {
  return `${'⭐'.repeat(stars)} (${stars}/5)`;
}

function ticketLabel(review) {
  return `ticket n°${review.ticket_number}${review.type_label ? ` · ${review.type_label}` : ''}`;
}

// ── Publication dans le salon feedback ────────────────────────────────────────

async function publishReview(client, review) {
  const guild = client.guilds.cache.get(review.guild_id);
  if (!guild) return false;
  const tc = getSettings(guild.id).ticketsConfig;
  const channel = tc.feedbackChannel && guild.channels.cache.get(tc.feedbackChannel);
  if (!channel) return false;

  const user = await client.users.fetch(review.user_id).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setDescription([
      `**${starsLine(review.stars)}**`,
      review.comment ? `> ${review.comment.replace(/\n/g, '\n> ')}` : null,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: `Ticket n°${review.ticket_number}${review.type_label ? ` · ${review.type_label}` : ''}` })
    .setTimestamp();
  if (user) embed.setAuthor(userAuthor(user));

  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (!sent) return false;

  // Rôle client à la publication (si configuré et si le membre est encore là)
  if (tc.reviewRole && guild.roles.cache.has(tc.reviewRole)) {
    const member = await guild.members.fetch(review.user_id).catch(() => null);
    if (member) await member.roles.add(tc.reviewRole, 'Avis client publié').catch(() => {});
  }
  return true;
}

// Avis 5⭐ générique : client parti (immédiat) ou sans réponse sous 7 jours
async function publishAutoReview(client, reviewId) {
  const text = AUTO_REVIEW_TEXTS[Math.floor(Math.random() * AUTO_REVIEW_TEXTS.length)];
  publishAutoStmt.run(text, reviewId);
  const review = getStmt.get(reviewId);
  const ok = await publishReview(client, review);
  if (!ok) setStatusStmt.run('pending', reviewId); // salon indisponible : on retentera au prochain passage
  else clearTranscriptStmt.run(reviewId);
  return ok;
}

// ── Création à la fermeture d'un ticket ───────────────────────────────────────

// closedBy === null → membre parti : avis 5⭐ auto immédiat, sans MP
async function requestReview(guild, ticketRow, closedBy, transcript = null) {
  if (!reviewsEnabled(guild.id)) return;
  const tc = getSettings(guild.id).ticketsConfig;
  const type = tc.types.find((t) => t.id === ticketRow.type_id);

  const info = insertStmt.run({
    guild_id: guild.id,
    user_id: ticketRow.user_id,
    ticket_number: ticketRow.number,
    type_id: ticketRow.type_id,
    type_label: type?.label ?? null,
    status: 'pending',
    stars: null,
    comment: null,
    auto: 0,
    deadline: Date.now() + REVIEW_DEADLINE_MS,
    transcript: transcript || null,
    created_at: Date.now(),
  });
  const reviewId = info.lastInsertRowid;

  if (!closedBy) {
    await publishAutoReview(guild.client, reviewId);
    return;
  }

  const review = getStmt.get(reviewId);
  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle('⭐ Ton avis compte !')
    .setDescription([
      `Ton ${ticketLabel(review)} sur **${guild.name}** vient d'être fermé.`,
      '',
      'Note ton expérience de 1 à 5 étoiles — tu pourras ajouter un commentaire ensuite (facultatif).',
    ].join('\n'));
  const buttons = new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) => new ButtonBuilder()
      .setCustomId(`rv:star:${reviewId}:${n}`)
      .setLabel(`${n} ⭐`)
      .setStyle(ButtonStyle.Secondary)),
  );

  const opener = await guild.client.users.fetch(ticketRow.user_id).catch(() => null);
  const sent = opener && await opener.send({ embeds: [embed], components: [buttons] }).catch(() => null);
  // MP fermés : la ligne reste en pending → avis 5⭐ auto à J+7 comme sans réponse
  if (sent) setDmMessageStmt.run(sent.channelId, sent.id, reviewId);
}

// ── Interactions (customId "rv:...") ──────────────────────────────────────────

// Le staff d'un avis : admins du bot + rôles d'accès du type de ticket concerné
function canModerateReview(member, review) {
  if (isBotAdminMember(member)) return true;
  const type = getSettings(member.guild.id).ticketsConfig.types.find((t) => t.id === review.type_id);
  return (type?.accessRoles ?? []).some((roleId) => member.roles.cache.has(roleId));
}

function validationView(guild, review) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setDescription([
      `⭐ **Nouvel avis à valider** — ${ticketLabel(review)}`,
      `**Note :** ${starsLine(review.stars)}`,
      review.comment ? `**Commentaire :**\n> ${review.comment.replace(/\n/g, '\n> ')}` : '**Commentaire :** *aucun pour l\'instant (le client peut encore en ajouter un)*',
      idLine(review.user_id),
    ].join('\n'))
    .setTimestamp();
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rv:approve:${review.id}`).setLabel('✅ Publier').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rv:reject:${review.id}`).setLabel('❌ Rejeter').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [buttons] };
}

// Envoie l'avis pour validation : salon staff configuré, sinon MP au owner —
// un humain valide toujours avant publication
async function submitForValidation(client, review) {
  const guild = client.guilds.cache.get(review.guild_id);
  if (!guild) return null;
  const tc = getSettings(guild.id).ticketsConfig;
  const user = await client.users.fetch(review.user_id).catch(() => null);
  const view = validationView(guild, review);
  if (user) view.embeds[0].setAuthor(userAuthor(user));

  // Transcript du ticket joint en .txt, pour juger l'avis en connaissance de cause
  // (sauf transcript anormalement lourd, qui ferait échouer l'envoi)
  if (review.transcript && Buffer.byteLength(review.transcript, 'utf8') < 9 * 1024 * 1024) {
    view.files = [new AttachmentBuilder(Buffer.from(review.transcript, 'utf8'), { name: `transcript-ticket-${review.ticket_number}.txt` })];
  }

  const staffChannel = tc.reviewChannel && guild.channels.cache.get(tc.reviewChannel);
  let sent = staffChannel ? await staffChannel.send(view).catch(() => null) : null;
  if (!sent && process.env.OWNER_ID) {
    const owner = await client.users.fetch(process.env.OWNER_ID).catch(() => null);
    sent = owner && await owner.send({
      content: `🛃 **Avis à valider** — aucun salon de validation configuré sur **${guild.name}** :`,
      ...view,
    }).catch(() => null);
  }
  if (!sent) {
    console.error(`[reviews] Avis #${review.id} : demande de validation impossible à envoyer (salon staff et MP owner indisponibles).`);
    return null;
  }
  setValidationMsgStmt.run(sent.channelId, sent.id, review.id);
  return sent;
}

async function handleReviewComponent(interaction) {
  const [, action, reviewId, extra] = interaction.customId.split(':');
  const review = getStmt.get(reviewId);
  if (!review) {
    return interaction.reply({ content: '⚠️ Cet avis n\'existe plus.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // Clic sur une étoile (en MP, réservé à l'ouvreur du ticket)
  if (action === 'star') {
    if (interaction.user.id !== review.user_id) return;
    if (review.status !== 'pending') {
      return interaction.reply({ content: '⏱️ Trop tard : un avis a déjà été enregistré pour ce ticket.', flags: MessageFlags.Ephemeral });
    }
    const stars = Math.min(5, Math.max(1, parseInt(extra, 10) || 5));
    setStarsStmt.run(stars, reviewId);
    await submitForValidation(interaction.client, getStmt.get(reviewId));

    const embed = new EmbedBuilder()
      .setColor(getSettings(review.guild_id).color)
      .setTitle('✅ Merci pour ta note !')
      .setDescription([
        `**Note enregistrée :** ${starsLine(stars)} — ${ticketLabel(review)}`,
        'Tu peux encore ajouter un commentaire tant que ton avis n\'est pas publié.',
      ].join('\n'));
    const components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rv:comment:${reviewId}`).setLabel('💬 Ajouter un commentaire').setStyle(ButtonStyle.Primary),
    )];
    return interaction.update({ embeds: [embed], components });
  }

  // Bouton commentaire (en MP)
  if (action === 'comment') {
    if (interaction.user.id !== review.user_id) return;
    if (review.status !== 'awaiting') {
      return interaction.reply({ content: '⚠️ Ton avis a déjà été traité, le commentaire ne peut plus être ajouté.', flags: MessageFlags.Ephemeral });
    }
    const modal = new ModalBuilder()
      .setCustomId(`rv:modal:${reviewId}`)
      .setTitle('Ton commentaire')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('text').setLabel('Commentaire (publié avec ta note)')
          .setValue(review.comment ?? '')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
      ));
    return interaction.showModal(modal);
  }

  // Formulaire de commentaire envoyé (en MP)
  if (action === 'modal') {
    if (interaction.user.id !== review.user_id) return;
    if (review.status !== 'awaiting') {
      return interaction.reply({ content: '⚠️ Ton avis a déjà été traité, le commentaire n\'a pas pu être ajouté.', flags: MessageFlags.Ephemeral });
    }
    const comment = interaction.fields.getTextInputValue('text').trim().slice(0, 1000);
    setCommentStmt.run(comment, reviewId);

    // Met à jour l'embed en attente (salon de validation ou MP du owner)
    const guild = interaction.client.guilds.cache.get(review.guild_id);
    if (guild && review.review_channel_id && review.review_message_id) {
      const updated = getStmt.get(reviewId);
      const user = await interaction.client.users.fetch(review.user_id).catch(() => null);
      const view = validationView(guild, updated);
      if (user) view.embeds[0].setAuthor(userAuthor(user));
      const channel = await interaction.client.channels.fetch(review.review_channel_id).catch(() => null);
      await channel?.messages.edit(review.review_message_id, view).catch(() => {});
    }
    return interaction.reply({ content: '💬 Commentaire ajouté à ton avis, merci !', flags: MessageFlags.Ephemeral });
  }

  // Validation : staff dans le salon configuré, ou owner dans ses MP
  if (action === 'approve' || action === 'reject') {
    const allowed = interaction.inGuild()
      ? canModerateReview(interaction.member, review)
      : isOwner(interaction.user.id);
    if (!allowed) {
      return interaction.reply({ content: 'Seul le staff peut valider ou rejeter un avis.', flags: MessageFlags.Ephemeral });
    }
    if (review.status !== 'awaiting') {
      return interaction.reply({ content: '⚠️ Cet avis a déjà été traité.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'reject') {
      setStatusStmt.run('rejected', reviewId);
      clearTranscriptStmt.run(reviewId);
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xed4245)
        .setDescription(`❌ **Avis rejeté** par ${interaction.user} — ${ticketLabel(review)} (${starsLine(review.stars)})`);
      return interaction.update({ embeds: [embed], components: [] });
    }

    setStatusStmt.run('published', reviewId);
    const ok = await publishReview(interaction.client, getStmt.get(reviewId));
    if (!ok) {
      setStatusStmt.run('awaiting', reviewId);
      return interaction.reply({ content: '❌ Impossible de publier dans le salon de feedback (vérifie qu\'il existe et mes permissions).', flags: MessageFlags.Ephemeral });
    }
    clearTranscriptStmt.run(reviewId);
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x57f287)
      .setDescription(`✅ **Avis publié** par ${interaction.user} — ${ticketLabel(review)} (${starsLine(review.stars)})`);
    return interaction.update({ embeds: [embed], components: [] });
  }
}

// ── Worker : avis 5⭐ automatiques à J+7 sans réponse ─────────────────────────

async function processDueReviews(client) {
  for (const review of dueStmt.all(Date.now())) {
    const published = await publishAutoReview(client, review.id).catch(() => false);
    if (!published) continue;
    // Retire les boutons du MP de notation, le délai est passé
    if (review.dm_channel_id && review.dm_message_id) {
      const dm = await client.channels.fetch(review.dm_channel_id).catch(() => null);
      await dm?.messages.edit(review.dm_message_id, { components: [] }).catch(() => {});
    }
  }
}

function startReviewWorker(client) {
  processDueReviews(client).catch((error) => console.error('[reviews] Erreur avis automatiques :', error));
  setInterval(() => {
    processDueReviews(client).catch((error) => console.error('[reviews] Erreur avis automatiques :', error));
  }, 60 * 60 * 1000);
}

module.exports = { requestReview, handleReviewComponent, startReviewWorker, reviewsEnabled };
