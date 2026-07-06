const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');
const { getCachedImages } = require('../core/imageCache');
const { purging } = require('../commands/moderation/clean-channel');

module.exports = {
  name: 'messageDelete',
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;
    if (purging.has(message.channelId)) return; // purge en cours : pas de spam de logs

    const embed = new EmbedBuilder().setColor(0xed4245).setTimestamp();
    const lines = [`**Message supprimé dans** ${message.channel}`];
    const files = [];

    if (message.partial || message.author == null) {
      // Message envoyé avant le démarrage du bot : contenu inconnu
      lines.push('*Message non mis en cache : contenu et auteur inconnus.*');
    } else {
      embed.setAuthor(userAuthor(message.author));
      lines.splice(1, 0, idLine(message.author));
      if (message.content) lines.push(message.content.slice(0, 3800));

      if (message.attachments.size > 0) {
        // Images sauvegardées avant la suppression : réaffichées dans le log
        const images = getCachedImages(message);
        for (const image of images) files.push(new AttachmentBuilder(image.buffer, { name: image.name }));
        if (images.length) embed.setImage(`attachment://${images[0].name}`);

        const uncached = message.attachments.size - images.length;
        if (uncached > 0) {
          lines.push(
            `📎 ${message.attachments
              .map((a) => a.name)
              .join(', ')
              .slice(
                0,
                500,
              )}${images.length ? '' : " *(visuel indisponible : envoyé avant le démarrage du bot ou il y a plus d'une heure)*"}`,
          );
        }
      }
    }

    embed.setDescription(lines.join('\n'));
    await sendLog(message.guild, 'message', embed, files);
  },
};
