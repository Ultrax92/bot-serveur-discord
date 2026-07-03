const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: '🎭 Rôle supprimé' })
      .setDescription(`**${role.name}** (\`${role.id}\`)`)
      .setTimestamp();
    await sendLog(role.guild, 'role', embed);
  },
};
