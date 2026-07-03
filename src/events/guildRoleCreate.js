const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'roleCreate',
  async execute(role) {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: '🎭 Rôle créé' })
      .setDescription(`${role} (\`${role.id}\`)`)
      .setTimestamp();
    await sendLog(role.guild, 'role', embed);
  },
};
