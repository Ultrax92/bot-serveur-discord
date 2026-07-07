const { EmbedBuilder } = require('discord.js');
const { sendLog, userAuthor, idLine } = require('../core/logs');
const { recordJoin } = require('../core/invites');
const { onMemberAdd } = require('../core/antiraid');
const { reassignRolesOnJoin } = require('../core/serverBackup');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    await onMemberAdd(member).catch((error) => console.error('Erreur antiraid (memberAdd) :', error));

    // Ancien membre qui revient : ses rôles mémorisés au dernier backup lui sont remis
    const restoredRoles = await reassignRolesOnJoin(member).catch((error) => {
      console.error('Erreur restauration des rôles (memberAdd) :', error);
      return 0;
    });
    // Nouveau membre : entre immédiatement dans la photo (les changements de
    // rôles la tiendront à jour ensuite)
    try {
      require('../core/serverBackup').trackMemberRoles(member);
    } catch (error) {
      console.error('Erreur photo des rôles (memberAdd) :', error);
    }

    const inviteInfo = await recordJoin(member).catch((error) => {
      console.error('Erreur invite tracker :', error);
      return null;
    });

    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
    const lines = [
      `📥 **A rejoint le serveur** — ${member.guild.memberCount}ᵉ membre`,
      idLine(member),
      `**Compte créé** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>${accountAgeDays < 7 ? ' ⚠️ **compte récent**' : ''}`,
    ];
    if (restoredRoles) lines.push(`♻️ **${restoredRoles} rôle(s) restauré(s)** (membre de retour)`);
    if (inviteInfo) {
      lines.push(
        `📨 **Invité par** <@${inviteInfo.inviterId}> (${inviteInfo.stats.active} invitation(s))${inviteInfo.fake ? ' ⚠️ *compte récent, comptée comme suspecte*' : ''}`,
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor(userAuthor(member.user))
      .setDescription(lines.join('\n'))
      .setTimestamp();
    await sendLog(member.guild, 'join', embed);
  },
};
