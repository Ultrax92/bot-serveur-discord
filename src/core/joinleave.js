const { isModuleEnabled, getSettings } = require('./settings');

const TEMPLATE_VARS = '`{membre}` mention · `{pseudo}` nom · `{serveur}` nom du serveur · `{membres}` nombre de membres';

function formatTemplate(template, member) {
  return template
    .replaceAll('{membre}', `${member}`)
    .replaceAll('{pseudo}', member.user?.username ?? 'inconnu')
    .replaceAll('{serveur}', member.guild.name)
    .replaceAll('{membres}', `${member.guild.memberCount}`);
}

async function sendMessage(member, kind, { test = false } = {}) {
  if (!test && !isModuleEnabled(member.guild.id, 'joinleave')) return null;
  const jl = getSettings(member.guild.id).joinleave;
  const channelId = kind === 'join' ? jl.joinChannel : jl.leaveChannel;
  if (!channelId) return null;
  const channel = member.guild.channels.cache.get(channelId);
  if (!channel) return null;
  const template = kind === 'join' ? jl.joinMessage : jl.leaveMessage;
  const sent = await channel.send({ content: formatTemplate(template, member) }).catch(() => null);
  return sent ? channel : null;
}

const sendJoinMessage = (member, options) => sendMessage(member, 'join', options);
const sendLeaveMessage = (member, options) => sendMessage(member, 'leave', options);

// Donne les autoroles configurés à un nouveau membre
async function applyAutoroles(member) {
  if (!isModuleEnabled(member.guild.id, 'joinleave')) return;
  const { autoroles } = getSettings(member.guild.id).joinleave;
  if (!autoroles.length) return;
  const roles = autoroles
    .map((id) => member.guild.roles.cache.get(id))
    .filter((r) => r && !r.managed && r.position < member.guild.members.me.roles.highest.position);
  if (roles.length) await member.roles.add(roles, 'Autorole à l\'arrivée').catch(() => {});
}

module.exports = { TEMPLATE_VARS, formatTemplate, sendJoinMessage, sendLeaveMessage, applyAutoroles };
