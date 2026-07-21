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
const { getSettings } = require('./settings');
const { mentionContent, parseButtonLines } = require('./scheduler');

const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');

// Sessions de création d'embed : "guildId:userId" → brouillon
const sessions = new Map();
const SESSION_TTL = 30 * 60_000;

function getSession(guildId, userId) {
  const key = `${guildId}:${userId}`;
  let session = sessions.get(key);
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    session = {
      title: '',
      description: '',
      color: null,
      image: null,
      buttons: [],
      mention: '', // ping au-dessus de l'embed (envois en salon uniquement, || = caché)
      target: {},
      createdAt: Date.now(),
    };
    sessions.set(key, session);
  }
  return session;
}

function resetSession(guildId, userId) {
  sessions.delete(`${guildId}:${userId}`);
}

// Construit l'embed final (+ fichier si image uploadée)
function buildFinalEmbed(guild, session, signer = null) {
  const embed = new EmbedBuilder().setColor(session.color ?? getSettings(guild.id).color);
  if (session.title) embed.setTitle(session.title.slice(0, 256));
  if (session.description) embed.setDescription(session.description.slice(0, 4096));
  if (signer) embed.setFooter({ text: signer.username, iconURL: signer.displayAvatarURL() });

  const files = [];
  if (session.image?.startsWith('file:')) {
    const filePath = path.join(imagesDir, session.image.slice(5));
    if (fs.existsSync(filePath)) {
      files.push(new AttachmentBuilder(filePath));
      embed.setImage(`attachment://${path.basename(filePath)}`);
    }
  } else if (session.image) {
    embed.setImage(session.image);
  }

  const components = [];
  if (session.buttons.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        session.buttons
          .slice(0, 5)
          .map((b) => new ButtonBuilder().setLabel(b.label.slice(0, 80)).setURL(b.url).setStyle(ButtonStyle.Link)),
      ),
    );
  }

  return { embed, files, components };
}

// Le panneau éphémère du créateur : l'aperçu EST le message
function builderView(guild, userId) {
  const session = getSession(guild.id, userId);
  const { embed, files, components } = buildFinalEmbed(guild, session);

  if (!session.title && !session.description && !session.image) {
    embed.setDescription('*Embed vide — commence par **📝 Contenu**. Cet aperçu se met à jour à chaque modification.*');
  }

  const target = session.target.roleId
    ? `📬 en MP à **tous les membres** de <@&${session.target.roleId}> (confirmation avant envoi)`
    : session.target.userId
      ? `📬 en MP à <@${session.target.userId}>`
      : session.target.channelId
        ? `dans <#${session.target.channelId}>`
        : 'ici (salon courant)';
  const mentionPreview = mentionContent(session.mention);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('eb:content').setLabel('📝 Contenu').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('eb:image').setLabel('🖼️ Image URL').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('eb:upload').setLabel('📎 Image upload').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('eb:button')
      .setLabel(`🔗 Boutons (${session.buttons.length}/5)`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('eb:import').setLabel('📥 Importer').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('eb:send')
      .setLabel('📤 Envoyer')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!session.title && !session.description && !session.image),
    new ButtonBuilder().setCustomId('eb:target').setLabel('🎯 Destination').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('eb:mention').setLabel('📣 Mention').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('eb:refresh').setLabel('🔄 Aperçu').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('eb:reset').setLabel('🧹 Réinitialiser').setStyle(ButtonStyle.Danger),
  );

  return {
    content: `🎯 **Destination :** ${target}${mentionPreview ? ` — 📣 mention : \`${mentionPreview}\`` : ''} — panneau visible par toi seul`,
    embeds: [embed],
    files,
    components: [row1, ...components, row2],
  };
}

async function handleEmbedComponent(interaction) {
  const guild = interaction.guild;
  const session = getSession(guild.id, interaction.user.id);
  const [, action] = interaction.customId.split(':');

  if (action === 'refresh') {
    return interaction.update(builderView(guild, interaction.user.id));
  }

  if (action === 'reset') {
    resetSession(guild.id, interaction.user.id);
    return interaction.update(builderView(guild, interaction.user.id));
  }

  if (action === 'content') {
    const modal = new ModalBuilder()
      .setCustomId('eb:modal:content')
      .setTitle("Contenu de l'embed")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Titre (optionnel)')
            .setValue(session.title)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setValue(session.description)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(4000),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('color')
            .setLabel('Couleur hex (optionnel, ex: #C3FF00)')
            .setValue(session.color ? `#${session.color.toString(16).padStart(6, '0').toUpperCase()}` : '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(7),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'image') {
    const modal = new ModalBuilder()
      .setCustomId('eb:modal:image')
      .setTitle("Image de l'embed")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('url')
            .setLabel("URL externe (vide = retirer l'image)")
            .setPlaceholder('https://i.imgur.com/… (pas de lien Discord, ils expirent)')
            .setValue(session.image?.startsWith('file:') ? '' : (session.image ?? ''))
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(500),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'upload') {
    const { requestImageUpload } = require('./customCommands');
    requestImageUpload(interaction, { kind: 'embed' });
    return interaction.reply({
      content:
        "📎 **Envoie l'image dans ce salon** (pièce jointe — stockée sur le serveur). Une fois la confirmation reçue, clique **🔄 Aperçu** sur le panneau. ⏱️ 2 minutes.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === 'button') {
    const modal = new ModalBuilder()
      .setCustomId('eb:modal:buttons')
      .setTitle("Boutons-liens sous l'embed")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('lines')
            .setLabel('Un par ligne : Texte | https://lien (5 max)')
            .setValue(session.buttons.map((b) => `${b.label} | ${b.url}`).join('\n'))
            .setPlaceholder('🛒 Boutique | https://exemple.com\n⭐ Avis | https://discord.gg/…')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'mention') {
    const modal = new ModalBuilder()
      .setCustomId('eb:modal:mention')
      .setTitle("Mention au-dessus de l'embed")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('mention')
            .setLabel('@everyone, @here, IDs de rôles (||=caché)')
            .setValue(session.mention ?? '')
            .setPlaceholder('||@everyone|| ou 123456789012345678 — vide = aucune')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(300),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'target') {
    const modal = new ModalBuilder()
      .setCustomId('eb:modal:target')
      .setTitle('Destination (remplis UN seul champ)')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('channel')
            .setLabel('Salon : ID, mention <#…> ou lien')
            .setValue(session.target.channelId ?? '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('user')
            .setLabel('MP à un membre : ID ou mention')
            .setValue(session.target.userId ?? '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('role')
            .setLabel('MP à tout un rôle : ID ou mention')
            .setValue(session.target.roleId ?? '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'import') {
    const modal = new ModalBuilder()
      .setCustomId('eb:modal:import')
      .setTitle('Importer un embed existant')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('link')
            .setLabel("Lien du message contenant l'embed")
            .setPlaceholder('Clic droit sur le message → Copier le lien')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'send') {
    const { embed, files, components } = buildFinalEmbed(guild, session, interaction.user);

    // Envoi de masse à un rôle : confirmation obligatoire avec le nombre exact
    if (session.target.roleId) {
      // Le fetch de tous les membres dépasse les 3 s accordées par Discord : on acquitte avant
      await interaction.deferUpdate().catch(() => {});
      await guild.members.fetch().catch(() => {});
      const recipients = guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(session.target.roleId));
      if (!recipients.size) {
        return interaction.followUp({
          content: "❌ Aucun membre (non-bot) n'a ce rôle.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const confirm = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('eb:confirmsend')
          .setLabel(`✅ Confirmer l'envoi à ${recipients.size} membre(s)`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('eb:refresh').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
      );
      return interaction.editReply({
        content: [
          `⚠️ **Tu vas envoyer cet embed en MP à ${recipients.size} membre(s)** du rôle <@&${session.target.roleId}>.`,
          `Envoi espacé (~1,2s/MP, soit ~${Math.ceil((recipients.size * 1.2) / 60)} min). Les MP de masse peuvent être limités par Discord : réserve ça aux petits rôles ou aux occasions importantes.`,
        ].join('\n'),
        embeds: [embed],
        files,
        components: [confirm],
      });
    }

    // Envoi réel (salon ou MP direct) : verrou anti-double-clic (deux clics avant
    // que le panneau ne se ferme liraient le même brouillon → deux envois)
    if (session.sending) return interaction.deferUpdate().catch(() => {});
    session.sending = true;
    // L'envoi (fetch + send, éventuellement avec image) peut dépasser les 3 s : on acquitte avant
    await interaction.deferUpdate().catch(() => {});

    if (session.target.userId) {
      const user = await guild.client.users.fetch(session.target.userId).catch(() => null);
      const sent =
        user &&
        (await user
          .send({ embeds: [embed], files, components, nonce: `eb-${interaction.id}`, enforceNonce: true })
          .then(() => true)
          .catch(() => false));
      resetSession(guild.id, interaction.user.id);
      return interaction.editReply({
        content: sent ? `✅ Embed envoyé en MP à ${user}.` : "❌ Impossible d'envoyer le MP (MPs fermés ?).",
        embeds: [],
        components: [],
        files: [],
      });
    }

    // La mention ne s'applique qu'aux envois en salon (aucun ping possible en MP)
    const mention = mentionContent(session.mention);
    const channel = session.target.channelId ? guild.channels.cache.get(session.target.channelId) : interaction.channel;
    // nonce + enforceNonce : si le réseau coupe pendant l'envoi, @discordjs/rest
    // rejoue la requête alors que Discord a peut-être déjà créé le message.
    // Le nonce est lié au clic : le rejeu retombe sur le message existant.
    const sent =
      channel &&
      (await channel
        .send({
          ...(mention ? { content: mention } : {}),
          embeds: [embed],
          files,
          components,
          nonce: `eb-${interaction.id}`.slice(0, 25),
          enforceNonce: true,
        })
        .then(() => true)
        .catch(() => false));
    resetSession(guild.id, interaction.user.id);
    return interaction.editReply({
      content: sent
        ? `✅ Embed publié dans ${channel}.`
        : '❌ Impossible de publier (salon introuvable ou permissions).',
      embeds: [],
      components: [],
      files: [],
    });
  }

  if (action === 'confirmsend') {
    const roleId = session.target.roleId;
    if (!roleId) return interaction.update(builderView(guild, interaction.user.id));
    if (session.sending) return interaction.deferUpdate().catch(() => {});
    session.sending = true;
    // Le fetch de tous les membres dépasse les 3 s accordées par Discord : on acquitte avant
    await interaction.deferUpdate().catch(() => {});
    const { embed, files, components } = buildFinalEmbed(guild, session, interaction.user);
    await guild.members.fetch().catch(() => {});
    const recipients = [...guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(roleId)).values()];
    resetSession(guild.id, interaction.user.id);

    await interaction.editReply({
      content: `🚀 Envoi en cours à **${recipients.length}** membre(s)… je te fais un rapport à la fin (ici si possible, sinon en MP).`,
      embeds: [],
      components: [],
      files: [],
    });

    // Envoi en arrière-plan, espacé pour respecter les limites Discord
    (async () => {
      let sent = 0;
      let failed = 0;
      let i = 0;
      for (const member of recipients) {
        // Nonce distinct par destinataire : le rejeu réseau d'UN MP ne le double
        // pas, sans risquer de dédupliquer les MP des autres membres
        const nonce = `e${i++}-${interaction.id}`.slice(0, 25);
        const ok = await member
          .send({ embeds: [embed], files, components, nonce, enforceNonce: true })
          .then(() => true)
          .catch(() => false);
        if (ok) sent++;
        else failed++;
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });
      }
      const report = `📬 **Envoi terminé** : ${sent} MP envoyé(s), ${failed} échec(s) (MP fermés).`;
      const updated = await interaction
        .editReply({ content: report })
        .then(() => true)
        .catch(() => false);
      if (!updated) await interaction.user.send(report).catch(() => {});
    })().catch((error) => console.error('Erreur envoi MP de masse :', error));
    return;
  }

  // ── Formulaires ──
  if (action === 'modal') {
    const kind = interaction.customId.split(':')[2];

    if (kind === 'content') {
      const hex = interaction.fields.getTextInputValue('color').trim().replace(/^#/, '');
      if (hex && !/^[0-9a-f]{6}$/i.test(hex)) {
        return interaction.reply({
          content: '❌ Couleur invalide. Exemple : `#C3FF00`',
          flags: MessageFlags.Ephemeral,
        });
      }
      session.title = interaction.fields.getTextInputValue('title').trim();
      session.description = interaction.fields.getTextInputValue('description').trim();
      session.color = hex ? parseInt(hex, 16) : null;
      return interaction.update(builderView(guild, interaction.user.id));
    }

    if (kind === 'image') {
      const url = interaction.fields.getTextInputValue('url').trim();
      if (url && !/^https?:\/\/\S+$/.test(url)) {
        return interaction.reply({
          content: '❌ URL invalide (elle doit commencer par http/https).',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (url && /(cdn|media)\.discordapp\.(com|net)/.test(url)) {
        return interaction.reply({
          content: "❌ Les liens d'images Discord expirent — utilise 📎 Image upload à la place.",
          flags: MessageFlags.Ephemeral,
        });
      }
      session.image = url || null;
      return interaction.update(builderView(guild, interaction.user.id));
    }

    if (kind === 'buttons') {
      const buttons = parseButtonLines(interaction.fields.getTextInputValue('lines'));
      if (!buttons) {
        return interaction.reply({
          content: '❌ Format invalide : une ligne par bouton, `Texte | https://lien`, 5 boutons maximum.',
          flags: MessageFlags.Ephemeral,
        });
      }
      session.buttons = buttons;
      return interaction.update(builderView(guild, interaction.user.id));
    }

    if (kind === 'mention') {
      session.mention = interaction.fields.getTextInputValue('mention').trim();
      return interaction.update(builderView(guild, interaction.user.id));
    }

    if (kind === 'target') {
      const pick = (value) => {
        const matches = String(value ?? '').match(/\d{15,20}/g);
        return matches ? matches[matches.length - 1] : null;
      };
      const channelId = pick(interaction.fields.getTextInputValue('channel'));
      const userId = pick(interaction.fields.getTextInputValue('user'));
      const roleId = pick(interaction.fields.getTextInputValue('role'));

      if (roleId && !guild.roles.cache.has(roleId)) {
        return interaction.reply({ content: '❌ Rôle introuvable sur ce serveur.', flags: MessageFlags.Ephemeral });
      }
      if (userId && !(await guild.members.fetch(userId).catch(() => null))) {
        return interaction.reply({ content: '❌ Membre introuvable sur ce serveur.', flags: MessageFlags.Ephemeral });
      }
      if (channelId) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isVoiceBased() || channel.isThread()) {
          return interaction.reply({
            content: '❌ Salon textuel introuvable sur ce serveur.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // Priorité : rôle > membre > salon ; tout vide = salon courant
      session.target = roleId ? { roleId } : userId ? { userId } : channelId ? { channelId } : {};
      return interaction.update(builderView(guild, interaction.user.id));
    }

    if (kind === 'import') {
      const ids = String(interaction.fields.getTextInputValue('link')).match(/\d{15,20}/g) ?? [];
      if (ids.length < 2) {
        return interaction.reply({
          content: '❌ Lien invalide. Clic droit sur le message → **Copier le lien**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const [channelId, messageId] = ids.slice(-2);
      const channel = guild.channels.cache.get(channelId);
      const message = channel?.isTextBased() && (await channel.messages.fetch(messageId).catch(() => null));
      const source = message?.embeds?.[0];
      if (!source) {
        return interaction.reply({
          content: '❌ Aucun embed trouvé à ce lien (message introuvable ou sans embed).',
          flags: MessageFlags.Ephemeral,
        });
      }
      session.title = source.title ?? '';
      session.description = source.description ?? '';
      session.color = source.color ?? null;
      session.image = source.image?.url ?? null;
      session.buttons = [];
      for (const row of message.components ?? []) {
        for (const component of row.components ?? []) {
          if (component.style === ButtonStyle.Link && component.url && session.buttons.length < 5) {
            session.buttons.push({ label: component.label ?? 'Lien', url: component.url });
          }
        }
      }
      return interaction.update(builderView(guild, interaction.user.id));
    }
  }
}

module.exports = { getSession, builderView, handleEmbedComponent };
