const { EmbedBuilder } = require('discord.js');
const { getSettings, isModuleEnabled } = require('./settings');
const { isBotAdminMember } = require('./permissions');
const { addSanction } = require('./sanctions');
const { sendLog, userAuthor, idLine } = require('./logs');
const { parseDuration, formatDuration } = require('./utils');

const INVITE_REGEX = /(discord\.(gg|io|me)|discord(app)?\.com\/invite)\/[\w-]+/i;
const URL_REGEX = /https?:\/\/\S+/i;

// Minuscules + suppression des accents, pour comparer "Enculé" à "encule"
function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Mot entier pour les mots simples ("con" ne bloque pas "conversation"),
// recherche brute pour les expressions avec espaces
function matchesWord(normalizedContent, word) {
  if (word.includes(' ')) return normalizedContent.includes(word);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalizedContent);
}

const NOTICES = {
  antispam: 'doucement sur le spam !',
  antilink: 'les liens ne sont pas autorisés ici.',
  antimention: 'trop de mentions dans un seul message.',
  badwords: "ce langage n'est pas autorisé ici.",
};

const spamTracker = new Map(); // "guildId:userId" → timestamps des derniers messages
const sanctionCooldown = new Map(); // "guildId:userId" → date de la dernière sanction automod

// Détecte quelle protection le message déclenche (null si aucune)
function detectTrigger(message, config) {
  const content = message.content ?? '';

  if (config.antilink.enabled) {
    if (INVITE_REGEX.test(content)) return 'antilink';
    if (config.antilink.mode === 'all' && URL_REGEX.test(content)) return 'antilink';
  }

  if (config.badwords.enabled && config.badwords.words.length) {
    const normalized = normalize(content);
    if (config.badwords.words.some((word) => matchesWord(normalized, word))) return 'badwords';
  }

  if (config.antimention.enabled) {
    const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    if (mentions >= config.antimention.max) return 'antimention';
  }

  if (config.antispam.enabled) {
    const key = `${message.guildId}:${message.author.id}`;
    const windowMs = config.antispam.seconds * 1000;
    const now = Date.now();
    const timestamps = (spamTracker.get(key) ?? []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    spamTracker.set(key, timestamps);
    if (timestamps.length >= config.antispam.messages) {
      spamTracker.delete(key);
      return 'antispam';
    }
  }

  return null;
}

async function applySanction(message, trigger, config) {
  // Cooldown de 30s par membre pour ne pas empiler les sanctions
  const key = `${message.guildId}:${message.author.id}`;
  const last = sanctionCooldown.get(key) ?? 0;
  if (Date.now() - last < 30_000) return null;
  sanctionCooldown.set(key, Date.now());

  const reason = `Automod : ${trigger}`;
  if (config.sanction === 'warn') {
    addSanction({
      guildId: message.guildId,
      userId: message.author.id,
      moderatorId: message.client.user.id,
      type: 'warn',
      reason,
    });
    // Sanctions par paliers : ce warn automod compte comme les autres
    const { checkStrikes } = require('./strikes');
    const strike = await checkStrikes(message.guild, message.member).catch(() => null);
    return strike ? `warn → ${strike.includes('ban') ? 'ban' : 'mute'} (palier de warns atteint)` : 'warn';
  }
  if (config.sanction === 'mute' && message.member?.moderatable) {
    const duration = parseDuration(config.muteDuration) ?? 600_000;
    await message.member.timeout(duration, reason).catch(() => {});
    addSanction({
      guildId: message.guildId,
      userId: message.author.id,
      moderatorId: message.client.user.id,
      type: 'mute',
      reason,
      expiresAt: Date.now() + duration,
    });
    return `mute ${formatDuration(duration)}`;
  }
  return null;
}

// Retourne true si le message a été bloqué par une protection
async function handleMessage(message) {
  if (!message.inGuild() || message.author.bot || message.system) return false;
  if (!isModuleEnabled(message.guildId, 'automod')) return false;
  if (!message.member || isBotAdminMember(message.member)) return false;
  // Les tickets sont privés : liens, images et gifs y sont libres
  const { isOpenTicketChannel } = require('./tickets');
  if (isOpenTicketChannel(message.channelId)) return false;

  const config = getSettings(message.guildId).automodConfig;
  const trigger = detectTrigger(message, config);
  if (!trigger) return false;

  await message.delete().catch(() => {});

  // En cas de spam, on nettoie aussi les derniers messages du membre dans le salon
  if (trigger === 'antispam') {
    const recent = await message.channel.messages.fetch({ limit: 30 }).catch(() => null);
    if (recent) {
      const windowMs = config.antispam.seconds * 2000;
      const toDelete = recent.filter(
        (m) => m.author.id === message.author.id && Date.now() - m.createdTimestamp < windowMs,
      );
      await message.channel.bulkDelete(toDelete, true).catch(() => {});
    }
  }

  // Avertissement visible quelques secondes dans le salon
  const notice = await message.channel.send(`⚠️ ${message.author}, ${NOTICES[trigger]}`).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);

  const sanction = await applySanction(message, trigger, config);

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor(userAuthor(message.author))
    .setDescription(
      [
        `🤖 **Automod — ${trigger}** dans ${message.channel}`,
        idLine(message.author),
        `**Sanction :** message supprimé${sanction ? ` + ${sanction}` : ''}`,
        message.content ? `**Message :** ${message.content.slice(0, 500)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setTimestamp();
  await sendLog(message.guild, 'mod', embed);
  return true;
}

module.exports = { handleMessage };
