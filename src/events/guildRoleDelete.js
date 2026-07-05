const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');
const { onRoleDelete } = require('../core/antiraid');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    await Promise.resolve(onRoleDelete(role)).catch((error) => console.error('Erreur antiraid (roleDelete) :', error));
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: '🎭 Rôle supprimé' })
      .setDescription(`**${role.name}** (\`${role.id}\`)`)
      .setTimestamp();
    await sendLog(role.guild, 'role', embed);
  },
};
