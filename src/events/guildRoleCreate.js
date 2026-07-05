const { EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/logs');
const { onRoleCreate } = require('../core/antiraid');

module.exports = {
  name: 'roleCreate',
  async execute(role) {
    await Promise.resolve(onRoleCreate(role)).catch((error) => console.error('Erreur antiraid (roleCreate) :', error));
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: '🎭 Rôle créé' })
      .setDescription(`${role} (\`${role.id}\`)`)
      .setTimestamp();
    await sendLog(role.guild, 'role', embed);
  },
};
