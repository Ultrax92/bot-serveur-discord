const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;
    // Ignore les "updates" sans changement de texte (embeds qui se chargent, épinglage…)
    if (oldMessage.partial || oldMessage.content === newMessage.content) return;

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setAuthor({ name: '✏️ Message modifié' })
      .addFields(
        { name: 'Auteur', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
        { name: 'Salon', value: `${newMessage.channel} — [aller au message](${newMessage.url})`, inline: true },
        { name: 'Avant', value: (oldMessage.content || '*vide*').slice(0, 1024) },
        { name: 'Après', value: (newMessage.content || '*vide*').slice(0, 1024) },
      )
      .setTimestamp();

    await sendLog(newMessage.guild, 'message', embed);
  },
};
