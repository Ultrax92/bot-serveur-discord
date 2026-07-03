const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');

module.exports = {
  name: 'messageDelete',
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const embed = new EmbedBuilder().setColor(0xed4245).setTimestamp();
    const lines = [`**Message supprimé dans** ${message.channel}`];

    if (message.partial || message.author == null) {
      // Message envoyé avant le démarrage du bot : contenu inconnu
      lines.push('*Message non mis en cache : contenu et auteur inconnus.*');
    } else {
      embed.setAuthor(userAuthor(message.author));
      lines.splice(1, 0, idLine(message.author));
      if (message.content) lines.push(message.content.slice(0, 3800));
      if (message.attachments.size > 0) {
        lines.push(`📎 ${message.attachments.map((a) => a.name).join(', ').slice(0, 500)}`);
      }
    }

    embed.setDescription(lines.join('\n'));
    await sendLog(message.guild, 'message', embed);
  },
};
