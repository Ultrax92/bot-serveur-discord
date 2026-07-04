const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');
const { closeTicketsForMember } = require('../core/tickets');
const { recordLeave } = require('../core/invites');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    await closeTicketsForMember(member).catch((error) => console.error('Erreur fermeture tickets au départ :', error));

    const lines = [`📤 **A quitté le serveur** — reste ${member.guild.memberCount} membres`, idLine(member)];

    // Met à jour le compteur de l'inviteur et l'affiche dans le log de départ
    const inviteInfo = recordLeave(member);
    if (inviteInfo) {
      lines.push(`📨 **Avait été invité par** <@${inviteInfo.inviterId}> — il lui reste **${inviteInfo.stats.active}** invitation(s)`);
    }
    if (!member.partial) {
      if (member.joinedTimestamp) {
        lines.push(`**Avait rejoint** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`);
      }
      const roles = member.roles.cache.filter((r) => r.id !== member.guild.roles.everyone.id);
      if (roles.size) {
        lines.push(`**Rôles :** ${roles.map((r) => `${r}`).join(' ').slice(0, 900)}`);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor(member.user ? userAuthor(member.user) : { name: `Inconnu (${member.id})` })
      .setDescription(lines.join('\n'))
      .setTimestamp();

    await sendLog(member.guild, 'leave', embed);
  },
};
