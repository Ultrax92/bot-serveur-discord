const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder,
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
  "Rien à redire, tout s'est parfaitement passé. Merci !",
  'Service rapide et efficace, je recommande.',
  'Très bonne expérience, équipe au top.',
  "Nickel du début à la fin, merci à l'équipe.",
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
const dueStmt = db.prepare(
  "SELECT * FROM ticket_reviews WHERE status = 'pending' AND deadline IS NOT NULL AND deadline <= ?",
);
const setDmMessageStmt = db.prepare('UPDATE ticket_reviews SET dm_channel_id = ?, dm_message_id = ? WHERE id = ?');
const setStarsStmt = db.prepare('UPDATE ticket_reviews SET stars = ? WHERE id = ?');
const setCommentStmt = db.prepare('UPDATE ticket_reviews SET comment = ? WHERE id = ?');
const setImageStmt = db.prepare('UPDATE ticket_reviews SET image = ? WHERE id = ?');
const setStatusStmt = db.prepare('UPDATE ticket_reviews SET status = ? WHERE id = ?');
// Transition atomique : ne réussit (changes > 0) que si le statut est encore
// celui attendu — un seul déclencheur peut publier/valider un avis donné,
// même en cas de double-clic, worker relancé ou process concurrent
const claimStatusStmt = db.prepare('UPDATE ticket_reviews SET status = ? WHERE id = ? AND status = ?');
const setValidationMsgStmt = db.prepare(
  'UPDATE ticket_reviews SET review_channel_id = ?, review_message_id = ? WHERE id = ?',
);
// L'avis auto est générique : il n'embarque jamais le brouillon (image comprise) du client.
// Le AND status='pending' garantit qu'un seul déclencheur le publie.
const publishAutoStmt = db.prepare(
  "UPDATE ticket_reviews SET status = 'published', stars = 5, comment = ?, auto = 1, image = NULL WHERE id = ? AND status = 'pending'",
);
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
  try {
    fs.unlinkSync(path.join(imagesDir, review.image));
  } catch {
    /* déjà supprimée */
  }
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
    .setDescription(
      [`**${starsLine(review.stars)}**`, review.comment ? `> ${review.comment.replace(/\n/g, '\n> ')}` : null]
        .filter(Boolean)
        .join('\n'),
    )
    .setTimestamp();
  if (review.type_label) embed.setFooter({ text: review.type_label });
  if (user) embed.setAuthor(userAuthor(user));

  const files = [];
  const image = imageAttachment(review);
  if (image) {
    files.push(image);
    embed.setImage(`attachment://${review.image}`);
  }

  // nonce + enforceNonce : si le réseau coupe pendant l'envoi, @discordjs/rest
  // rejoue la requête (jusqu'à 3 fois) alors que Discord a peut-être déjà créé
  // le message → deux avis identiques à la même seconde. Avec un nonce stable,
  // Discord renvoie le message existant au lieu d'en créer un second.
  const sent = await channel
    .send({ embeds: [embed], files, nonce: `rv-pub-${review.id}`, enforceNonce: true })
    .catch(() => null);
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
  const before = getStmt.get(reviewId); // lu avant le claim, qui met image = NULL
  const text = AUTO_REVIEW_TEXTS[Math.floor(Math.random() * AUTO_REVIEW_TEXTS.length)];
  // Claim atomique pending → published : un seul déclencheur publie cet avis
  if (publishAutoStmt.run(text, reviewId).changes === 0) return false;
  deleteReviewImage(before); // brouillon jamais envoyé : son image ne doit pas fuiter
  const review = getStmt.get(reviewId);
  const ok = await publishReview(client, review);
  if (!ok)
    setStatusStmt.run('pending', reviewId); // salon indisponible : on retentera au prochain passage
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
  const opener = await guild.client.users.fetch(ticketRow.user_id).catch(() => null);
  const sent = opener && (await opener.send(starsView(review, guild.name)).catch(() => null));
  // MP fermés : la ligne reste en pending → avis 5⭐ auto à J+7 comme sans réponse
  if (sent) setDmMessageStmt.run(sent.channelId, sent.id, reviewId);
}

// ── Brouillon d'avis en MP (note + commentaire + image, envoi par 📤) ────────

// Étape 1 : le choix de la note. Une fois la note choisie on bascule sur le
// brouillon (étape 2) pour ne pas laisser traîner à l'écran des boutons qui ne
// concernent plus le client — il peut y revenir avec ↩️ Modifier ma note.
function starsView(review, guildName) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(review.guild_id).color)
    .setTitle('⭐ Ton avis compte !')
    .setDescription(
      [
        `Ton ${ticketLabel(review)}${guildName ? ` sur **${guildName}**` : ''} vient d'être fermé.`,
        '',
        "Note ton expérience de 1 à 5 étoiles — tu pourras ensuite ajouter un commentaire et/ou une image (facultatif) avant d'envoyer ton avis.",
        '',
        "⏳ *Sans action de ta part sous 7 jours, un avis 5⭐ sera publié automatiquement en ton nom. **C'est définitif : tu ne pourras plus le modifier ni le retirer ensuite.***",
        "🚫 *Tu n'es pas obligé de laisser un avis : le bouton ci-dessous annule la demande pour de bon, et aucun avis — pas même l'automatique — ne sera publié.*",
      ].join('\n'),
    );
  return { embeds: [embed], components: [...starsRow(review), declineRow(review)] };
}

function starsRow(review) {
  return [
    new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((n) =>
        new ButtonBuilder()
          .setCustomId(`rv:star:${review.id}:${n}`)
          .setLabel(`${n} ⭐`)
          .setStyle(n === review.stars ? ButtonStyle.Primary : ButtonStyle.Secondary),
      ),
    ),
  ];
}

// Refuser de laisser un avis : le client n'est jamais forcé, et rien (pas même
// l'avis 5⭐ automatique à J+7) ne sera publié en son nom s'il clique ici
function declineRow(review) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rv:decline:${review.id}`)
      .setLabel("🚫 Je ne souhaite pas laisser d'avis")
      .setStyle(ButtonStyle.Secondary),
  );
}

// Second clic obligatoire : le refus est définitif, on évite le clic accidentel
function declineConfirmView(review) {
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('🚫 Refuser de laisser un avis ?')
    .setDescription(
      [
        `Tu es sur le point de refuser de laisser un avis pour ton ${ticketLabel(review)}.`,
        '',
        '**Aucun avis ne sera publié en ton nom**, ni maintenant, ni automatiquement dans 7 jours. Cette décision est définitive : tu ne pourras plus noter ce ticket.',
      ].join('\n'),
    );
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rv:declineok:${review.id}`)
      .setLabel('🚫 Confirmer le refus')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rv:cancel:${review.id}`).setLabel('↩️ Annuler').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttons] };
}

function declinedView(review) {
  const embed = new EmbedBuilder()
    .setColor(0x99aab5)
    .setTitle('🚫 Demande annulée')
    .setDescription(
      [
        `C'est noté : aucun avis ne sera publié pour ton ${ticketLabel(review)}.`,
        '',
        'Merci quand même pour ta confiance, et à bientôt !',
      ].join('\n'),
    );
  return { embeds: [embed], components: [] };
}

function draftView(review) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(review.guild_id).color)
    .setTitle('⭐ Ton avis')
    .setDescription(
      [
        `**Note :** ${review.stars ? starsLine(review.stars) : '*choisis de 1 à 5 ⭐*'} — ${ticketLabel(review)}`,
        `**Commentaire :** ${review.comment ? `\n> ${review.comment.replace(/\n/g, '\n> ')}` : '*aucun (facultatif)*'}`,
        `**Image :** ${review.image ? '🟢 ajoutée' : '*aucune (facultatif)*'}`,
        '',
        'Quand tout est prêt, clique **📤 Envoyer mon avis**.',
        '⏳ *Sans envoi de ta part sous 7 jours, un avis 5⭐ sera publié automatiquement en ton nom, et **il ne pourra plus être retiré**.*',
        '↩️ *Pour changer ta note — ou refuser de laisser un avis — reviens en arrière avec **Modifier ma note**.*',
      ].join('\n'),
    );

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rv:comment:${review.id}`)
      .setLabel(review.comment ? '💬 Modifier le commentaire' : '💬 Ajouter un commentaire')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rv:image:${review.id}`)
      .setLabel(review.image ? "🖼️ Changer l'image" : '🖼️ Ajouter une image')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rv:send:${review.id}`)
      .setLabel('📤 Envoyer mon avis')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!review.stars),
  );
  // Retour à l'étape 1 : c'est là que vivent le choix des étoiles et le refus
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rv:back:${review.id}`)
      .setLabel('↩️ Modifier ma note')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [actions, back] };
}

// Écran d'attente : la publication (envoi, fetch du membre, rôle) prend parfois
// une dizaine de secondes. Sans lui, le client garde un brouillon cliquable sous
// les yeux et croit que son clic n'a rien fait.
function sendingView(review) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(review.guild_id).color)
    .setTitle('⏳ Envoi de ton avis…')
    .setDescription(
      [`**${starsLine(review.stars)}** — ${ticketLabel(review)}`, 'Encore quelques secondes, ne ferme pas.'].join('\n'),
    );
  return { embeds: [embed], components: [] };
}

function sentView(review, message) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Merci pour ton avis !')
    .setDescription([`**${starsLine(review.stars)}** — ${ticketLabel(review)}`, message].join('\n'));
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
    .setDescription(
      [
        `⭐ **Nouvel avis à valider** — ${ticketLabel(review)}`,
        `**Note :** ${starsLine(review.stars)}`,
        review.comment ? `**Commentaire :**\n> ${review.comment.replace(/\n/g, '\n> ')}` : '**Commentaire :** *aucun*',
        idLine(review.user_id),
      ].join('\n'),
    )
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
    view.files.push(
      new AttachmentBuilder(Buffer.from(review.transcript, 'utf8'), {
        name: `transcript-ticket-${review.ticket_number}.txt`,
      }),
    );
  }

  // Même protection anti-rejeu que la publication : une seule demande de validation
  view.nonce = `rv-val-${review.id}`;
  view.enforceNonce = true;

  const staffChannel = tc.reviewChannel && guild.channels.cache.get(tc.reviewChannel);
  let sent = staffChannel ? await staffChannel.send(view).catch(() => null) : null;
  if (!sent && process.env.OWNER_ID) {
    const owner = await client.users.fetch(process.env.OWNER_ID).catch(() => null);
    sent =
      owner &&
      (await owner
        .send({
          content: `🛃 **Avis à valider** — aucun salon de validation configuré sur **${guild.name}** :`,
          ...view,
        })
        .catch(() => null));
  }
  if (!sent) {
    console.error(
      `[reviews] Avis #${review.id} : demande de validation impossible à envoyer (salon staff et MP owner indisponibles).`,
    );
    return null;
  }
  setValidationMsgStmt.run(sent.channelId, sent.id, review.id);
  return sent;
}

// Refus d'avis : le staff est informé dans le même salon que les avis à valider,
// mais sans boutons — il n'y a rien à valider, c'est une simple trace
async function notifyDeclined(client, review) {
  const guild = client.guilds.cache.get(review.guild_id);
  if (!guild) return null;
  const tc = getSettings(guild.id).ticketsConfig;
  const user = await client.users.fetch(review.user_id).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription(
      [
        `🚫 **Refus d'avis** — ${ticketLabel(review)}`,
        `${user ? `**${user.tag}**` : `<@${review.user_id}>`} a cliqué sur le bouton pour refuser de laisser un avis.`,
        idLine(review.user_id),
        '*Aucun avis ne sera publié pour ce ticket, ni maintenant ni automatiquement à J+7.*',
      ].join('\n'),
    )
    .setTimestamp();
  if (user) embed.setAuthor(userAuthor(user));

  // Même protection anti-rejeu : un seul signalement de refus
  const payload = { embeds: [embed], files: [], nonce: `rv-dec-${review.id}`, enforceNonce: true };
  if (review.transcript && Buffer.byteLength(review.transcript, 'utf8') < 9 * 1024 * 1024) {
    payload.files.push(
      new AttachmentBuilder(Buffer.from(review.transcript, 'utf8'), {
        name: `transcript-ticket-${review.ticket_number}.txt`,
      }),
    );
  }

  const staffChannel = tc.reviewChannel && guild.channels.cache.get(tc.reviewChannel);
  let sent = staffChannel ? await staffChannel.send(payload).catch(() => null) : null;
  if (!sent && process.env.OWNER_ID) {
    const owner = await client.users.fetch(process.env.OWNER_ID).catch(() => null);
    sent =
      owner &&
      (await owner.send({ content: `🚫 **Refus d'avis** sur **${guild.name}** :`, ...payload }).catch(() => null));
  }
  if (!sent) {
    console.error(`[reviews] Avis #${review.id} : refus impossible à signaler au staff.`);
  }
  return sent;
}

// ── Interactions (customId "rv:...") ──────────────────────────────────────────

// Discord n'accorde que 3 s pour acquitter une interaction. Publier un avis
// (envoi dans le salon feedback, fetch du membre, ajout du rôle) ou demander une
// validation (upload du transcript) dépasse parfois ce délai : on acquitte AVANT
// avec deferUpdate, puis on édite le message via editReply.
function ack(interaction) {
  if (interaction.deferred || interaction.replied) return Promise.resolve();
  return interaction.deferUpdate().catch(() => {});
}

// Message éphémère, que l'interaction ait déjà été acquittée ou non
function respond(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  const send = interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
  return send.catch(() => {});
}

// Édite le message porteur des boutons, que l'interaction ait été deferred ou non
function edit(interaction, view) {
  const send = interaction.deferred || interaction.replied ? interaction.editReply(view) : interaction.update(view);
  return send.catch(() => {});
}

async function handleReviewComponent(interaction) {
  const [, action, reviewId, extra] = interaction.customId.split(':');
  const review = getStmt.get(reviewId);
  if (!review) {
    return interaction.reply({ content: "⚠️ Cet avis n'existe plus.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // ── Côté client, en MP : brouillon (étoiles, commentaire, image, envoi) ──
  if (
    action === 'star' ||
    action === 'comment' ||
    action === 'image' ||
    action === 'send' ||
    action === 'modal' ||
    action === 'decline' ||
    action === 'declineok' ||
    action === 'cancel' ||
    action === 'back'
  ) {
    if (interaction.user.id !== review.user_id) return;
    if (review.status !== 'pending') {
      return interaction.reply({
        content:
          review.status === 'declined'
            ? '⚠️ Tu as refusé de laisser un avis pour ce ticket.'
            : '⚠️ Ton avis a déjà été envoyé (ou le délai de 7 jours est passé).',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Retour à l'étape 1 (choix de la note + refus), depuis le brouillon ou
    // depuis la confirmation de refus
    if (action === 'back' || action === 'cancel') {
      const guildName = interaction.client.guilds.cache.get(review.guild_id)?.name;
      return interaction.update(starsView(review, guildName));
    }

    // Refus : confirmation, puis annulation définitive de la demande d'avis
    if (action === 'decline') return interaction.update(declineConfirmView(review));

    if (action === 'declineok') {
      // Acquitté tout de suite : le message au staff peut dépasser les 3 s
      await ack(interaction);
      // Claim atomique pending → declined : un double-clic ne prévient le staff qu'une fois
      if (claimStatusStmt.run('declined', reviewId, 'pending').changes === 0) {
        return respond(interaction, '⚠️ Cette demande a déjà été traitée.');
      }
      pendingReviewImages.delete(interaction.user.id);
      await notifyDeclined(interaction.client, getStmt.get(reviewId));
      clearTranscriptStmt.run(reviewId);
      deleteReviewImage(review); // brouillon abandonné : son image ne doit pas rester sur le disque
      return edit(interaction, declinedView(review));
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
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('text')
              .setLabel('Commentaire (vide = le retirer)')
              .setValue(review.comment ?? '')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1000),
          ),
        );
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
        return interaction.reply({
          content: "⚠️ Choisis d'abord une note de 1 à 5 ⭐.",
          flags: MessageFlags.Ephemeral,
        });
      }
      pendingReviewImages.delete(interaction.user.id);
      // Acquitte ET retire les boutons dans le même appel : la publication qui
      // suit peut prendre une dizaine de secondes, le client ne doit ni pouvoir
      // recliquer ni se demander si son clic est passé
      await interaction.update(sendingView(review)).catch(() => {});

      // Un 5⭐ sans commentaire ni image ne présente aucun risque : publié directement
      if (review.stars === 5 && !review.comment && !review.image) {
        // Claim atomique pending → published : un double-clic ne publie pas deux fois
        if (claimStatusStmt.run('published', reviewId, 'pending').changes === 0) {
          return respond(interaction, '⚠️ Ton avis a déjà été envoyé.');
        }
        const ok = await publishReview(interaction.client, getStmt.get(reviewId));
        if (!ok) {
          setStatusStmt.run('pending', reviewId);
          // Les boutons ont été retirés à l'acquittement : on rend la main
          await edit(interaction, draftView(getStmt.get(reviewId)));
          return respond(interaction, '❌ Impossible de publier ton avis pour le moment, réessaie plus tard.');
        }
        clearTranscriptStmt.run(reviewId);
        return edit(interaction, sentView(review, 'Ton avis est **publié**, merci beaucoup ! 🙏'));
      }

      // Sinon : validation par le staff (salon configuré, ou MP au owner)
      // Claim atomique pending → awaiting : une seule demande de validation
      if (claimStatusStmt.run('awaiting', reviewId, 'pending').changes === 0) {
        return respond(interaction, '⚠️ Ton avis a déjà été envoyé.');
      }
      await submitForValidation(interaction.client, getStmt.get(reviewId));
      return edit(
        interaction,
        sentView(review, "Ton avis a été transmis, il sera publié après vérification par l'équipe. Merci ! 🙏"),
      );
    }
  }

  // ── Côté staff : validation dans le salon configuré, ou owner dans ses MP ──
  if (action === 'approve' || action === 'reject') {
    const allowed = interaction.inGuild()
      ? canModerateReview(interaction.member, review)
      : isOwner(interaction.user.id);
    if (!allowed) {
      return interaction.reply({
        content: 'Seul le staff peut valider ou rejeter un avis.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (review.status !== 'awaiting') {
      return interaction.reply({ content: '⚠️ Cet avis a déjà été traité.', flags: MessageFlags.Ephemeral });
    }
    // Acquitte ET retire les boutons dans le même appel : la publication qui suit
    // peut prendre plusieurs secondes, le staff ne doit pas recliquer entre-temps
    const staffButtons = interaction.message.components;
    await interaction.update({ components: [] }).catch(() => {});

    if (action === 'reject') {
      // Claim atomique awaiting → rejected : un double-clic ne traite qu'une fois
      if (claimStatusStmt.run('rejected', reviewId, 'awaiting').changes === 0) {
        return respond(interaction, '⚠️ Cet avis a déjà été traité.');
      }
      clearTranscriptStmt.run(reviewId);
      deleteReviewImage(review);
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xed4245)
        .setDescription(
          `❌ **Avis rejeté** par ${interaction.user} — ${ticketLabel(review)} (${starsLine(review.stars)})`,
        );
      return edit(interaction, { embeds: [embed], components: [] });
    }

    // Claim atomique awaiting → published : un double-clic ne publie qu'une fois
    if (claimStatusStmt.run('published', reviewId, 'awaiting').changes === 0) {
      return respond(interaction, '⚠️ Cet avis a déjà été traité.');
    }
    const ok = await publishReview(interaction.client, getStmt.get(reviewId));
    if (!ok) {
      setStatusStmt.run('awaiting', reviewId);
      // Les boutons ont été retirés à l'acquittement : on les rend pour réessayer
      await edit(interaction, { components: staffButtons });
      return respond(
        interaction,
        "❌ Impossible de publier dans le salon de feedback (vérifie qu'il existe et mes permissions).",
      );
    }
    clearTranscriptStmt.run(reviewId);
    deleteReviewImage(review); // l'image vit désormais sur le message publié
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x57f287)
      .setDescription(
        `✅ **Avis publié** par ${interaction.user} — ${ticketLabel(review)} (${starsLine(review.stars)})`,
      );
    return edit(interaction, { embeds: [embed], components: [] });
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
    await message.channel.send("❌ Ce fichier n'est pas une image, réessaie.").catch(() => {});
    return true;
  }
  if (attachment.size > 8 * 1024 * 1024) {
    await message.channel.send('❌ Image trop lourde (8 Mo max), réessaie.').catch(() => {});
    return true;
  }

  const response = await fetch(attachment.url).catch(() => null);
  if (!response?.ok) {
    await message.channel.send("❌ Impossible de télécharger l'image, réessaie.").catch(() => {});
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
  setInterval(
    () => {
      processDueReviews(client).catch((error) => console.error('[reviews] Erreur avis automatiques :', error));
    },
    60 * 60 * 1000,
  );
}

module.exports = { requestReview, handleReviewComponent, handlePendingReviewImage, startReviewWorker, reviewsEnabled };
