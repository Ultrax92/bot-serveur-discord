const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'messageDelete',
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: '💬 Message supprimé' })
      .addFields({ name: 'Salon', value: `${message.channel}`, inline: true })
      .setTimestamp();

    if (message.partial || message.author == null) {
      // Message envoyé avant le démarrage du bot : contenu inconnu
      embed.setDescription('*Message non mis en cache : contenu et auteur inconnus.*');
    } else {
      embed.addFields({ name: 'Auteur', value: `${message.author} (\`${message.author.id}\`)`, inline: true });
      if (message.content) {
        embed.setDescription(message.content.slice(0, 4000));
      }
      if (message.attachments.size > 0) {
        embed.addFields({
          name: 'Pièces jointes',
          value: message.attachments.map((a) => a.name).join(', ').slice(0, 1024),
        });
      }
    }

    await sendLog(message.guild, 'message', embed);
  },
};
