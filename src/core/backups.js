const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags, AttachmentBuilder,
} = require('discord.js');
const db = require('./db');
const { getSettings, saveSettings, updateSettings, isModuleEnabled } = require('./settings');

const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');

const insertStmt = db.prepare('INSERT INTO backups (guild_id, kind, created_at, data) VALUES (?, ?, ?, ?)');
const listStmt = db.prepare('SELECT id, kind, created_at, LENGTH(data) AS size FROM backups WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10');
const getStmt = db.prepare('SELECT * FROM backups WHERE id = ? AND guild_id = ?');
const deleteStmt = db.prepare('DELETE FROM backups WHERE id = ? AND guild_id = ?');
const pruneStmt = db.prepare(`
  DELETE FROM backups WHERE guild_id = ? AND id NOT IN (
    SELECT id FROM backups WHERE guild_id = ? ORDER BY created_at DESC LIMIT 15
  )
`);

// Fichiers d'import en attente : "guildId:userId" → { channelId, expires, staged }
const pendingImports = new Map();

// Les images stockées sur le VPS (commandes custom, panneau tickets) sont
// incluses dans le backup en base64 pour une restauration complète
function collectImageFiles(settings) {
  const refs = [];
  if (settings.ticketsConfig?.panelImage?.startsWith('file:')) refs.push(settings.ticketsConfig.panelImage.slice(5));
  for (const command of settings.customCommands ?? []) {
    if (command.response?.image?.startsWith('file:')) refs.push(command.response.image.slice(5));
  }
  const files = {};
  for (const name of refs) {
    const filePath = path.join(imagesDir, name);
    if (fs.existsSync(filePath)) files[name] = fs.readFileSync(filePath).toString('base64');
  }
  return files;
}

function restoreImageFiles(files) {
  if (!files || typeof files !== 'object') return 0;
  fs.mkdirSync(imagesDir, { recursive: true });
  let restored = 0;
  for (const [name, base64] of Object.entries(files)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue; // pas de chemins traversants
    try {
      fs.writeFileSync(path.join(imagesDir, name), Buffer.from(base64, 'base64'));
      restored++;
    } catch { /* image ignorée */ }
  }
  return restored;
}

function serialize(guildId) {
  const settings = getSettings(guildId);
  return JSON.stringify({
    bot: 'bot-serveur-discord',
    version: 1,
    guildId,
    createdAt: Date.now(),
    settings,
    files: collectImageFiles(settings),
  }, null, 2);
}

function createBackup(guildId, kind = 'manuel') {
  const info = insertStmt.run(guildId, kind, Date.now(), serialize(guildId));
  pruneStmt.run(guildId, guildId);
  return info.lastInsertRowid;
}

function backupFile(guildId, data, createdAt) {
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return new AttachmentBuilder(Buffer.from(data, 'utf8'), { name: `backup-settings-${guildId}-${date}.json` });
}

// ── Panneau /backup (éphémère) ────────────────────────────────────────────────

function backupPanel(guild, userId) {
  const rows = listStmt.all(guild.id);
  const staged = pendingImports.get(`${guild.id}:${userId}`)?.staged;

  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle('💾 Backups des settings')
    .setDescription([
      'Sauvegarde/restauration de **toute la configuration du bot** pour ce serveur (modules, logs, tickets, automod, antiraid, commandes custom…).',
      '',
      `**Backups en base (${rows.length}/15${isModuleEnabled(guild.id, 'backups') ? ', auto quotidien 🟢' : ', auto quotidien 🔴 — active le module 💾'}) :**`,
      rows.length
        ? rows.map((r) => `\`#${r.id}\` — <t:${Math.floor(r.created_at / 1000)}:f> · ${r.kind} · ${(r.size / 1024).toFixed(1)} Ko`).join('\n')
        : '*Aucun backup pour l\'instant.*',
      staged ? `\n📦 **Import prêt à appliquer** : backup du <t:${Math.floor(staged.createdAt / 1000)}:f>${staged.guildId !== guild.id ? ' ⚠️ *provenant d\'un autre serveur*' : ''} → clique ♻️` : '',
      '',
      '✅ *Les images (commandes custom, panneau tickets) sont incluses dans le backup et restaurées à l\'import.*',
    ].filter(Boolean).join('\n'));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bk:create').setLabel('💾 Créer un backup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bk:import').setLabel('📤 Importer un fichier').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bk:applyimport').setLabel('♻️ Appliquer l\'import').setStyle(ButtonStyle.Danger)
      .setDisabled(!staged),
    new ButtonBuilder().setCustomId('bk:home').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );

  const components = [buttons];
  if (rows.length) {
    components.unshift(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('bk:pick')
        .setPlaceholder('📂 Ouvrir un backup (télécharger, restaurer, supprimer)…')
        .addOptions(rows.map((r) => new StringSelectMenuOptionBuilder()
          .setValue(`${r.id}`)
          .setLabel(`#${r.id} — ${new Date(r.created_at).toLocaleString('fr-FR')}`)
          .setDescription(`${r.kind} · ${(r.size / 1024).toFixed(1)} Ko`))),
    ));
  }

  return { embeds: [embed], components };
}

function backupDetail(guild, backupId) {
  const row = getStmt.get(backupId, guild.id);
  if (!row) return backupPanel(guild, 'none');

  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle(`💾 Backup #${row.id}`)
    .setDescription([
      `**Créé :** <t:${Math.floor(row.created_at / 1000)}:f> (${row.kind})`,
      `**Taille :** ${(row.data.length / 1024).toFixed(1)} Ko`,
      '',
      '📥 **Télécharger** → reçois le fichier .json à garder en local',
      '♻️ **Restaurer** → remplace la configuration actuelle par celle-ci',
    ].join('\n'));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bk:download:${row.id}`).setLabel('📥 Télécharger').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bk:restore:${row.id}`).setLabel('♻️ Restaurer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`bk:delete:${row.id}`).setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bk:home').setLabel('◀️ Retour').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttons] };
}

function confirmView(guild, target, label) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ Confirmer la restauration')
    .setDescription([
      `Tu vas **remplacer toute la configuration actuelle** du bot par ${label}.`,
      'Un backup *pré-restauration* de la configuration actuelle sera créé automatiquement avant, au cas où.',
    ].join('\n'));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bk:confirm:${target}`).setLabel('⚠️ Oui, restaurer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('bk:home').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttons] };
}

// ── Interactions (customId "bk:...") ─────────────────────────────────────────

async function handleBackupComponent(interaction) {
  const guild = interaction.guild;
  const [, action, arg] = interaction.customId.split(':');
  const key = `${guild.id}:${interaction.user.id}`;

  if (action === 'home') return interaction.update(backupPanel(guild, interaction.user.id));

  if (action === 'create') {
    const id = createBackup(guild.id, 'manuel');
    updateSettings(guild.id, (s) => { s.modules.backups = true; }); // active l'auto quotidien
    await interaction.update(backupPanel(guild, interaction.user.id));
    const row = getStmt.get(id, guild.id);
    return interaction.followUp({
      content: `✅ Backup \`#${id}\` créé et stocké sur le serveur ! Le veux-tu en local ? Le voici :`,
      files: [backupFile(guild.id, row.data, row.created_at)],
      flags: MessageFlags.Ephemeral,
    }).catch(() => interaction.followUp({
      content: `✅ Backup \`#${id}\` créé et stocké sur le serveur — mais **trop volumineux pour être envoyé sur Discord** (images lourdes). Allège tes images ou récupère \`data/bot.sqlite\` depuis le VPS.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {}));
  }

  if (action === 'import') {
    pendingImports.set(key, { channelId: interaction.channelId, expires: Date.now() + 120_000 });
    return interaction.reply({
      content: '📤 **Envoie ton fichier de backup `.json` dans ce salon** (⏱️ 2 minutes). Je le lirai, puis tu cliqueras ♻️ **Appliquer l\'import** sur le panneau (🔄 Actualiser pour le voir apparaître).',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === 'pick') return interaction.update(backupDetail(guild, interaction.values[0]));

  if (action === 'download') {
    const row = getStmt.get(arg, guild.id);
    if (!row) return interaction.update(backupPanel(guild, interaction.user.id));
    return interaction.reply({
      content: `📥 Backup \`#${row.id}\` — garde ce fichier en lieu sûr :`,
      files: [backupFile(guild.id, row.data, row.created_at)],
      flags: MessageFlags.Ephemeral,
    }).catch(() => interaction.reply({
      content: `❌ Backup \`#${row.id}\` **trop volumineux pour Discord** (images lourdes). Récupère \`data/bot.sqlite\` depuis le VPS, ou allège tes images et recrée un backup.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {}));
  }

  if (action === 'restore') return interaction.update(confirmView(guild, arg, `le backup \`#${arg}\``));

  if (action === 'applyimport') {
    const staged = pendingImports.get(key)?.staged;
    if (!staged) return interaction.update(backupPanel(guild, interaction.user.id));
    return interaction.update(confirmView(guild, 'staged', `le fichier importé (backup du ${new Date(staged.createdAt).toLocaleString('fr-FR')})`));
  }

  if (action === 'confirm') {
    let payload;
    if (arg === 'staged') {
      payload = pendingImports.get(key)?.staged;
      pendingImports.delete(key);
    } else {
      const row = getStmt.get(arg, guild.id);
      payload = row && JSON.parse(row.data);
    }
    if (!payload?.settings) {
      return interaction.update(backupPanel(guild, interaction.user.id));
    }
    createBackup(guild.id, 'pré-restauration');
    saveSettings(guild.id, payload.settings);
    const restored = restoreImageFiles(payload.files);
    await interaction.update(backupPanel(guild, interaction.user.id));
    return interaction.followUp({
      content: `♻️ **Configuration restaurée !**${restored ? ` ${restored} image(s) restaurée(s) sur le serveur.` : ''} Vérifie tes réglages dans \`/setup\` (un backup pré-restauration a été créé au cas où).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === 'delete') {
    deleteStmt.run(arg, guild.id);
    return interaction.update(backupPanel(guild, interaction.user.id));
  }
}

// Fichier .json envoyé après un clic sur 📤 Importer
async function handlePendingBackupFile(message) {
  if (!message.inGuild() || message.author.bot) return false;
  const key = `${message.guildId}:${message.author.id}`;
  const pending = pendingImports.get(key);
  if (!pending || pending.staged) return false;
  if (Date.now() > pending.expires) {
    pendingImports.delete(key);
    return false;
  }
  if (message.channelId !== pending.channelId) return false;

  const attachment = message.attachments.first();
  if (!attachment || !attachment.name?.endsWith('.json')) return false;

  const notice = async (text) => {
    const sent = await message.channel.send(text).catch(() => null);
    if (sent) setTimeout(() => sent.delete().catch(() => {}), 8000);
  };

  if (attachment.size > 25 * 1024 * 1024) {
    await message.delete().catch(() => {});
    await notice('❌ Fichier trop gros pour être un backup valide.');
    return true;
  }

  const response = await fetch(attachment.url).catch(() => null);
  const text = response?.ok ? await response.text() : null;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* invalide */ }

  await message.delete().catch(() => {});
  if (!parsed || parsed.bot !== 'bot-serveur-discord' || parsed.version !== 1 || typeof parsed.settings?.modules !== 'object') {
    await notice('❌ Ce fichier n\'est pas un backup valide de ce bot.');
    return true;
  }

  pending.staged = parsed;
  pending.expires = Date.now() + 10 * 60_000; // 10 min pour appliquer
  await notice('✅ Backup lu ! Retourne sur ton panneau `/backup` → **🔄 Actualiser** → **♻️ Appliquer l\'import**.');
  return true;
}

// Backup automatique quotidien (4h30) pour les serveurs avec le module 💾 actif
function startBackupWorker(client) {
  const tick = () => {
    for (const guild of client.guilds.cache.values()) {
      if (isModuleEnabled(guild.id, 'backups')) createBackup(guild.id, 'auto');
    }
  };
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(4, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => { tick(); scheduleNext(); }, next.getTime() - now.getTime());
  };
  scheduleNext();
}

module.exports = { backupPanel, handleBackupComponent, handlePendingBackupFile, startBackupWorker, createBackup };
