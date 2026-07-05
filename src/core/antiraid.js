const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getSettings, isModuleEnabled } = require('./settings');
const { isOwner } = require('./permissions');
const { addSanction } = require('./sanctions');
const { sendLog, userAuthor, idLine } = require('./logs');

// Fenêtres glissantes de comptage : "guildId:userId:kind" → timestamps
const trackers = new Map();
// Anti-spam d'alertes mass-join : guildId → date de la dernière alerte
const lastMassJoinAlert = new Map();

function track(key, windowMs) {
  const now = Date.now();
  const timestamps = (trackers.get(key) ?? []).filter((t) => now - t < windowMs);
  timestamps.push(now);
  trackers.set(key, timestamps);
  return timestamps.length;
}

function isExempt(guild, userId) {
  if (!userId) return true;
  if (userId === guild.client.user.id) return true;
  if (userId === guild.ownerId || isOwner(userId)) return true;
  return getSettings(guild.id).antiraidConfig.whitelist.includes(userId);
}

// Récupère l'auteur de la dernière action de ce type dans les audit logs
async function getExecutor(guild, auditType) {
  const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  if (!entry || Date.now() - entry.createdTimestamp > 10_000) return null;
  return entry.executor ?? null;
}

async function raidLog(guild, executor, description, action) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription([
      `🛡️ **${description}**`,
      executor ? idLine(executor) : null,
      `**Action :** ${action}`,
    ].filter(Boolean).join('\n'))
    .setTimestamp();
  if (executor) embed.setAuthor(userAuthor(executor));
  await sendLog(guild, 'raid', embed);
}

// Applique la punition configurée à l'auteur du raid.
// Un simple derank ne suffit pas (repasser la vérification suffirait à
// récupérer un rôle) : le derank est donc toujours couplé à un mute 24h,
// ou remplacé par un ban 24h / définitif.
const DAY_MS = 24 * 3_600_000;

async function punish(guild, executor, trigger) {
  const config = getSettings(guild.id).antiraidConfig;
  const sanction = ['mute', 'ban24', 'ban'].includes(config.sanction) ? config.sanction : 'mute';
  const reason = `Antiraid : ${trigger}`;
  let action = 'aucune (membre introuvable)';

  if (sanction === 'mute') {
    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (member) {
      const removable = member.roles.cache.filter((r) =>
        r.id !== guild.roles.everyone.id && !r.managed && r.position < guild.members.me.roles.highest.position);
      await member.roles.remove(removable, reason).catch(() => {});
      await member.timeout(DAY_MS, reason).catch(() => {});
      action = `derank complet (${removable.size} rôle(s)) + mute 24h`;
      addSanction({ guildId: guild.id, userId: executor.id, moderatorId: guild.client.user.id, type: 'mute', reason, expiresAt: Date.now() + DAY_MS });
    }
  } else if (sanction === 'ban24') {
    const banned = await guild.bans.create(executor.id, { reason }).then(() => true).catch(() => false);
    if (banned) {
      action = 'ban 24h (levé automatiquement)';
      addSanction({ guildId: guild.id, userId: executor.id, moderatorId: guild.client.user.id, type: 'ban', reason, expiresAt: Date.now() + DAY_MS });
    }
  } else {
    const banned = await guild.bans.create(executor.id, { reason }).then(() => true).catch(() => false);
    if (banned) {
      action = 'ban définitif';
      addSanction({ guildId: guild.id, userId: executor.id, moderatorId: guild.client.user.id, type: 'ban', reason });
    }
  }

  await raidLog(guild, executor, trigger, action);
}

// Compte une action destructrice et punit si le seuil est franchi
async function checkBurst(guild, auditType, kind, label) {
  const config = getSettings(guild.id).antiraidConfig[kind];
  if (!config?.enabled) return;
  const executor = await getExecutor(guild, auditType);
  if (!executor || isExempt(guild, executor.id)) return;

  const count = track(`${guild.id}:${executor.id}:${kind}`, config.seconds * 1000);
  if (count >= config.max) {
    trackers.delete(`${guild.id}:${executor.id}:${kind}`);
    await punish(guild, executor, `${label} (${count} en ${config.seconds}s)`);
  }
}

const onChannelCreate = (channel) => channel.guild && isModuleEnabled(channel.guild.id, 'antiraid')
  && checkBurst(channel.guild, AuditLogEvent.ChannelCreate, 'antichannel', 'Créations de salons en rafale');
const onChannelDelete = (channel) => channel.guild && isModuleEnabled(channel.guild.id, 'antiraid')
  && checkBurst(channel.guild, AuditLogEvent.ChannelDelete, 'antichannel', 'Suppressions de salons en rafale');
const onRoleCreate = (role) => isModuleEnabled(role.guild.id, 'antiraid')
  && checkBurst(role.guild, AuditLogEvent.RoleCreate, 'antirole', 'Créations de rôles en rafale');
const onRoleDelete = (role) => isModuleEnabled(role.guild.id, 'antiraid')
  && checkBurst(role.guild, AuditLogEvent.RoleDelete, 'antirole', 'Suppressions de rôles en rafale');
const onBanAdd = (ban) => isModuleEnabled(ban.guild.id, 'antiraid')
  && checkBurst(ban.guild, AuditLogEvent.MemberBanAdd, 'antiban', 'Bannissements en rafale');

// Webhook créé par un non-whitelisté : suppression + punition
async function onWebhooksUpdate(channel) {
  const guild = channel.guild;
  if (!guild || !isModuleEnabled(guild.id, 'antiraid')) return;
  if (!getSettings(guild.id).antiraidConfig.antiwebhook.enabled) return;

  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  if (!entry || Date.now() - entry.createdTimestamp > 10_000) return;
  const executor = entry.executor;
  if (!executor || isExempt(guild, executor.id)) return;

  const webhooks = await channel.fetchWebhooks().catch(() => null);
  const webhook = webhooks?.get(entry.target?.id);
  if (webhook) await webhook.delete('Antiraid : webhook non autorisé').catch(() => {});
  await punish(guild, executor, `Création de webhook non autorisée dans #${channel.name}`);
}

// Arrivées : antibot + détection de vague (SANS toucher aux membres en mode alerte)
async function onMemberAdd(member) {
  const guild = member.guild;
  if (!isModuleEnabled(guild.id, 'antiraid')) return;
  const config = getSettings(guild.id).antiraidConfig;

  // Antibot : SEUL LE OWNER peut ajouter des bots (la whitelist ne suffit pas)
  if (member.user.bot && config.antibot.enabled) {
    const executor = await getExecutor(guild, AuditLogEvent.BotAdd);
    const isGuildOwner = executor && (executor.id === guild.ownerId || isOwner(executor.id));
    if (executor && !isGuildOwner) {
      await member.kick('Antiraid : seul le owner peut ajouter des bots').catch(() => {});
      await punish(guild, executor, `Ajout du bot ${member.user.tag} sans autorisation`);
    }
    return;
  }

  // Vague d'arrivées. ⚠️ Pensé pour ne PAS gêner les services de boost :
  // désactivé par défaut, mode "alerte" par défaut (aucune action sur les membres),
  // le mode kick doit être choisi explicitement et le seuil est réglable.
  if (!member.user.bot && config.massjoin.enabled) {
    const count = track(`${guild.id}:massjoin`, config.massjoin.seconds * 1000);
    if (count >= config.massjoin.max) {
      const last = lastMassJoinAlert.get(guild.id) ?? 0;
      if (Date.now() - last < 60_000) {
        // Alerte déjà envoyée : en mode kick on continue d'expulser les arrivants de la vague
        if (config.massjoin.mode === 'kick' && !isExempt(guild, member.id)) {
          await member.kick('Antiraid : vague d\'arrivées').catch(() => {});
        }
        return;
      }
      lastMassJoinAlert.set(guild.id, Date.now());

      if (config.massjoin.mode === 'kick' && !isExempt(guild, member.id)) {
        await member.kick('Antiraid : vague d\'arrivées').catch(() => {});
        await raidLog(guild, null, `Vague d'arrivées : ${count} membres en ${config.massjoin.seconds}s`, 'kick des nouveaux arrivants pendant 60s');
      } else {
        await raidLog(guild, null, `Vague d'arrivées : ${count} membres en ${config.massjoin.seconds}s`, '⚠️ alerte seulement — aucun membre touché (mode alerte)');
      }
    }
  }
}

module.exports = { onChannelCreate, onChannelDelete, onRoleCreate, onRoleDelete, onBanAdd, onWebhooksUpdate, onMemberAdd };
