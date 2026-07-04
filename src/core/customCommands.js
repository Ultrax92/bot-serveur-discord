const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');
const { isBotAdminMember } = require('./permissions');
const { sendLog, userAuthor, idLine } = require('./logs');

// Images uploadées pour les commandes custom : stockées sur le disque car les
// liens de pièces jointes Discord expirent au bout de quelques jours
const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');

const pendingImages = new Map(); // "guildId:userId" → { commandId, channelId, expires, panelMessage }

function requestImageUpload(interaction, commandId) {
  pendingImages.set(`${interaction.guildId}:${interaction.user.id}`, {
    commandId,
    channelId: interaction.channelId,
    expires: Date.now() + 120_000,
    panelMessage: interaction.message,
  });
}

function deleteStoredImage(imageRef) {
  if (!imageRef?.startsWith('file:')) return;
  const filePath = path.join(imagesDir, imageRef.slice(5));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function tempReply(channel, content) {
  const notice = await channel.send(content).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
}

// Attend l'image envoyée après un clic sur 🖼️ dans le panneau. Retourne true
// si le message faisait partie de ce flux.
async function handlePendingImage(message) {
  if (!message.inGuild() || message.author.bot) return false;
  const key = `${message.guildId}:${message.author.id}`;
  const pending = pendingImages.get(key);
  if (!pending) return false;
  if (Date.now() > pending.expires) {
    pendingImages.delete(key);
    return false;
  }
  if (message.channelId !== pending.channelId) return false;

  // Republie le panneau tout en bas du salon (et supprime l'ancien) pour ne pas
  // avoir à remonter la conversation pour continuer la configuration
  const refreshPanel = async () => {
    const { customEditView, watchPanel } = require('./setupPanel');
    const view = customEditView(message.guild, pending.commandId);
    const newPanel = await message.channel.send(view).catch(() => null);
    if (newPanel) {
      watchPanel(newPanel);
      await pending.panelMessage?.delete().catch(() => {});
    } else {
      await pending.panelMessage?.edit(view).catch(() => {});
    }
  };

  if (message.content.trim().toLowerCase() === 'supprimer') {
    pendingImages.delete(key);
    updateSettings(message.guildId, (s) => {
      const c = s.customCommands.find((cc) => cc.id === pending.commandId);
      if (c) {
        deleteStoredImage(c.response.image);
        c.response.image = null;
      }
    });
    await message.delete().catch(() => {});
    await tempReply(message.channel, '✅ Image retirée de la commande.');
    await refreshPanel();
    return true;
  }

  // URL externe collée (imgur…) : acceptée telle quelle, sauf les liens Discord qui expirent
  const trimmed = message.content.trim();
  if (/^https?:\/\/\S+$/.test(trimmed) && !message.attachments.size) {
    if (/(cdn|media)\.discordapp\.(com|net)/.test(trimmed)) {
      await message.delete().catch(() => {});
      await tempReply(message.channel, '❌ Les liens d\'images Discord expirent au bout de quelques jours — envoie plutôt l\'image en pièce jointe, je la stockerai durablement.');
      return true;
    }
    pendingImages.delete(key);
    updateSettings(message.guildId, (s) => {
      const c = s.customCommands.find((cc) => cc.id === pending.commandId);
      if (c) {
        deleteStoredImage(c.response.image);
        c.response.image = trimmed;
      }
    });
    await message.delete().catch(() => {});
    await tempReply(message.channel, '✅ URL d\'image enregistrée pour la commande.');
    await refreshPanel();
    return true;
  }

  const attachment = message.attachments.first();
  if (!attachment) return false; // pas une pièce jointe : message normal, on n'y touche pas

  if (!attachment.contentType?.startsWith('image/')) {
    await message.delete().catch(() => {});
    await tempReply(message.channel, '❌ Ce fichier n\'est pas une image, réessaie.');
    return true;
  }
  if (attachment.size > 8 * 1024 * 1024) {
    await message.delete().catch(() => {});
    await tempReply(message.channel, '❌ Image trop lourde (8 Mo max), réessaie.');
    return true;
  }

  const response = await fetch(attachment.url).catch(() => null);
  if (!response?.ok) {
    await message.delete().catch(() => {});
    await tempReply(message.channel, '❌ Impossible de télécharger l\'image, réessaie.');
    return true;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = (attachment.name?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const filename = `cc-${pending.commandId}-${Date.now()}.${ext}`;
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, filename), buffer);

  pendingImages.delete(key);
  updateSettings(message.guildId, (s) => {
    const c = s.customCommands.find((cc) => cc.id === pending.commandId);
    if (c) {
      deleteStoredImage(c.response.image);
      c.response.image = `file:${filename}`;
    }
  });
  await message.delete().catch(() => {});
  await tempReply(message.channel, '✅ Image enregistrée pour la commande (stockée sur le serveur, elle n\'expirera pas).');
  await refreshPanel();
  return true;
}

function formatResponse(text, message) {
  return text
    .replaceAll('{membre}', `${message.author}`)
    .replaceAll('{pseudo}', message.author.username)
    .replaceAll('{salon}', `${message.channel}`)
    .replaceAll('{serveur}', message.guild.name);
}

// Réagit aux messages du type "+regles", "!boutique"… Retourne true si une
// commande custom a été déclenchée.
async function handleCustomCommand(message) {
  if (!message.inGuild() || message.author.bot || message.system || !message.member) return false;
  if (!isModuleEnabled(message.guildId, 'custom')) return false;

  const settings = getSettings(message.guildId);
  const commands = settings.customCommands;
  if (!commands.length) return false;

  const content = message.content.trim().toLowerCase();
  const command = commands.find((c) => content === `${c.prefix}${c.name}`);
  if (!command) return false;

  // Rôles autorisés (vide = tout le monde) ; les admins du bot passent toujours
  if (command.allowedRoles.length
    && !isBotAdminMember(message.member)
    && !command.allowedRoles.some((id) => message.member.roles.cache.has(id))) {
    return false;
  }

  if (command.deleteTrigger) await message.delete().catch(() => {});

  const responseText = formatResponse(command.response.content || '…', message);
  // Discord n'envoie jamais de notification pour une mention DANS un embed :
  // la mention configurée est donc envoyée au-dessus, dans le contenu du message
  const mention = command.response.mention ? formatResponse(command.response.mention, message).slice(0, 300) : undefined;
  const allowedMentions = { parse: ['everyone', 'roles', 'users'] };

  if (command.response.embed) {
    const embed = new EmbedBuilder().setColor(settings.color).setDescription(responseText.slice(0, 4096));
    if (command.response.title) embed.setTitle(formatResponse(command.response.title, message).slice(0, 256));
    const files = [];
    if (command.response.image?.startsWith('file:')) {
      const filePath = path.join(imagesDir, command.response.image.slice(5));
      if (fs.existsSync(filePath)) {
        files.push(new AttachmentBuilder(filePath));
        embed.setImage(`attachment://${path.basename(filePath)}`);
      }
    } else if (command.response.image) {
      embed.setImage(command.response.image);
    }
    await message.channel.send({ content: mention, embeds: [embed], files, allowedMentions }).catch(() => {});
  } else {
    await message.channel.send({ content: responseText.slice(0, 2000), allowedMentions }).catch(() => {});
  }

  const logEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor(userAuthor(message.author))
    .setDescription([
      `🧩 **Commande custom utilisée** dans ${message.channel}`,
      idLine(message.author),
      `\`${command.prefix}${command.name}\``,
    ].join('\n'))
    .setTimestamp();
  sendLog(message.guild, 'command', logEmbed).catch(() => {});

  return true;
}

module.exports = { handleCustomCommand, handlePendingImage, requestImageUpload, deleteStoredImage };
