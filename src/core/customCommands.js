const { EmbedBuilder } = require('discord.js');
const { getSettings, isModuleEnabled } = require('./settings');
const { isBotAdminMember } = require('./permissions');
const { sendLog, userAuthor, idLine } = require('./logs');

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
  if (command.response.embed) {
    const embed = new EmbedBuilder().setColor(settings.color).setDescription(responseText.slice(0, 4096));
    if (command.response.title) embed.setTitle(formatResponse(command.response.title, message).slice(0, 256));
    if (command.response.image) embed.setImage(command.response.image);
    await message.channel.send({ embeds: [embed] }).catch(() => {});
  } else {
    await message.channel.send({ content: responseText.slice(0, 2000) }).catch(() => {});
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

module.exports = { handleCustomCommand };
