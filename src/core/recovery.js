const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ChannelType,
} = require('discord.js');
const db = require('./db');
const { getSettings } = require('./settings');
const { fetchAllMembers, snapshotMemberRoles } = require('./serverBackup');

// Rappel des membres par MP : envoie l'invitation du serveur aux membres connus
// de la photo des backups (table member_roles). Envoi volontairement lent
// (1 MP / 2,5 s) pour ne pas être traité comme du spam par Discord.

const SEND_INTERVAL_MS = 2500;

const knownMembersStmt = db.prepare('SELECT user_id FROM member_roles WHERE guild_id = ?');
const lastSnapshotStmt = db.prepare('SELECT MAX(updated_at) AS at FROM member_roles WHERE guild_id = ?');
const clearMembersStmt = db.prepare('DELETE FROM member_roles WHERE guild_id = ?');

// Brouillons de campagne : "guildId:userId" → { target, message, invite, targets, expires }
const pendingCampaigns = new Map();
// Campagnes en cours : guildId → { cancelled, sent, failed }
const runningCampaigns = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateDuration(count) {
  const minutes = Math.ceil((count * SEND_INTERVAL_MS) / 60_000);
  return minutes <= 1 ? '~1 minute' : `~${minutes} minutes`;
}

function buildDmContent(message, invite) {
  return message.includes('{lien}') ? message.replaceAll('{lien}', invite) : `${message}\n\n${invite}`;
}

// ── Panneau /recovery ─────────────────────────────────────────────────────────

async function recoveryPanel(guild) {
  const known = knownMembersStmt.all(guild.id).map((r) => r.user_id);
  const members = await fetchAllMembers(guild);
  const absent = known.filter((id) => !members.has(id));
  const snapshot = lastSnapshotStmt.get(guild.id)?.at;
  const running = runningCampaigns.get(guild.id);

  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle('📨 Recovery — rappel des membres')
    .setDescription(
      [
        "Envoie en MP l'invitation de **ce serveur** aux membres connus de la photo des backups. Tu écris le message, tu colles un lien d'invitation (ou je le génère), et j'envoie lentement (1 MP / 2,5 s) pour rester sous les radars anti-spam de Discord.",
        '',
        `👥 **Membres connus :** ${known.length}${snapshot ? ` (photo du <t:${Math.floor(snapshot / 1000)}:f>)` : ''} — *la photo n'oublie jamais les partis (backups et imports s'y accumulent), c'est elle qui permet de les rappeler*`,
        `📤 **Absents de ce serveur :** ${absent.length} — ✅ **déjà présents :** ${known.length - absent.length}`,
        running
          ? `\n⏳ **Campagne en cours** : ${running.sent} envoyé(s), ${running.failed} échec(s) — suivi dans tes MP.`
          : null,
        !known.length
          ? "\n⚠️ **Aucun membre connu** — crée un backup sur ton serveur d'origine (ou importe-le ici) pour remplir la photo des membres."
          : null,
        '',
        '*Les MP fermés sont comptés comme injoignables dans le bilan — le force-join OAuth (phase 3) comblera ce trou.*',
      ]
        .filter(Boolean)
        .join('\n'),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rc:start:absent')
      .setLabel(`📨 MP aux absents (${absent.length})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!absent.length || Boolean(running)),
    new ButtonBuilder()
      .setCustomId('rc:start:all')
      .setLabel(`📨 MP à tous (${known.length})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!known.length || Boolean(running)),
    new ButtonBuilder()
      .setCustomId('rc:reset')
      .setLabel('🧹 Réinitialiser la photo')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(Boolean(running)),
    new ButtonBuilder().setCustomId('rc:home').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttons] };
}

// ── Préparation d'une campagne ────────────────────────────────────────────────

function campaignModal(target) {
  return new ModalBuilder()
    .setCustomId(`rc:modal:${target}`)
    .setTitle(target === 'all' ? 'MP à tous les membres connus' : 'MP aux membres absents')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Ton message ({lien} = emplacement du lien)')
          .setPlaceholder('Salut ! MEDUSA SHOP a un nouveau serveur, rejoins-nous ici : {lien}')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1500),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('invite')
          .setLabel("Lien d'invitation (vide = généré automatiquement)")
          .setPlaceholder('https://discord.gg/…')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200),
      ),
    );
}

// Lien collé validé, sinon invitation permanente créée sur un salon du serveur
async function resolveInvite(guild, raw) {
  if (raw) {
    const match = raw.match(/(https?:\/\/)?(discord\.gg|discord(app)?\.com\/invite)\/[\w-]+/i);
    return match ? (match[0].startsWith('http') ? match[0] : `https://${match[0]}`) : null;
  }
  const channel =
    guild.systemChannel ??
    guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has('CreateInstantInvite'))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first();
  if (!channel) return null;
  const invite = await guild.invites
    .create(channel.id, { maxAge: 0, maxUses: 0, reason: 'Campagne de rappel des membres' })
    .catch(() => null);
  return invite?.url ?? null;
}

// ── Envoi de la campagne (suivi en MP au owner, > 15 min possible) ───────────

async function runCampaign(client, guild, campaign) {
  const state = { cancelled: false, sent: 0, failed: 0 };
  runningCampaigns.set(guild.id, state);

  const owner = process.env.OWNER_ID && (await client.users.fetch(process.env.OWNER_ID).catch(() => null));
  const content = buildDmContent(campaign.message, campaign.invite);
  const total = campaign.targets.length;

  const statusView = (done) => ({
    content: [
      `📨 **Campagne de rappel — ${guild.name}**`,
      `${done ? (state.cancelled ? '⏹️ **Arrêtée**' : '✅ **Terminée**') : `⏳ ${state.sent + state.failed}/${total}`} — ${state.sent} envoyé(s) · ${state.failed} injoignable(s) (MP fermés/introuvables)`,
    ].join('\n'),
    components: done
      ? []
      : [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rc:stop:${guild.id}`)
              .setLabel('⏹️ Arrêter la campagne')
              .setStyle(ButtonStyle.Danger),
          ),
        ],
  });

  let statusMessage = owner && (await owner.send(statusView(false)).catch(() => null));

  for (let i = 0; i < total; i++) {
    if (state.cancelled) break;
    const user = await client.users.fetch(campaign.targets[i]).catch(() => null);
    const ok =
      user &&
      (await user
        .send(content)
        .then(() => true)
        .catch(() => false));
    if (ok) state.sent++;
    else state.failed++;
    if (statusMessage && (i + 1) % 10 === 0) await statusMessage.edit(statusView(false)).catch(() => {});
    await sleep(SEND_INTERVAL_MS);
  }

  runningCampaigns.delete(guild.id);
  if (statusMessage) await statusMessage.edit(statusView(true)).catch(() => {});
  else if (owner) await owner.send(statusView(true)).catch(() => {});
}

// ── Interactions (customId "rc:...") ──────────────────────────────────────────

async function handleRecoveryComponent(interaction) {
  const [, action, arg] = interaction.customId.split(':');

  // ⏹️ Stop : cliqué dans les MP du owner, le customId porte l'id du serveur
  if (action === 'stop') {
    const state = runningCampaigns.get(arg);
    if (state) state.cancelled = true;
    return interaction
      .update({ content: "⏹️ Arrêt demandé — la campagne s'interrompt après le MP en cours…", components: [] })
      .catch(() => {});
  }

  const guild = interaction.guild;
  if (!guild) return;
  const key = `${guild.id}:${interaction.user.id}`;

  if (action === 'home') return interaction.update(await recoveryPanel(guild));

  if (action === 'reset') {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🧹 Réinitialiser la photo des membres')
      .setDescription(
        [
          'La photo repartira des **membres actuellement présents** sur ce serveur.',
          '⚠️ Les membres partis seront **oubliés** : plus contactables par une campagne, et leurs rôles ne seront plus restaurés à leur retour.',
        ].join('\n'),
      );
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rc:reset2').setLabel('🧹 Oui, réinitialiser').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('rc:home').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [buttons] });
  }

  if (action === 'reset2') {
    await interaction.deferUpdate();
    clearMembersStmt.run(guild.id);
    await snapshotMemberRoles(guild).catch(() => {});
    return interaction.editReply(await recoveryPanel(guild));
  }

  if (action === 'start') return interaction.showModal(campaignModal(arg));

  if (action === 'modal') {
    if (runningCampaigns.has(guild.id)) {
      return interaction.reply({
        content: '⏳ Une campagne est déjà en cours sur ce serveur.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const rawInvite = interaction.fields.getTextInputValue('invite').trim();
    const invite = await resolveInvite(guild, rawInvite);
    if (!invite) {
      return interaction.reply({
        content: rawInvite
          ? '❌ Ce lien ne ressemble pas à une invitation Discord (`discord.gg/…`).'
          : '❌ Impossible de générer une invitation (vérifie ma permission **Créer une invitation** sur un salon textuel).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const known = knownMembersStmt.all(guild.id).map((r) => r.user_id);
    const members = await fetchAllMembers(guild);
    const targets = arg === 'all' ? known : known.filter((id) => !members.has(id));
    if (!targets.length) {
      return interaction.reply({
        content: '❌ Aucun membre à contacter avec cette cible.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const message = interaction.fields.getTextInputValue('message').trim();
    pendingCampaigns.set(key, { target: arg, message, invite, targets, expires: Date.now() + 10 * 60_000 });

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle('📨 Confirmer la campagne')
      .setDescription(
        [
          `**Cibles :** ${targets.length} membre(s) ${arg === 'all' ? 'connus (présents inclus)' : 'absents du serveur'}`,
          `**Durée estimée :** ${estimateDuration(targets.length)} (1 MP / 2,5 s) — suivi et bouton ⏹️ dans tes MP`,
          '',
          '**Aperçu du MP :**',
          `>>> ${buildDmContent(message, invite).slice(0, 1500)}`,
        ].join('\n'),
      );
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rc:go').setLabel('✅ Lancer la campagne').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rc:home').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
    );
    return interaction.isFromMessage()
      ? interaction.update({ embeds: [embed], components: [buttons] })
      : interaction.reply({ embeds: [embed], components: [buttons], flags: MessageFlags.Ephemeral });
  }

  if (action === 'go') {
    const campaign = pendingCampaigns.get(key);
    pendingCampaigns.delete(key);
    if (!campaign || Date.now() > campaign.expires) {
      return interaction.update(await recoveryPanel(guild));
    }
    if (runningCampaigns.has(guild.id)) {
      return interaction.reply({
        content: '⏳ Une campagne est déjà en cours sur ce serveur.',
        flags: MessageFlags.Ephemeral,
      });
    }
    // Lancée avant le refresh : l'état "campagne en cours" est posé de façon synchrone
    runCampaign(interaction.client, guild, campaign).catch((error) => {
      runningCampaigns.delete(guild.id);
      console.error('[recovery] Erreur pendant la campagne :', error);
    });
    return interaction.update(await recoveryPanel(guild));
  }
}

module.exports = { recoveryPanel, handleRecoveryComponent };
