const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const db = require('./db');
const { getSettings } = require('./settings');
const { isBotAdminMember, isOwner } = require('./permissions');
const { userAuthor, idLine } = require('./logs');

const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');

// Délai laissé au client pour envoyer son avis, avant l'avis 5⭐ automatique
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
const setStarsStmt = db.prepare('UPDATE ticket_reviews SET stars = ? WHERE id = ?');
const setCommentStmt = db.prepare('UPDATE ticket_reviews SET comment = ? WHERE id = ?');
const setImageStmt = db.prepare('UPDATE ticket_reviews SET image = ? WHERE id = ?');
const setStatusStmt = db.prepare('UPDATE ticket_reviews SET status = ? WHERE id = ?');
const setValidationMsgStmt = db.prepare('UPDATE ticket_reviews SET review_channel_id = ?, review_message_id = ? WHERE id = ?');
// L'avis auto est générique : il n'embarque jamais le brouillon (image comprise) du client
const publishAutoStmt = db.prepare("UPDATE ticket_reviews SET status = 'published', stars = 5, comment = ?, auto = 1, image = NULL WHERE id = ?");
// Une fois l'avis traité, le transcript ne sert plus : purgé pour garder la base et les backups légers
const clearTranscriptStmt = db.prepare('UPDATE ticket_reviews SET transcript = NULL WHERE id = ?');

// Upload d'image d'avis en attente dans un MP : userId → { reviewId, channelId, expires }
const pendingReviewImages = new Map();

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

function deleteReviewImage(review) {
  if (!review?.image) return;
  try { fs.unlinkSync(path.join(imagesDir, review.image)); } catch { /* déjà supprimée */ }
}

function imageAttachment(review) {
  if (!review.image) return null;
  const filePath = path.join(imagesDir, review.image);
  return fs.existsSync(filePath) ? new AttachmentBuilder(filePath) : null;
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
    .setTimestamp();
  if (review.type_label) embed.setFooter({ text: review.type_label });
  if (user) embed.setAuthor(userAuthor(user));

  const files = [];
  const image = imageAttachment(review);
  if (image) {
    files.push(image);
    embed.setImage(`attachment://${review.image}`);
  }

  const sent = await channel.send({ embeds: [embed], files }).catch(() => null);
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
  deleteReviewImage(getStmt.get(reviewId)); // brouillon jamais envoyé : son image ne doit pas fuiter
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
      'Note ton expérience de 1 à 5 étoiles — tu pourras ensuite ajouter un commentaire et/ou une image (facultatif) avant d\'envoyer ton avis.',
      '',
      '⏳ *Sans avis de ta part sous 7 jours, un avis 5⭐ sera publié automatiquement.*',
    ].join('\n'));

  const opener = await guild.client.users.fetch(ticketRow.user_id).catch(() => null);
  const sent = opener && await opener.send({ embeds: [embed], components: starsRow(review) }).catch(() => null);
  // MP fermés : la ligne reste en pending → avis 5⭐ auto à J+7 comme sans réponse
  if (sent) setDmMessageStmt.run(sent.channelId, sent.id, reviewId);
}

// ── Brouillon d'avis en MP (note + commentaire + image, envoi par 📤) ────────

function starsRow(review) {
  return [new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) => new ButtonBuilder()
      .setCustomId(`rv:star:${review.id}:${n}`)
      .setLabel(`${n} ⭐`)
      .setStyle(n === review.stars ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  )];
}

function draftView(review) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(review.guild_id).color)
    .setTitle('⭐ Ton avis')
    .setDescription([
      `**Note :** ${review.stars ? starsLine(review.stars) : '*choisis de 1 à 5 ⭐*'} — ${ticketLabel(review)}`,
      `**Commentaire :** ${review.comment ? `\n> ${review.comment.replace(/\n/g, '\n> ')}` : '*aucun (facultatif)*'}`,
      `**Image :** ${review.image ? '🟢 ajoutée' : '*aucune (facultatif)*'}`,
      '',
      'Quand tout est prêt, clique **📤 Envoyer mon avis**.',
      '⏳ *Sans envoi de ta part sous 7 jours, un avis 5⭐ sera publié automatiquement.*',
    ].join('\n'));

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rv:comment:${review.id}`)
      .setLabel(review.comment ? '💬 Modifier le commentaire' : '💬 Ajouter un commentaire').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rv:image:${review.id}`)
      .setLabel(review.image ? '🖼️ Changer l\'image' : '🖼️ Ajouter une image').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rv:send:${review.id}`).setLabel('📤 Envoyer mon avis').setStyle(ButtonStyle.Success)
      .setDisabled(!review.stars),
  );
  return { embeds: [embed], components: [...starsRow(review), actions] };
}

function sentView(review, message) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Merci pour ton avis !')
    .setDescription([
      `**${starsLine(review.stars)}** — ${ticketLabel(review)}`,
      message,
    ].join('\n'));
  return { embeds: [embed], components: [] };
}

// ── Validation par le staff avant publication ─────────────────────────────────

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
      review.comment ? `**Commentaire :**\n> ${review.comment.replace(/\n/g, '\n> ')}` : '**Commentaire :** *aucun*',
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

  // Image de l'avis affichée dans l'embed, transcript du ticket joint en .txt
  // (sauf transcript anormalement lourd, qui ferait échouer l'envoi)
  view.files = [];
  const image = imageAttachment(review);
  if (image) {
    view.files.push(image);
    view.embeds[0].setImage(`attachment://${review.image}`);
  }
  if (review.transcript && Buffer.byteLength(review.transcript, 'utf8') < 9 * 1024 * 1024) {
    view.files.push(new AttachmentBuilder(Buffer.from(review.transcript, 'utf8'), { name: `transcript-ticket-${review.ticket_number}.txt` }));
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

// ── Interactions (customId "rv:...") ──────────────────────────────────────────

async function handleReviewComponent(interaction) {
  const [, action, reviewId, extra] = interaction.customId.split(':');
  const review = getStmt.get(reviewId);
  if (!review) {
    return interaction.reply({ content: '⚠️ Cet avis n\'existe plus.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // ── Côté client, en MP : brouillon (étoiles, commentaire, image, envoi) ──
  if (action === 'star' || action === 'comment' || action === 'image' || action === 'send' || action === 'modal') {
    if (interaction.user.id !== review.user_id) return;
    if (review.status !== 'pending') {
      return interaction.reply({ content: '⚠️ Ton avis a déjà été envoyé (ou le délai de 7 jours est passé).', flags: MessageFlags.Ephemeral });
    }

    if (action === 'star') {
      const stars = Math.min(5, Math.max(1, parseInt(extra, 10) || 5));
      setStarsStmt.run(stars, reviewId);
      return interaction.update(draftView(getStmt.get(reviewId)));
    }

    if (action === 'comment') {
      const modal = new ModalBuilder()
        .setCustomId(`rv:modal:${reviewId}`)
        .setTitle('Ton commentaire')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('text').setLabel('Commentaire (vide = le retirer)')
            .setValue(review.comment ?? '')
            .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000),
        ));
      return interaction.showModal(modal);
    }

    if (action === 'modal') {
      const comment = interaction.fields.getTextInputValue('text').trim().slice(0, 1000);
      setCommentStmt.run(comment || null, reviewId);
      const view = draftView(getStmt.get(reviewId));
      if (interaction.isFromMessage()) return interaction.update(view);
      return interaction.reply({ content: '💬 Commentaire enregistré !', flags: MessageFlags.Ephemeral });
    }

    if (action === 'image') {
      pendingReviewImages.set(interaction.user.id, {
        reviewId: review.id,
        channelId: interaction.channelId,
        expires: Date.now() + 120_000,
      });
      return interaction.reply({
        content: '🖼️ **Envoie ton image maintenant, ici dans ce chat** (en pièce jointe, 8 Mo max). ⏱️ 2 minutes.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'send') {
      if (!review.stars) {
        return interaction.reply({ content: '⚠️ Choisis d\'abord une note de 1 à 5 ⭐.', flags: MessageFlags.Ephemeral });
      }
      pendingReviewImages.delete(interaction.user.id);

      // Un 5⭐ sans commentaire ni image ne présente aucun risque : publié directement
      if (review.stars === 5 && !review.comment && !review.image) {
        setStatusStmt.run('published', reviewId);
        const ok = await publishReview(interaction.client, getStmt.get(reviewId));
        if (!ok) {
          setStatusStmt.run('pending', reviewId);
          return interaction.reply({ content: '❌ Impossible de publier ton avis pour le moment, réessaie plus tard.', flags: MessageFlags.Ephemeral });
        }
        clearTranscriptStmt.run(reviewId);
        return interaction.update(sentView(review, 'Ton avis est **publié**, merci beaucoup ! 🙏'));
      }

      // Sinon : validation par le staff (salon configuré, ou MP au owner)
      setStatusStmt.run('awaiting', reviewId);
      await submitForValidation(interaction.client, getStmt.get(reviewId));
      return interaction.update(sentView(review, 'Ton avis a été transmis, il sera publié après vérification par l\'équipe. Merci ! 🙏'));
    }
  }

  // ── Côté staff : validation dans le salon configuré, ou owner dans ses MP ──
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
      deleteReviewImage(review);
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
    deleteReviewImage(review); // l'image vit désormais sur le message publié
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x57f287)
      .setDescription(`✅ **Avis publié** par ${interaction.user} — ${ticketLabel(review)} (${starsLine(review.stars)})`);
    return interaction.update({ embeds: [embed], components: [] });
  }
}

// ── Image d'avis envoyée en MP après un clic sur 🖼️ ──────────────────────────

async function handlePendingReviewImage(message) {
  if (message.author.bot || message.inGuild()) return false;
  const pending = pendingReviewImages.get(message.author.id);
  if (!pending) return false;
  if (Date.now() > pending.expires) {
    pendingReviewImages.delete(message.author.id);
    return false;
  }
  if (message.channelId !== pending.channelId) return false;

  const review = getStmt.get(pending.reviewId);
  if (!review || review.status !== 'pending') {
    pendingReviewImages.delete(message.author.id);
    return false;
  }

  const attachment = message.attachments.first();
  if (!attachment) return false; // message texte normal, on n'y touche pas

  if (!attachment.contentType?.startsWith('image/')) {
    await message.channel.send('❌ Ce fichier n\'est pas une image, réessaie.').catch(() => {});
    return true;
  }
  if (attachment.size > 8 * 1024 * 1024) {
    await message.channel.send('❌ Image trop lourde (8 Mo max), réessaie.').catch(() => {});
    return true;
  }

  const response = await fetch(attachment.url).catch(() => null);
  if (!response?.ok) {
    await message.channel.send('❌ Impossible de télécharger l\'image, réessaie.').catch(() => {});
    return true;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = (attachment.name?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const filename = `review-${review.id}-${Date.now()}.${ext}`;
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, filename), buffer);

  deleteReviewImage(review); // remplace l'éventuelle image précédente
  setImageStmt.run(filename, review.id);
  pendingReviewImages.delete(message.author.id);

  await message.channel.send('✅ Image ajoutée à ton avis !').catch(() => {});
  // Met à jour le brouillon pour refléter l'image
  if (review.dm_message_id) {
    await message.channel.messages.edit(review.dm_message_id, draftView(getStmt.get(review.id))).catch(() => {});
  }
  return true;
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

module.exports = { requestReview, handleReviewComponent, handlePendingReviewImage, startReviewWorker, reviewsEnabled };
