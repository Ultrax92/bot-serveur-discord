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

// Données vivantes du serveur, pour restaurer un bot À L'IDENTIQUE :
// casier des sanctions, tickets (dont la numérotation), compteurs
// d'invitations, giveaways en cours, vocaux temporaires suivis
const TABLE_COLUMNS = {
  sanctions: ['id', 'guild_id', 'user_id', 'moderator_id', 'type', 'reason', 'created_at', 'expires_at', 'active'],
  tickets: ['id', 'guild_id', 'channel_id', 'user_id', 'number', 'type_id', 'status', 'claimed_by', 'created_at'],
  invite_joins: ['guild_id', 'user_id', 'inviter_id', 'code', 'fake', 'has_left', 'joined_at'],
  giveaways: ['id', 'guild_id', 'channel_id', 'message_id', 'prize', 'winners', 'host_id', 'required_role', 'ends_at', 'ended', 'participants'],
  tempvoc_channels: ['channel_id', 'guild_id', 'owner_id'],
};

function collectDatabase(guildId) {
  const database = {};
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    database[table] = db.prepare(`SELECT ${columns.join(', ')} FROM ${table} WHERE guild_id = ?`).all(guildId);
  }
  return database;
}

function restoreDatabase(guildId, database) {
  if (!database || typeof database !== 'object') return 0;
  let restored = 0;
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const rows = database[table];
    if (!Array.isArray(rows)) continue;
    db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
    const insertWithId = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`);
    const columnsNoId = columns.filter((c) => c !== 'id');
    const insertNoId = db.prepare(`INSERT INTO ${table} (${columnsNoId.join(', ')}) VALUES (${columnsNoId.map((c) => `@${c}`).join(', ')})`);
    for (const row of rows) {
      const values = {};
      for (const column of columns) values[column] = row[column] ?? null;
      try {
        insertWithId.run(values);
        restored++;
      } catch {
        // Conflit d'id (autre serveur) : réinsère avec un nouvel id
        try { insertNoId.run(values); restored++; } catch { /* ligne ignorée */ }
      }
    }
  }
  return restored;
}

function serialize(guildId) {
  const settings = getSettings(guildId);
  const { getActivityText } = require('./botStatus');
  return JSON.stringify({
    bot: 'bot-serveur-discord',
    version: 2,
    guildId,
    createdAt: Date.now(),
    settings,
    files: collectImageFiles(settings),
    database: collectDatabase(guildId),
    botActivity: getActivityText(),
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

// Export du backup auto en MP au owner : off → weekly (lundi) → daily
const DM_EXPORT_ORDER = ['off', 'weekly', 'daily'];
const DM_EXPORT_LABELS = { off: 'OFF', weekly: 'Hebdo', daily: 'Quotidien' };

function backupPanel(guild, userId) {
  const rows = listStmt.all(guild.id);
  const staged = pendingImports.get(`${guild.id}:${userId}`)?.staged;
  const settings = getSettings(guild.id);
  const dmExport = settings.backupsConfig?.dmExport ?? 'off';

  const embed = new EmbedBuilder()
    .setColor(settings.color)
    .setTitle('💾 Backups du bot')
    .setDescription([
      'Sauvegarde/restauration **complète et à l\'identique** : toute la configuration (modules, logs, tickets et leurs types, automod, antiraid, commandes custom…), les **images**, et les **données** (casier des sanctions, numérotation des tickets, compteurs d\'invitations, giveaways, statut du bot).',
      '',
      `**Backups en base (${rows.length}/15${isModuleEnabled(guild.id, 'backups') ? ', auto quotidien 🟢' : ', auto quotidien 🔴 — active le module 💾'}) :**`,
      rows.length
        ? rows.map((r) => `\`#${r.id}\` — <t:${Math.floor(r.created_at / 1000)}:f> · ${r.kind} · ${(r.size / 1024).toFixed(1)} Ko`).join('\n')
        : '*Aucun backup pour l\'instant.*',
      `\n📬 **Export en MP au owner :** ${dmExport === 'off' ? '🔴 désactivé' : dmExport === 'weekly' ? '🟢 hebdomadaire (lundi, après le backup auto)' : '🟢 quotidien (après le backup auto)'}`,
      staged ? `\n📦 **Import prêt à appliquer** : backup du <t:${Math.floor(staged.createdAt / 1000)}:f>${staged.guildId !== guild.id ? ' ⚠️ *provenant d\'un autre serveur*' : ''} → clique ♻️` : '',
      '',
      '✅ *Backup complet : config + images + données — l\'import restaure le bot à l\'identique.*',
    ].filter(Boolean).join('\n'));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bk:create').setLabel('💾 Créer un backup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bk:import').setLabel('📤 Importer un fichier').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bk:applyimport').setLabel('♻️ Appliquer l\'import').setStyle(ButtonStyle.Danger)
      .setDisabled(!staged),
    new ButtonBuilder().setCustomId('bk:dmexport').setLabel(`📬 MP : ${DM_EXPORT_LABELS[dmExport]}`)
      .setStyle(dmExport === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
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

  if (action === 'dmexport') {
    updateSettings(guild.id, (s) => {
      const current = s.backupsConfig?.dmExport ?? 'off';
      const next = DM_EXPORT_ORDER[(DM_EXPORT_ORDER.indexOf(current) + 1) % DM_EXPORT_ORDER.length];
      s.backupsConfig = { ...s.backupsConfig, dmExport: next };
      if (next !== 'off') s.modules.backups = true; // l'export part du backup auto : configurer = activer
    });
    return interaction.update(backupPanel(guild, interaction.user.id));
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
    const images = restoreImageFiles(payload.files);
    const rows = restoreDatabase(guild.id, payload.database);
    if (typeof payload.botActivity === 'string') {
      require('./botStatus').setActivityText(interaction.client, payload.botActivity);
    }
    await interaction.update(backupPanel(guild, interaction.user.id));
    return interaction.followUp({
      content: [
        '♻️ **Bot restauré à l\'identique !**',
        `• Configuration complète appliquée${images ? ` • ${images} image(s)` : ''}${rows ? ` • ${rows} donnée(s) : sanctions, tickets, invitations, giveaways` : ''}`,
        'Vérifie dans `/setup` (un backup pré-restauration a été créé au cas où).',
      ].join('\n'),
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
  if (!parsed || parsed.bot !== 'bot-serveur-discord' || ![1, 2].includes(parsed.version) || typeof parsed.settings?.modules !== 'object') {
    await notice('❌ Ce fichier n\'est pas un backup valide de ce bot.');
    return true;
  }

  pending.staged = parsed;
  pending.expires = Date.now() + 10 * 60_000; // 10 min pour appliquer
  await notice('✅ Backup lu ! Retourne sur ton panneau `/backup` → **🔄 Actualiser** → **♻️ Appliquer l\'import**.');
  return true;
}

// Limite d'upload d'un bot en MP (~10 Mo) : au-delà, le backup part sans les images
const DM_FILE_LIMIT = 9 * 1024 * 1024;

async function sendBackupDM(client, guild, data, createdAt) {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) return;
  let file = backupFile(guild.id, data, createdAt);
  let warning = '';
  if (Buffer.byteLength(data, 'utf8') > DM_FILE_LIMIT) {
    const light = JSON.parse(data);
    delete light.files;
    file = backupFile(guild.id, JSON.stringify(light, null, 2), createdAt);
    warning = '\n⚠️ Backup trop volumineux pour Discord : envoyé **sans les images** (elles restent sur le VPS uniquement).';
  }
  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send({
      content: `📬 Backup automatique de **${guild.name}** — garde ce fichier en lieu sûr, il restaure le bot à l'identique via \`/backup\` → 📤 Importer.${warning}`,
      files: [file],
    });
  } catch (error) {
    console.error(`[backups] Envoi du backup en MP au owner impossible (serveur ${guild.id}) :`, error.message);
  }
}

// Backup automatique quotidien (4h30) pour les serveurs avec le module 💾 actif,
// suivi de l'export en MP au owner si activé (quotidien, ou hebdo le lundi)
function startBackupWorker(client) {
  const tick = () => {
    for (const guild of client.guilds.cache.values()) {
      if (!isModuleEnabled(guild.id, 'backups')) continue;
      const id = createBackup(guild.id, 'auto');
      const dmExport = getSettings(guild.id).backupsConfig?.dmExport ?? 'off';
      if (dmExport === 'daily' || (dmExport === 'weekly' && new Date().getDay() === 1)) {
        const row = getStmt.get(id, guild.id);
        if (row) sendBackupDM(client, guild, row.data, row.created_at);
      }
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
