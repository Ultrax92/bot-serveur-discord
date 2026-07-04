const db = require('./db');

// Modules activables par serveur. `core` est toujours actif (config, help).
const MODULES = {
  moderation: { label: 'Modération', emoji: '🔨', description: 'warn, mute, kick, ban, clear, sanctions…' },
  automod: { label: 'Auto-modération', emoji: '🤖', description: 'antispam, antilink, mots interdits, antimassmention' },
  logs: { label: 'Logs', emoji: '📜', description: 'logs de modération, messages, vocal, rôles, boosts' },
  antiraid: { label: 'Antiraid', emoji: '🛡️', description: 'antibot, antitoken, antichannel, antiwebhook, whitelist' },
  tickets: { label: 'Tickets', emoji: '🎫', description: 'système de tickets avec panneau, claim et transcript' },
  giveaways: { label: 'Giveaways', emoji: '🎉', description: 'giveaways avec bouton, reroll, tirage au sort' },
  tempvoc: { label: 'Vocaux temporaires', emoji: '🔊', description: 'salons vocaux créés à la demande' },
  rolemenu: { label: 'Rolemenu / Embeds', emoji: '🎭', description: 'menus de rôles interactifs et générateur d\'embeds' },
  verification: { label: 'Vérification', emoji: '✅', description: 'bouton de vérification à l\'arrivée qui donne un rôle' },
  custom: { label: 'Commandes custom', emoji: '🧩', description: 'commandes à préfixe (+regles, !boutique…) créées via /custom' },
  utility: { label: 'Utilitaire', emoji: '🧰', description: 'serverinfo, userinfo, avatars…' },
  backups: { label: 'Backups', emoji: '💾', description: 'sauvegarde et restauration du serveur' },
};

const DEFAULT_SETTINGS = {
  // IDs des utilisateurs ayant accès à toutes les commandes du bot (gérés via /get-admin et /del-admin)
  admins: [],
  modules: {
    moderation: true,
    automod: false,
    logs: false,
    antiraid: false,
    tickets: false,
    giveaways: false,
    tempvoc: false,
    rolemenu: false,
    verification: false,
    custom: false,
    utility: true,
    backups: false,
  },
  // Chaque module range ses options sous sa propre clé (remplies au fur et à mesure).
  moderationConfig: {
    dmOnSanction: true,          // envoyer un MP au membre sanctionné
    defaultMuteDuration: '1h',   // durée du mute quand aucune durée n'est précisée
  },
  logsChannels: {},   // un salon par type de log (voir LOG_TYPES dans core/logs.js)
  verifConfig: {
    channel: null,   // salon où le panneau de vérification est publié
    role: null,      // rôle attribué au clic
    message: 'Bienvenue sur **{serveur}** ! Clique sur le bouton ci-dessous pour te vérifier et accéder au serveur.',
  },
  // Commandes custom : { id, prefix, name, allowedRoles: [], deleteTrigger, response: { embed, title, content, image } }
  customCommands: [],
  ticketsConfig: {
    panelChannel: null,      // salon où le panneau (embed + sélecteur) est publié
    panelMessage: 'Utilise le menu ci-dessous pour ouvrir un ticket dans la catégorie que tu souhaites.',
    panelImage: null,        // URL d'image affichée dans l'embed du panneau
    requiredRole: null,      // rôle requis pour ouvrir un ticket (ex: rôle vérifié)
    maxPerUser: 1,
    closeOnLeave: true,      // ferme les tickets d'un membre qui quitte le serveur
    transcriptDM: true,      // envoie le transcript en MP à l'ouvreur à la fermeture
    types: [],               // { id, emoji, label, description, categoryId, mentionRoles, accessRoles, openMessage }
  },
  automodConfig: {
    antispam: { enabled: false, messages: 5, seconds: 5 },   // X messages en Y secondes
    antilink: { enabled: false, mode: 'invites' },           // invites = invitations Discord, all = tous les liens
    antimention: { enabled: false, max: 5 },                 // mentions max dans un message
    badwords: { enabled: false, words: [] },
    sanction: 'mute',                                        // none | warn | mute (le message est toujours supprimé)
    muteDuration: '10m',
  },
  antiraidConfig: {},
  tempvocConfig: {},
  color: 0x5865f2,    // couleur des embeds (modifiable via /config)
};

const getStmt = db.prepare('SELECT settings FROM guilds WHERE guild_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO guilds (guild_id, settings) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET settings = excluded.settings
`);

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function getSettings(guildId) {
  const row = getStmt.get(guildId);
  const stored = row ? JSON.parse(row.settings) : {};
  return deepMerge(DEFAULT_SETTINGS, stored);
}

function saveSettings(guildId, settings) {
  upsertStmt.run(guildId, JSON.stringify(settings));
}

function updateSettings(guildId, updater) {
  const settings = getSettings(guildId);
  updater(settings);
  saveSettings(guildId, settings);
  return settings;
}

function isModuleEnabled(guildId, moduleName) {
  if (!moduleName || moduleName === 'core') return true;
  return getSettings(guildId).modules[moduleName] === true;
}

module.exports = { MODULES, DEFAULT_SETTINGS, getSettings, saveSettings, updateSettings, isModuleEnabled };
