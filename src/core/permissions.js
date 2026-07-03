const { getSettings, updateSettings } = require('./settings');

// Owner du bot : défini par OWNER_ID dans le .env, accès total partout
function isOwner(userId) {
  return Boolean(process.env.OWNER_ID) && userId === process.env.OWNER_ID.trim();
}

// Admin du bot : owner (.env), propriétaire du serveur, ou ajouté via /get-admin
function isBotAdmin(interaction) {
  if (isOwner(interaction.user.id)) return true;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return getSettings(interaction.guildId).admins.includes(interaction.user.id);
}

// Seuls l'owner (.env) et le propriétaire du serveur peuvent gérer la liste des admins
function canManageAdmins(interaction) {
  return isOwner(interaction.user.id) || interaction.user.id === interaction.guild.ownerId;
}

function addAdmin(guildId, userId) {
  let added = false;
  updateSettings(guildId, (s) => {
    if (!s.admins.includes(userId)) {
      s.admins.push(userId);
      added = true;
    }
  });
  return added;
}

function removeAdmin(guildId, userId) {
  let removed = false;
  updateSettings(guildId, (s) => {
    const index = s.admins.indexOf(userId);
    if (index !== -1) {
      s.admins.splice(index, 1);
      removed = true;
    }
  });
  return removed;
}

module.exports = { isOwner, isBotAdmin, canManageAdmins, addAdmin, removeAdmin };
