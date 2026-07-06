const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');

module.exports = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;
    // Ignore les "updates" sans changement de texte (embeds qui se chargent, épinglage…)
    if (oldMessage.partial || oldMessage.content === newMessage.content) return;

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setAuthor(userAuthor(newMessage.author))
      .setDescription(
        [
          `**Message modifié dans** ${newMessage.channel} — [voir le message](${newMessage.url})`,
          idLine(newMessage.author),
          `**Avant :** ${(oldMessage.content || '*vide*').slice(0, 900)}`,
          `**Après :** ${(newMessage.content || '*vide*').slice(0, 900)}`,
        ].join('\n'),
      )
      .setTimestamp();

    await sendLog(newMessage.guild, 'message', embed);
  },
};
