const db = require('./db');

// Modules activables par serveur. `core` est toujours actif (config, help).
// Ordre logique de mise en place : logs → accueil/sécurité → systèmes → outils
const MODULES = {
  logs: { label: 'Logs', emoji: '📜', description: 'logs de modération, messages, vocal, rôles, boosts' },
  verification: {
    label: 'Vérification',
    emoji: '✅',
    description: "bouton de vérification à l'arrivée qui donne un rôle",
  },
  moderation: { label: 'Modération', emoji: '🔨', description: 'warn, mute, kick, ban, clear, sanctions…' },
  automod: {
    label: 'Auto-modération',
    emoji: '🤖',
    description: 'antispam, antilink, mots interdits, antimassmention',
  },
  antiraid: { label: 'Antiraid', emoji: '🛡️', description: 'antibot, rafales de salons/rôles/bans, whitelist' },
  tickets: { label: 'Tickets', emoji: '🎫', description: 'système de tickets avec panneau, claim et transcript' },
  tempvoc: { label: 'Vocaux temporaires', emoji: '🔊', description: 'salons vocaux créés à la demande' },
  stats: {
    label: 'Stats du serveur',
    emoji: '📊',
    description: 'compteurs membres/rôles en salons vocaux verrouillés',
  },
  invites: {
    label: 'Invite tracker',
    emoji: '📨',
    description: "qui a invité qui, compteurs d'invitations, /invites et /leaderboard",
  },
  giveaways: { label: 'Giveaways', emoji: '🎉', description: 'giveaways avec bouton, reroll, tirage au sort' },
  custom: {
    label: 'Commandes custom',
    emoji: '🧩',
    description: 'commandes à préfixe (+regles, !boutique…) créées via /custom',
  },
  utility: { label: 'Utilitaire', emoji: '🧰', description: 'serverinfo, userinfo, /embed…' },
  scheduler: {
    label: 'Messages programmés',
    emoji: '⏰',
    description: 'annonces récurrentes automatiques (/schedule)',
  },
  backups: { label: 'Backups', emoji: '💾', description: 'sauvegarde auto des settings + export/import via /backup' },
};

const DEFAULT_SETTINGS = {
  // IDs des utilisateurs ayant accès à toutes les commandes du bot (gérés via /get-admin et /del-admin)
  admins: [],
  modules: {
    logs: false,
    verification: false,
    moderation: true,
    automod: false,
    antiraid: false,
    tickets: false,
    tempvoc: false,
    stats: false,
    invites: false,
    giveaways: false,
    custom: false,
    utility: true,
    scheduler: false,
    backups: false,
  },
  // Chaque module range ses options sous sa propre clé (remplies au fur et à mesure).
  moderationConfig: {
    dmOnSanction: true, // envoyer un MP au membre sanctionné
    defaultMuteDuration: '1h', // durée du mute quand aucune durée n'est précisée
    strikes: {
      enabled: false, // sanctions par paliers selon les warns accumulés
      windowDays: 7, // fenêtre glissante : seuls les warns des X derniers jours comptent
      muteThreshold: 3, // X warns dans la fenêtre → mute automatique
      muteDuration: '24h',
      banThreshold: 5, // Y warns dans la fenêtre → ban définitif
    },
  },
  logsChannels: {}, // un salon par type de log (voir LOG_TYPES dans core/logs.js)
  verifConfig: {
    channel: null, // salon où le panneau de vérification est publié
    role: null, // rôle attribué au clic
    message: 'Bienvenue sur **{serveur}** ! Clique sur le bouton ci-dessous pour te vérifier et accéder au serveur.',
    lastPanelChannel: null, // dernier panneau publié, supprimé à la republication
    lastPanelMessage: null,
  },
  // Commandes custom : { id, prefix, name, allowedRoles: [], deleteTrigger, response: { embed, title, content, image } }
  customCommands: [],
  giveawaysConfig: {
    requiredRole: null, // rôle requis pour participer (null = tout le monde)
  },
  ticketsConfig: {
    panelChannel: null, // salon où le panneau (embed + sélecteur) est publié
    panelTitle: '', // titre de l'embed du panneau (optionnel)
    panelMessage: 'Utilise le menu ci-dessous pour ouvrir un ticket dans la catégorie que tu souhaites.',
    panelImage: null, // image du panneau : 'file:...' (uploadée) ou URL externe
    requiredRole: null, // rôle requis pour ouvrir un ticket (ex: rôle vérifié)
    maxPerUser: 1,
    closeOnLeave: true, // ferme les tickets d'un membre qui quitte le serveur
    autoCloseDays: 0, // ferme les tickets sans message de l'ouvreur depuis X jours (0 = off, avertissement à X-1)
    transcriptDM: true, // envoie le transcript en MP à l'ouvreur à la fermeture
    lastPanelChannel: null, // dernier panneau publié, supprimé à la republication
    lastPanelMessage: null,
    types: [], // { id, emoji, label, description, categoryId, mentionRoles, accessRoles, openMessage }
    feedbackChannel: null, // salon où les avis clients sont publiés — le configurer active la notation
    reviewChannel: null, // salon staff où les avis attendent validation (vide = publication directe)
    reviewRole: null, // rôle donné au client à la publication de son avis
  },
  automodConfig: {
    antispam: { enabled: false, messages: 5, seconds: 5 }, // X messages en Y secondes
    antilink: { enabled: false, mode: 'invites' }, // invites = invitations Discord, all = tous les liens
    antimention: { enabled: false, max: 5 }, // mentions max dans un message
    badwords: { enabled: false, words: [] },
    sanction: 'mute', // none | warn | mute (le message est toujours supprimé)
    muteDuration: '10m',
  },
  antiraidConfig: {
    // mute = derank complet + mute 24h | ban24 = ban 24h (levé auto) | ban = définitif
    // (un simple derank ne suffit pas : l'auteur pourrait repasser la vérification)
    sanction: 'mute',
    whitelist: [], // IDs jamais touchés par l'antiraid (owner toujours exempté)
    antibot: { enabled: false }, // seul le OWNER peut ajouter des bots
    antichannel: { enabled: false, max: 3, seconds: 30 }, // créations/suppressions de salons en rafale
    antirole: { enabled: false, max: 3, seconds: 30 }, // créations/suppressions de rôles en rafale
    antiwebhook: { enabled: false }, // webhooks créés par un non-whitelisté
    antiban: { enabled: false, max: 3, seconds: 60 }, // bans en rafale
    massjoin: { enabled: false, mode: 'alert', max: 50, seconds: 100 }, // vague d'arrivées : alert | kick
  },
  tempvocConfig: {
    generatorChannel: null, // salon vocal "➕ Crée ton salon"
    nameTemplate: '🔊 Salon de {pseudo}', // nom des salons créés
    accessRoles: [], // rôles voyant/rejoignant le générateur et les salons créés (vide = tous)
    adminRole: null, // rôle "admin" des salons créés (ex: modérateurs), droits étendus
  },
  statsConfig: {
    categoryName: '「 📊 𝐒𝐄𝐑𝐕𝐄𝐑 𝐒𝐓𝐀𝐓𝐒 📊 」',
    categoryId: null,
    accessRoles: [], // rôles voyant les compteurs (vide = visibles par tous) ; everyone est sinon totalement refusé
    counters: [], // { id, type: 'members'|'role', roleId, channelId, label }
  },
  backupsConfig: {
    dmExport: 'off', // envoi du backup auto en MP au owner : off | weekly (lundi) | daily
  },
  color: 0x5865f2, // couleur des embeds (modifiable via /config)
};

const getStmt = db.prepare('SELECT settings FROM guilds WHERE guild_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO guilds (guild_id, settings) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET settings = excluded.settings
`);

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
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
