const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { sendLog } = require('../core/logs');

module.exports = {
  name: 'roleUpdate',
  async execute(oldRole, newRole) {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`**Nom :** ${oldRole.name} → ${newRole.name}`);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`**Couleur :** ${oldRole.hexColor} → ${newRole.hexColor}`);
    const hadAdmin = oldRole.permissions.has(PermissionFlagsBits.Administrator);
    const hasAdmin = newRole.permissions.has(PermissionFlagsBits.Administrator);
    if (hadAdmin !== hasAdmin) changes.push(`**Permission Administrateur :** ${hasAdmin ? '⚠️ AJOUTÉE' : 'retirée'}`);
    if (!changes.length) return;

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setAuthor({ name: '🎭 Rôle modifié' })
      .setDescription(`${newRole} (\`${newRole.id}\`)\n${changes.join('\n')}`)
      .setTimestamp();
    await sendLog(newRole.guild, 'role', embed);
  },
};
