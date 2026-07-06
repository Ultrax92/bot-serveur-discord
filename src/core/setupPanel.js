const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { MODULES, getSettings, updateSettings } = require('./settings');
const { LOG_TYPES, autoConfigureLogs, createLogChannel } = require('./logs');
const { buildVerifyPanel } = require('./verification');
const { buildTicketPanel } = require('./tickets');
const { parseDuration, formatDuration } = require('./utils');

function panelEmbed(guild, title, description) {
  return new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Panneau de configuration — tout se fait en cliquant, aucune commande à taper' });
}

function backButton(target, label = '◀️ Retour') {
  return new ButtonBuilder().setCustomId(`setup:goto:${target}`).setLabel(label).setStyle(ButtonStyle.Secondary);
}

function colorHex(settings) {
  return `#${settings.color.toString(16).padStart(6, '0').toUpperCase()}`;
}

// Extrait un ID Discord d'une saisie libre : ID brut, mention <#id>/<@id>, ou lien.
// Prend le DERNIER id : dans un lien discord.com/channels/serveur/salon, c'est
// le salon qui nous intéresse, pas le serveur.
function extractId(input) {
  const matches = String(input ?? '').match(/\d{15,20}/g);
  return matches ? matches[matches.length - 1] : null;
}

// Extrait TOUS les IDs de rôles valides d'une saisie libre (IDs, mentions <@&…>,
// séparés par espaces/virgules) — pour les champs multi-rôles par ID
function parseRoleIds(guild, input) {
  const ids = String(input ?? '').match(/\d{15,20}/g) ?? [];
  return [...new Set(ids)].filter((id) => guild.roles.cache.has(id));
}

// ── Fermeture automatique des panneaux inactifs ───────────────────────────────

const PANEL_TIMEOUT_MS = 120_000; // 2 minutes sans interaction → le panneau se ferme
const activePanels = new Map(); // messageId → timeout

function expiredView() {
  const embed = new EmbedBuilder()
    .setColor(0x99aab5)
    .setTitle('⏱️ Panneau fermé pour inactivité')
    .setDescription('Relance `/setup` pour continuer la configuration.');
  return { embeds: [embed], components: [] };
}

// (Re)lance le compte à rebours d'inactivité d'un panneau
function watchPanel(message) {
  if (!message) return;
  clearTimeout(activePanels.get(message.id));
  activePanels.set(
    message.id,
    setTimeout(() => {
      activePanels.delete(message.id);
      message.edit(expiredView()).catch(() => {});
    }, PANEL_TIMEOUT_MS),
  );
}

function releasePanel(messageId) {
  clearTimeout(activePanels.get(messageId));
  activePanels.delete(messageId);
}

// ── Page d'accueil ────────────────────────────────────────────────────────────

function hubView(guild) {
  const settings = getSettings(guild.id);
  const enabledCount = Object.keys(MODULES).filter((k) => settings.modules[k]).length;
  const logsCount = Object.keys(LOG_TYPES).filter(
    (t) => settings.logsChannels[t] && guild.channels.cache.get(settings.logsChannels[t]),
  ).length;

  const embed = panelEmbed(
    guild,
    `🛠️ Setup de ${guild.name}`,
    [
      "Bienvenue dans le panneau de configuration ! Les sections suivent l'ordre logique de mise en place du bot.",
      '',
      '__**1️⃣ La base**__',
      `⚙️ **Général** — couleur ${colorHex(settings)} | statut du bot`,
      `👑 **Admins du bot** — ${settings.admins.length} admin(s)`,
      `🧩 **Modules** — ${enabledCount}/${Object.keys(MODULES).length} activés`,
      `📜 **Salons de logs** — ${logsCount}/${Object.keys(LOG_TYPES).length} configurés`,
      '',
      '__**2️⃣ Accueil & sécurité**__',
      `✅ **Vérification** — salon ${settings.verifConfig.channel ? '🟢' : '🔴'} | rôle ${settings.verifConfig.role ? '🟢' : '🔴'}`,
      `🔨 **Modération** — MP sanction ${settings.moderationConfig.dmOnSanction ? '🟢' : '🔴'} | mute ${settings.moderationConfig.defaultMuteDuration}`,
      `🤖 **Auto-modération** — ${['antispam', 'antilink', 'antimention', 'badwords'].filter((k) => settings.automodConfig[k].enabled).length}/4 protections actives`,
      `🛡️ **Antiraid** — ${['antibot', 'antichannel', 'antirole', 'antiwebhook', 'antiban', 'massjoin'].filter((k) => settings.antiraidConfig[k].enabled).length}/6 protections actives`,
      '',
      '__**3️⃣ Les systèmes du serveur**__',
      `📊 **Stats** — ${settings.statsConfig.counters.length} compteur(s)`,
      `📨 **Invite tracker** — ${settings.modules.invites ? '🟢 actif' : '🔴 inactif (à activer dans 🧩 Modules)'}`,
      `🧩 **Commandes custom** — ${settings.customCommands.length} commande(s)`,
      `🎫 **Tickets** — salon ${settings.ticketsConfig.panelChannel ? '🟢' : '🔴'} | ${settings.ticketsConfig.types.length} type(s)`,
      `🔊 **Vocaux temporaires** — générateur ${settings.tempvocConfig.generatorChannel ? '🟢' : '🔴'}`,
      `🎉 **Giveaways** — ${require('./giveaways').activeGiveaways(guild.id).length} en cours | rôle requis ${settings.giveawaysConfig.requiredRole ? '🟢' : '🔴 aucun'}`,
      '',
      'Choisis une section dans le menu · outils : `/embed` `/backup` `/update`',
    ].join('\n'),
  );

  const nav = new StringSelectMenuBuilder()
    .setCustomId('setup:nav')
    .setPlaceholder('📂 Choisis une section à configurer…')
    .addOptions(
      // 1️⃣ La base
      new StringSelectMenuOptionBuilder()
        .setValue('general')
        .setLabel('1. Général')
        .setEmoji('⚙️')
        .setDescription('Couleur des embeds, statut du bot'),
      new StringSelectMenuOptionBuilder()
        .setValue('admins')
        .setLabel('2. Admins du bot')
        .setEmoji('👑')
        .setDescription('Qui a accès aux commandes du bot'),
      new StringSelectMenuOptionBuilder()
        .setValue('modules')
        .setLabel('3. Modules')
        .setEmoji('🧩')
        .setDescription('Activer ou désactiver les fonctionnalités'),
      new StringSelectMenuOptionBuilder()
        .setValue('logs')
        .setLabel('4. Salons de logs')
        .setEmoji('📜')
        .setDescription('Un salon existant ou créé pour chaque type de log'),
      // 2️⃣ Accueil & sécurité
      new StringSelectMenuOptionBuilder()
        .setValue('verification')
        .setLabel('5. Vérification')
        .setEmoji('✅')
        .setDescription('Bouton de vérification qui donne un rôle'),
      new StringSelectMenuOptionBuilder()
        .setValue('moderation')
        .setLabel('6. Modération')
        .setEmoji('🔨')
        .setDescription('MP aux sanctionnés, durée de mute par défaut'),
      new StringSelectMenuOptionBuilder()
        .setValue('automod')
        .setLabel('7. Auto-modération')
        .setEmoji('🤖')
        .setDescription('Antispam, antilink, antimention, mots interdits'),
      new StringSelectMenuOptionBuilder()
        .setValue('antiraid')
        .setLabel('8. Antiraid')
        .setEmoji('🛡️')
        .setDescription('Antibot, rafales de salons/rôles/bans, whitelist'),
      // 3️⃣ Les systèmes du serveur (même ordre que le résumé ci-dessus)
      new StringSelectMenuOptionBuilder()
        .setValue('stats')
        .setLabel('9. Stats du serveur')
        .setEmoji('📊')
        .setDescription('Compteurs membres et rôles en vocaux verrouillés'),
      new StringSelectMenuOptionBuilder()
        .setValue('custom')
        .setLabel('10. Commandes custom')
        .setEmoji('🧩')
        .setDescription('Commandes à préfixe avec réponse personnalisée'),
      new StringSelectMenuOptionBuilder()
        .setValue('tickets')
        .setLabel('11. Tickets')
        .setEmoji('🎫')
        .setDescription('Panneau à sélecteur, types de tickets, transcript'),
      new StringSelectMenuOptionBuilder()
        .setValue('tempvoc')
        .setLabel('12. Vocaux temporaires')
        .setEmoji('🔊')
        .setDescription("Salon générateur, rôles d'accès et admin"),
      new StringSelectMenuOptionBuilder()
        .setValue('giveaways')
        .setLabel('13. Giveaways')
        .setEmoji('🎉')
        .setDescription('Rôle requis pour participer, giveaways en cours'),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:done').setLabel('✅ Terminer').setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(nav), buttons] };
}

// ── Page générale ─────────────────────────────────────────────────────────────

function generalView(guild) {
  const settings = getSettings(guild.id);
  const { getActivityText } = require('./botStatus');
  const status = getActivityText();
  const embed = panelEmbed(
    guild,
    '⚙️ Général',
    [
      `🎨 **Couleur des embeds :** ${colorHex(settings)} (c'est la couleur de ce panneau)`,
      `🎮 **Statut du bot :** ${status ? `\`${status}\`` : '*aucun*'} (affiché sous son nom)`,
    ].join('\n'),
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:color').setLabel('🎨 Changer la couleur').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:status').setLabel('🎮 Statut du bot').setStyle(ButtonStyle.Primary),
    backButton('home'),
  );
  return { embeds: [embed], components: [buttons] };
}

// ── Page admins ───────────────────────────────────────────────────────────────

function adminsView(guild) {
  const settings = getSettings(guild.id);
  const list = settings.admins.length ? settings.admins.map((id) => `• <@${id}>`).join('\n') : '*Aucun admin ajouté.*';

  const embed = panelEmbed(
    guild,
    '👑 Admins du bot',
    [
      "Les admins ont accès à **toutes les commandes** du bot. Le owner (toi) l'est toujours, sans apparaître ici.",
      '',
      list,
      '',
      "👇 Sélectionne dans le menu **l'ensemble des admins** : ajoute ou retire des personnes, la sélection remplace la liste.",
      'Introuvable dans le menu ? Utilise **🆔 Ajouter/retirer par ID**.',
    ].join('\n'),
  );

  const select = new UserSelectMenuBuilder()
    .setCustomId('setup:admins')
    .setPlaceholder('👑 Sélectionne les admins du bot…')
    .setMinValues(0)
    .setMaxValues(25);
  if (settings.admins.length) select.setDefaultUsers(settings.admins.slice(0, 25));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:admins:byid')
      .setLabel('🆔 Ajouter/retirer par ID')
      .setStyle(ButtonStyle.Primary),
    backButton('home'),
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), buttons],
  };
}

// ── Page modules ──────────────────────────────────────────────────────────────

function modulesView(guild) {
  const settings = getSettings(guild.id);
  const lines = Object.entries(MODULES).map(
    ([key, m]) => `${settings.modules[key] ? '🟢' : '🔴'} ${m.emoji} **${m.label}** — ${m.description}`,
  );

  const embed = panelEmbed(
    guild,
    '🧩 Modules',
    [
      'Sélectionne dans le menu **tous les modules que tu veux activer** (les non-sélectionnés seront désactivés), puis valide.',
      '',
      lines.join('\n'),
    ].join('\n'),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('setup:modules')
    .setPlaceholder('🧩 Sélectionne les modules à activer…')
    .setMinValues(0)
    .setMaxValues(Object.keys(MODULES).length)
    .addOptions(
      Object.entries(MODULES).map(([key, m]) =>
        new StringSelectMenuOptionBuilder()
          .setValue(key)
          .setLabel(m.label)
          .setEmoji(m.emoji)
          .setDescription(m.description.slice(0, 100))
          .setDefault(settings.modules[key] === true),
      ),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(backButton('home')),
    ],
  };
}

// ── Page modération ───────────────────────────────────────────────────────────

function moderationView(guild) {
  const settings = getSettings(guild.id);
  const { dmOnSanction, defaultMuteDuration, strikes } = settings.moderationConfig;

  const embed = panelEmbed(
    guild,
    '🔨 Réglages de modération',
    [
      `${dmOnSanction ? '🟢' : '🔴'} **MP au membre sanctionné** — le bot prévient en privé lors d'un warn/mute/kick/ban`,
      `⏱️ **Durée de mute par défaut** — \`${defaultMuteDuration}\` quand /mute est utilisé sans durée`,
      '',
      `${strikes.enabled ? '🟢' : '🔴'} **Sanctions par paliers** — ${strikes.enabled ? 'les warns accumulés déclenchent des sanctions automatiques' : 'désactivées'}`,
      `> 📈 ${strikes.muteThreshold} warns en ${strikes.windowDays} jours → mute \`${strikes.muteDuration}\` · ${strikes.banThreshold} warns → **ban définitif**`,
      '*Les warns manuels et automod comptent · owner et admins du bot exemptés · chaque sanction est inscrite au casier.*',
    ].join('\n'),
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:mod:dm')
      .setLabel(dmOnSanction ? '🔴 Désactiver le MP sanction' : '🟢 Activer le MP sanction')
      .setStyle(dmOnSanction ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('setup:mod:muteduration')
      .setLabel('⏱️ Durée de mute par défaut')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('setup:mod:strikes')
      .setLabel(strikes.enabled ? '🔴 Désactiver les paliers' : '🟢 Activer les paliers')
      .setStyle(strikes.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('setup:mod:strikescfg')
      .setLabel('📈 Régler les paliers')
      .setStyle(ButtonStyle.Primary),
    backButton('home'),
  );
  return { embeds: [embed], components: [buttons] };
}

// ── Page logs ─────────────────────────────────────────────────────────────────

function logsView(guild) {
  const settings = getSettings(guild.id);
  const lines = Object.entries(LOG_TYPES).map(([type, meta]) => {
    const channel = settings.logsChannels[type] && guild.channels.cache.get(settings.logsChannels[type]);
    return `${meta.emoji} **${meta.label}** — ${channel ? `${channel}` : '🔴 non configuré'}`;
  });

  const embed = panelEmbed(
    guild,
    '📜 Salons de logs',
    [
      "Choisis un type de log dans le menu pour lui attribuer un salon (existant ou créé pour l'occasion).",
      '',
      lines.join('\n'),
    ].join('\n'),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('setup:logs:type')
    .setPlaceholder('📜 Choisis un type de log à configurer…')
    .addOptions(
      Object.entries(LOG_TYPES).map(([type, meta]) =>
        new StringSelectMenuOptionBuilder().setValue(type).setLabel(meta.label).setEmoji(meta.emoji),
      ),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:logs:auto')
      .setLabel('⚡ Créer tous les salons manquants')
      .setStyle(ButtonStyle.Primary),
    backButton('home'),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), buttons] };
}

// ── Page d'un type de log ─────────────────────────────────────────────────────

function logTypeView(guild, type) {
  const meta = LOG_TYPES[type];
  const settings = getSettings(guild.id);
  const channel = settings.logsChannels[type] && guild.channels.cache.get(settings.logsChannels[type]);

  const embed = panelEmbed(
    guild,
    `${meta.emoji} Logs ${meta.label}`,
    [
      `**Salon actuel :** ${channel ? `${channel}` : '🔴 non configuré'}`,
      '',
      '• Sélectionne un **salon existant** dans le menu ci-dessous, ou',
      `• Clique sur **➕ Créer** pour créer \`#${meta.channelName}\` dans la catégorie 📜 Logs, ou`,
      '• Clique sur **🆔 Par ID** pour coller un ID, une mention `<#…>` ou un lien de salon',
    ].join('\n'),
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:logs:channel:${type}`)
    .setPlaceholder('🔍 Choisir un salon existant…')
    .setChannelTypes(ChannelType.GuildText);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:logs:create:${type}`)
      .setLabel('➕ Créer le salon')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:logs:byid:${type}`).setLabel('🆔 Par ID').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setup:logs:off:${type}`)
      .setLabel('🔴 Désactiver ce log')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!settings.logsChannels[type]),
    backButton('logs'),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), buttons] };
}

// ── Page vérification ─────────────────────────────────────────────────────────

function verificationView(guild) {
  const settings = getSettings(guild.id);
  const vc = settings.verifConfig;
  const channel = vc.channel && guild.channels.cache.get(vc.channel);
  const role = vc.role && guild.roles.cache.get(vc.role);

  const embed = panelEmbed(
    guild,
    '✅ Vérification',
    [
      `${settings.modules.verification ? '🟢 Module activé' : '🔴 Module désactivé — active-le dans 🧩 Modules pour que le bouton fonctionne'}`,
      '',
      `📢 **Salon du panneau** — ${channel ? `${channel}` : '🔴 non configuré'}`,
      `🎭 **Rôle donné à la vérification** — ${role ? `${role}` : '🔴 non configuré'}`,
      `📝 **Message du panneau** (variable \`{serveur}\`, jusqu'à 4000 caractères — mets-y tes règles !) :`,
      `> ${vc.message.length > 300 ? `${vc.message.slice(0, 300)}…` : vc.message}`,
      '',
      "Une fois salon + rôle choisis, clique sur **📤 Publier le panneau** : le bot poste l'embed avec le bouton **✅ Vérification** dans le salon.",
      '💡 *Astuce : cache les autres salons au rôle @everyone et rends-les visibles au rôle vérifié.*',
    ].join('\n'),
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup:verif:channel')
    .setPlaceholder('📢 Salon où publier le panneau de vérification…')
    .setChannelTypes(ChannelType.GuildText);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:verif:role')
    .setPlaceholder('🎭 Rôle donné aux membres vérifiés…')
    .setMinValues(1)
    .setMaxValues(1);
  if (role) roleSelect.setDefaultRoles([role.id]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:verif:publish')
      .setLabel('📤 Publier le panneau')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!channel || !role),
    new ButtonBuilder().setCustomId('setup:verif:msg').setLabel('📝 Message').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:verif:chanid').setLabel('🆔 Salon par ID').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:verif:roleid').setLabel('🆔 Rôle par ID').setStyle(ButtonStyle.Primary),
    backButton('home'),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      buttons,
    ],
  };
}

// ── Page auto-modération ──────────────────────────────────────────────────────

const SANCTION_LABELS = { none: 'aucune (suppression seule)', warn: 'warn', mute: 'mute' };

function automodView(guild) {
  const settings = getSettings(guild.id);
  const am = settings.automodConfig;
  const dot = (enabled) => (enabled ? '🟢' : '🔴');

  const embed = panelEmbed(
    guild,
    '🤖 Auto-modération',
    [
      `${settings.modules.automod ? '🟢 Module activé' : '🔴 Module désactivé — active-le dans 🧩 Modules pour que les protections agissent'}`,
      '',
      `${dot(am.antispam.enabled)} 💬 **Antispam** — ${am.antispam.messages} messages en ${am.antispam.seconds}s`,
      `${dot(am.antilink.enabled)} 🔗 **Antilink** — ${am.antilink.mode === 'all' ? 'tous les liens' : 'invitations Discord uniquement'}`,
      `${dot(am.antimention.enabled)} 📣 **Antimention** — ${am.antimention.max} mentions max par message`,
      `${dot(am.badwords.enabled)} 🤬 **Mots interdits** — ${am.badwords.words.length} mot(s) dans la liste`,
      '',
      `⚖️ **Sanction automatique :** ${SANCTION_LABELS[am.sanction]}${am.sanction === 'mute' ? ` (${am.muteDuration})` : ''}`,
      '*Le message est toujours supprimé. Les admins du bot ne sont jamais affectés.*',
    ].join('\n'),
  );

  const toggleButton = (key, emoji, label, enabled) =>
    new ButtonBuilder()
      .setCustomId(`setup:am:toggle:${key}`)
      .setLabel(`${emoji} ${label} : ${enabled ? 'ON' : 'OFF'}`)
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        toggleButton('antispam', '💬', 'Antispam', am.antispam.enabled),
        new ButtonBuilder().setCustomId('setup:am:spamcfg').setLabel('⚙️ Seuil antispam').setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        toggleButton('antilink', '🔗', 'Antilink', am.antilink.enabled),
        new ButtonBuilder()
          .setCustomId('setup:am:linkmode')
          .setLabel(`🔁 Mode : ${am.antilink.mode === 'all' ? 'tous les liens' : 'invitations'}`)
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        toggleButton('antimention', '📣', 'Antimention', am.antimention.enabled),
        new ButtonBuilder()
          .setCustomId('setup:am:mentioncfg')
          .setLabel('⚙️ Seuil mentions')
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        toggleButton('badwords', '🤬', 'Mots interdits', am.badwords.enabled),
        new ButtonBuilder()
          .setCustomId('setup:am:wordsview')
          .setLabel('👀 Voir la liste')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup:am:wordscfg')
          .setLabel('📝 Gérer la liste')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup:am:wordsdefault')
          .setLabel('📥 Liste par défaut')
          .setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('setup:am:sanction')
          .setLabel(`⚖️ Sanction : ${SANCTION_LABELS[am.sanction]}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup:am:muteduration')
          .setLabel('⏱️ Durée du mute')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(am.sanction !== 'mute'),
        backButton('home'),
      ),
    ],
  };
}

// ── Pages tickets ─────────────────────────────────────────────────────────────

function ticketsView(guild) {
  const settings = getSettings(guild.id);
  const tc = settings.ticketsConfig;
  const channel = tc.panelChannel && guild.channels.cache.get(tc.panelChannel);
  const role = tc.requiredRole && guild.roles.cache.get(tc.requiredRole);
  const typesList = tc.types.length
    ? tc.types
        .map(
          (t) =>
            `• ${t.emoji ? `${t.emoji} ` : ''}**${t.label}** → ${t.categoryId ? `<#${t.categoryId}>` : '🔴 pas de catégorie'}`,
        )
        .join('\n')
    : '*Aucun type — crée ton premier type dans le menu ci-dessous.*';

  const imageStatus = !tc.panelImage
    ? '🔴 aucune'
    : tc.panelImage.startsWith('file:')
      ? '🟢 image uploadée (stockée sur le serveur)'
      : `🔗 ${tc.panelImage.slice(0, 60)}`;
  const embed = panelEmbed(
    guild,
    '🎫 Tickets',
    [
      `${settings.modules.tickets ? '🟢 Module activé' : '🔴 Module désactivé — active-le dans 🧩 Modules'}`,
      '',
      `📢 **Salon du panneau** — ${channel ? `${channel}` : '🔴 non configuré'}`,
      `📝 **Titre de l'embed** — ${tc.panelTitle ? `**${tc.panelTitle}**` : '*aucun*'}`,
      `🖼️ **Image du panneau** — ${imageStatus}`,
      `🎭 **Rôle requis pour ouvrir** — ${role ? `${role}` : 'aucun (tout le monde)'}`,
      `⚙️ **Réglages** — max ${tc.maxPerUser}/personne | fermeture au départ ${tc.closeOnLeave ? '🟢' : '🔴'} | transcript MP ${tc.transcriptDM ? '🟢' : '🔴'}`,
      `⭐ **Notation des avis** — ${tc.feedbackChannel ? '🟢 active' : '🔴 inactive'} (bouton ⭐ ci-dessous)`,
      '',
      `**Types de tickets (${tc.types.length}) :**`,
      typesList,
      '',
      'Configure tes types puis clique sur **📤 Publier le panneau**.',
    ].join('\n'),
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup:tk:panelchannel')
    .setPlaceholder('📢 Salon où publier le panneau de tickets…')
    .setChannelTypes(ChannelType.GuildText);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:tk:reqrole')
    .setPlaceholder('🎭 Rôle requis pour ouvrir un ticket (vide = tout le monde)…')
    .setMinValues(0)
    .setMaxValues(1);
  if (role) roleSelect.setDefaultRoles([role.id]);

  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('setup:tk:type')
    .setPlaceholder('🎫 Gérer un type de ticket…')
    .addOptions([
      ...tc.types.map((t) =>
        new StringSelectMenuOptionBuilder()
          .setValue(t.id)
          .setLabel(`${t.emoji ? `${t.emoji} ` : ''}${t.label}`.slice(0, 100))
          .setDescription((t.description || 'Configurer ce type').slice(0, 100)),
      ),
      new StringSelectMenuOptionBuilder()
        .setValue('__new')
        .setLabel('➕ Créer un nouveau type')
        .setDescription('Ajoute un choix au sélecteur du panneau'),
    ]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:tk:panelmsg').setLabel('📝 Titre & message').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:tk:img').setLabel('🖼️ Image').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:tk:settings').setLabel('⚙️ Réglages').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('setup:tk:publish')
      .setLabel('📤 Publier le panneau')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!channel || tc.types.length === 0),
    backButton('home'),
  );

  const channelButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:tk:chanid')
      .setLabel('🆔 Salon par ID ou lien')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('setup:tk:reqroleid')
      .setLabel('🆔 Rôle requis par ID')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('setup:goto:tkreviews')
      .setLabel('⭐ Notation des avis')
      .setStyle(ButtonStyle.Primary),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(typeSelect),
      channelButtons,
      buttons,
    ],
  };
}

function ticketSettingsView(guild) {
  const tc = getSettings(guild.id).ticketsConfig;
  const embed = panelEmbed(
    guild,
    '🎫 Réglages des tickets',
    [
      `🔢 **Tickets max par personne** — ${tc.maxPerUser}`,
      `${tc.closeOnLeave ? '🟢' : '🔴'} **Fermeture automatique** des tickets d'un membre qui quitte le serveur`,
      `${tc.transcriptDM ? '🟢' : '🔴'} **Transcript en MP** à l'ouvreur quand le ticket est fermé`,
      `${tc.autoCloseDays ? '🟢' : '🔴'} **Fermeture des tickets inactifs** — ${tc.autoCloseDays ? `sans message de l'ouvreur depuis **${tc.autoCloseDays} jours** (avertissement 24 h avant)` : 'désactivée'}`,
      '',
      "*Le transcript est toujours envoyé dans le salon 📜 logs-tickets s'il est configuré.*",
      tc.autoCloseDays
        ? "*Seuls les messages de l'ouvreur comptent : une relance du staff sans réponse ne prolonge pas le ticket.*"
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:tk:maxper').setLabel('🔢 Max par personne').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('setup:tk:closeonleave')
      .setLabel(tc.closeOnLeave ? '🔴 Désactiver fermeture au départ' : '🟢 Activer fermeture au départ')
      .setStyle(tc.closeOnLeave ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('setup:tk:transcriptdm')
      .setLabel(tc.transcriptDM ? '🔴 Désactiver transcript MP' : '🟢 Activer transcript MP')
      .setStyle(tc.transcriptDM ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('setup:tk:autoclose').setLabel('⏰ Tickets inactifs').setStyle(ButtonStyle.Primary),
    backButton('tickets'),
  );
  return { embeds: [embed], components: [buttons] };
}

function ticketReviewsView(guild) {
  const tc = getSettings(guild.id).ticketsConfig;
  const feedback = tc.feedbackChannel && guild.channels.cache.get(tc.feedbackChannel);
  const review = tc.reviewChannel && guild.channels.cache.get(tc.reviewChannel);
  const role = tc.reviewRole && guild.roles.cache.get(tc.reviewRole);

  const embed = panelEmbed(
    guild,
    '⭐ Notation des avis clients',
    [
      `${feedback ? '🟢 **Notation active**' : "🔴 **Notation inactive** — configure le salon des avis pour l'activer"}`,
      '',
      `⭐ **Salon des avis publiés** — ${feedback ? `${feedback}` : '🔴 non configuré'}`,
      `🛃 **Salon staff de validation** — ${review ? `${review}` : '📬 aucun : les avis arrivent en MP au owner pour validation'}`,
      `🎁 **Rôle donné au client** à la publication — ${role ? `${role}` : '*aucun*'}`,
      '',
      "**Fonctionnement :** à la fermeture d'un ticket, l'ouvreur reçoit en MP une demande d'avis : note 1 à 5 ⭐, commentaire et image facultatifs, envoi par bouton 📤. Un **5⭐ sans commentaire ni image** est publié directement ; tout autre avis est validé (✅ / ❌, transcript joint) dans le salon de validation, ou en MP au owner si aucun n'est configuré.",
      '*Sans envoi sous 7 jours, ou si le membre est parti, un avis 5⭐ générique est publié automatiquement.*',
    ].join('\n'),
  );

  const feedbackSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup:tk:fbchan')
    .setPlaceholder('⭐ Salon où publier les avis clients…')
    .setChannelTypes(ChannelType.GuildText);
  if (feedback) feedbackSelect.setDefaultChannels([feedback.id]);

  const reviewSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup:tk:rvchan')
    .setPlaceholder('🛃 Salon staff de validation (vide = MP au owner)…')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (review) reviewSelect.setDefaultChannels([review.id]);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:tk:fbrole')
    .setPlaceholder('🎁 Rôle donné au client à la publication (vide = aucun)…')
    .setMinValues(0)
    .setMaxValues(1);
  if (role) roleSelect.setDefaultRoles([role.id]);

  const idButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:tk:fbchanid').setLabel('🆔 Salon avis par ID').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('setup:tk:rvchanid')
      .setLabel('🆔 Salon validation par ID')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:tk:fbroleid').setLabel('🆔 Rôle par ID').setStyle(ButtonStyle.Primary),
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:tk:fboff')
      .setLabel('🔴 Désactiver la notation')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!tc.feedbackChannel),
    backButton('tickets'),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(feedbackSelect),
      new ActionRowBuilder().addComponents(reviewSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      idButtons,
      buttons,
    ],
  };
}

function ticketTypeView(guild, typeId) {
  const tc = getSettings(guild.id).ticketsConfig;
  const type = tc.types.find((t) => t.id === typeId);
  if (!type) return ticketsView(guild);

  const category = type.categoryId && guild.channels.cache.get(type.categoryId);
  const mentions = (type.mentionRoles ?? []).map((id) => `<@&${id}>`).join(' ') || '*aucun*';
  const access = (type.accessRoles ?? []).map((id) => `<@&${id}>`).join(' ') || '*aucun (admins du bot seulement)*';

  const embed = panelEmbed(
    guild,
    `🎫 Type : ${type.emoji ? `${type.emoji} ` : ''}${type.label}`,
    [
      `**Description :** ${type.description || '*aucune*'}`,
      `📁 **Catégorie des tickets** — ${category ? `${category.name}` : '🔴 non configurée (créés hors catégorie)'}`,
      `📣 **Rôles mentionnés à l'ouverture** — ${mentions}`,
      `🔑 **Rôles ayant accès aux tickets** — ${access}`,
      `💬 **Message d'ouverture :**`,
      `> ${type.openMessage || 'Merci de nous avoir contactés, précise ce que tu souhaites.'}`,
    ].join('\n'),
  );

  const categorySelect = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:tk:cat:${type.id}`)
    .setPlaceholder('📁 Catégorie où créer les tickets de ce type…')
    .setChannelTypes(ChannelType.GuildCategory);

  const mentionSelect = new RoleSelectMenuBuilder()
    .setCustomId(`setup:tk:mention:${type.id}`)
    .setPlaceholder("📣 Rôles mentionnés à l'ouverture…")
    .setMinValues(0)
    .setMaxValues(10);
  if (type.mentionRoles?.length) mentionSelect.setDefaultRoles(type.mentionRoles.slice(0, 10));

  const accessSelect = new RoleSelectMenuBuilder()
    .setCustomId(`setup:tk:access:${type.id}`)
    .setPlaceholder('🔑 Rôles ayant accès aux tickets de ce type…')
    .setMinValues(0)
    .setMaxValues(10);
  if (type.accessRoles?.length) accessSelect.setDefaultRoles(type.accessRoles.slice(0, 10));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:tk:label:${type.id}`)
      .setLabel('📝 Nom & description')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setup:tk:openmsg:${type.id}`)
      .setLabel("💬 Message d'ouverture")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setup:tk:del:${type.id}`)
      .setLabel('🗑️ Supprimer ce type')
      .setStyle(ButtonStyle.Danger),
    backButton('tickets'),
  );

  const index = tc.types.findIndex((t) => t.id === type.id);
  const idButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:tk:catid:${type.id}`)
      .setLabel('🆔 Catégorie par ID')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setup:tk:rolesid:${type.id}`)
      .setLabel('🆔 Rôles par ID')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setup:tk:up:${type.id}`)
      .setLabel('⬆️ Monter dans le panneau')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId(`setup:tk:down:${type.id}`)
      .setLabel('⬇️ Descendre')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === tc.types.length - 1),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(categorySelect),
      new ActionRowBuilder().addComponents(mentionSelect),
      new ActionRowBuilder().addComponents(accessSelect),
      idButtons,
      buttons,
    ],
  };
}

// ── Pages commandes custom ────────────────────────────────────────────────────

function customView(guild) {
  const settings = getSettings(guild.id);
  const commands = settings.customCommands;
  const list = commands.length
    ? commands
        .map(
          (c) =>
            `• \`${c.prefix}${c.name}\` — ${c.response.embed ? 'embed' : 'texte'}${c.deleteTrigger ? ' · 🗑️ auto' : ''}${c.allowedRoles.length ? ` · ${c.allowedRoles.length} rôle(s)` : ' · tout le monde'}`,
        )
        .join('\n')
    : '*Aucune commande — crée la première dans le menu ci-dessous.*';

  const embed = panelEmbed(
    guild,
    '🧩 Commandes custom',
    [
      `${settings.modules.custom ? '🟢 Module activé' : '🔴 Module désactivé — active-le dans 🧩 Modules pour que les commandes répondent'}`,
      '',
      `**Commandes (${commands.length}) :**`,
      list,
      '',
      'Variables utilisables dans les réponses : `{membre}` `{pseudo}` `{salon}` `{serveur}`',
    ].join('\n'),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId('setup:cc:pick')
    .setPlaceholder('🧩 Gérer une commande…')
    .addOptions([
      ...commands.slice(0, 24).map((c) =>
        new StringSelectMenuOptionBuilder()
          .setValue(c.id)
          .setLabel(`${c.prefix}${c.name}`.slice(0, 100))
          .setDescription((c.response.content || '').slice(0, 100) || 'Configurer cette commande'),
      ),
      new StringSelectMenuOptionBuilder()
        .setValue('__new')
        .setLabel('➕ Créer une nouvelle commande')
        .setDescription('Préfixe, nom, rôles, réponse personnalisée'),
    ]);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(backButton('home')),
    ],
  };
}

function customEditView(guild, commandId) {
  const command = getSettings(guild.id).customCommands.find((c) => c.id === commandId);
  if (!command) return customView(guild);

  const roles = command.allowedRoles.map((id) => `<@&${id}>`).join(' ') || '*tout le monde*';
  const imageStatus = !command.response.image
    ? '🔴 aucune'
    : command.response.image.startsWith('file:')
      ? '🟢 image uploadée (stockée sur le serveur)'
      : `🔗 ${command.response.image.slice(0, 80)}`;
  const embed = panelEmbed(
    guild,
    `🧩 Commande \`${command.prefix}${command.name}\``,
    [
      `🎭 **Rôles autorisés** — ${roles}`,
      "*(les admins du bot peuvent toujours l'utiliser, teste avec un compte non-admin)*",
      `🗑️ **Suppression auto du message déclencheur** — ${command.deleteTrigger ? '🟢' : '🔴'}`,
      `📦 **Format de la réponse** — ${command.response.embed ? 'embed' : 'texte simple'}${command.response.title ? ` (titre : ${command.response.title})` : ''}`,
      `📣 **Mention au-dessus de l'embed** — ${command.response.mention ? `\`${command.response.mention}\`` : '*aucune*'}`,
      `🖼️ **Image (embed)** — ${imageStatus}`,
      `💬 **Réponse :**`,
      `> ${(command.response.content || '*vide — configure-la avec 💬*').slice(0, 300)}`,
    ].join('\n'),
  );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`setup:cc:roles:${command.id}`)
    .setPlaceholder('🎭 Rôles autorisés à utiliser la commande (vide = tout le monde)…')
    .setMinValues(0)
    .setMaxValues(10);
  if (command.allowedRoles.length) roleSelect.setDefaultRoles(command.allowedRoles.slice(0, 10));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:cc:name:${command.id}`)
      .setLabel('📝 Préfixe & nom')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:cc:resp:${command.id}`).setLabel('💬 Réponse').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:cc:del:${command.id}`).setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
    backButton('custom'),
  );

  const toggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:cc:deltrig:${command.id}`)
      .setLabel(command.deleteTrigger ? '🗑️ Suppression auto : ON' : '🗑️ Suppression auto : OFF')
      .setStyle(command.deleteTrigger ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setup:cc:embed:${command.id}`)
      .setLabel(command.response.embed ? '📦 Réponse : embed' : '📦 Réponse : texte')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`setup:cc:img:${command.id}`)
      .setLabel('🖼️ Image')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!command.response.embed),
    new ButtonBuilder()
      .setCustomId(`setup:cc:rolesid:${command.id}`)
      .setLabel('🆔 Rôles par ID')
      .setStyle(ButtonStyle.Primary),
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(roleSelect), toggles, buttons],
  };
}

// ── Page giveaways ────────────────────────────────────────────────────────────

function giveawaysView(guild) {
  const settings = getSettings(guild.id);
  const { activeGiveaways } = require('./giveaways');
  const active = activeGiveaways(guild.id);
  const role = settings.giveawaysConfig.requiredRole && guild.roles.cache.get(settings.giveawaysConfig.requiredRole);
  const list = active.length
    ? active
        .map(
          (g) =>
            `• **${g.prize}** — fin <t:${Math.floor(g.ends_at / 1000)}:R> · ${JSON.parse(g.participants).length} participant(s) · <#${g.channel_id}>`,
        )
        .join('\n')
    : '*Aucun giveaway en cours.*';

  const embed = panelEmbed(
    guild,
    '🎉 Giveaways',
    [
      `${settings.modules.giveaways ? '🟢 Module activé' : '🔴 Module désactivé — active-le dans 🧩 Modules ou choisis un rôle requis ci-dessous'}`,
      '',
      `🎭 **Rôle requis pour participer** — ${role ? `${role}` : 'aucun (tout le monde)'}`,
      '',
      `**Giveaways en cours (${active.length}) :**`,
      list,
      '',
      'Lance un giveaway avec **`/giveaway`** dans le salon voulu : lot, durée, nombre de gagnants. Fin anticipée et reroll directement sur le message du giveaway.',
    ].join('\n'),
  );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:gv:reqrole')
    .setPlaceholder('🎭 Rôle requis pour participer (vide = tout le monde)…')
    .setMinValues(0)
    .setMaxValues(1);
  if (role) roleSelect.setDefaultRoles([role.id]);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup:gv:roleid').setLabel('🆔 Rôle par ID').setStyle(ButtonStyle.Primary),
        backButton('home'),
      ),
    ],
  };
}

// ── Page vocaux temporaires ───────────────────────────────────────────────────

function tempvocView(guild) {
  const settings = getSettings(guild.id);
  const tv = settings.tempvocConfig;
  const generator = tv.generatorChannel && guild.channels.cache.get(tv.generatorChannel);
  const accessRoles = (tv.accessRoles ?? []).map((id) => `<@&${id}>`).join(' ') || '*tout le monde*';

  const embed = panelEmbed(
    guild,
    '🔊 Vocaux temporaires',
    [
      `${settings.modules.tempvoc ? '🟢 Module activé' : "🔴 Module désactivé — configure le générateur ci-dessous pour l'activer"}`,
      '',
      `➕ **Salon générateur** — ${generator ? `${generator.name}` : '🔴 non configuré'}`,
      `📝 **Modèle de nom** — \`${tv.nameTemplate}\` (variable \`{pseudo}\`)`,
      `🎭 **Qui voit et rejoint le générateur** — ${accessRoles}`,
      `🛡️ **Rôle admin des vocaux créés** — ${tv.adminRole ? `<@&${tv.adminRole}>` : '*aucun*'}`,
      '',
      "Le générateur est **verrouillé automatiquement** : chat, parole et stream bloqués pour tous (c'est un salon de passage). Les salons créés héritent de la visibilité des rôles d'accès.",
      '',
      "**Fonctionnement :** un membre rejoint le générateur → son salon perso est créé et il y est déplacé, avec un panneau de contrôle dans le chat du vocal (✏️ renommer, 🔒 verrouiller, 👥 limite). Le salon est supprimé dès qu'il est vide.",
    ].join('\n'),
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('setup:tv:generator')
    .setPlaceholder('➕ Choisir un salon vocal existant comme générateur…')
    .setChannelTypes(ChannelType.GuildVoice);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:tv:roles')
    .setPlaceholder('🎭 Rôles pouvant voir/rejoindre le générateur (vide = tout le monde)…')
    .setMinValues(0)
    .setMaxValues(10);
  if (tv.accessRoles?.length) roleSelect.setDefaultRoles(tv.accessRoles.slice(0, 10));

  const adminSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:tv:adminrole')
    .setPlaceholder('🛡️ Rôle admin des vocaux créés (droits étendus, vide = aucun)…')
    .setMinValues(0)
    .setMaxValues(1);
  if (tv.adminRole) adminSelect.setDefaultRoles([tv.adminRole]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:tv:create')
      .setLabel('➕ Créer le salon générateur')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:tv:byid').setLabel('🆔 Salon par ID').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:tv:rolesid').setLabel('🆔 Rôles par ID').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:tv:name').setLabel('📝 Modèle de nom').setStyle(ButtonStyle.Primary),
    backButton('home'),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(adminSelect),
      buttons,
    ],
  };
}

// ── Page stats ────────────────────────────────────────────────────────────────

function statsView(guild) {
  const settings = getSettings(guild.id);
  const counters = settings.statsConfig.counters;
  const list = counters.length
    ? counters
        .map((c) => {
          const channel = guild.channels.cache.get(c.channelId);
          return `• ${channel ? `**${channel.name}**` : `🔴 salon supprimé (${c.label})`}`;
        })
        .join('\n')
    : '*Aucun compteur.*';

  const category = settings.statsConfig.categoryId && guild.channels.cache.get(settings.statsConfig.categoryId);
  const viewRoles = (settings.statsConfig.accessRoles ?? []).map((id) => `<@&${id}>`).join(' ') || '*tout le monde*';
  const embed = panelEmbed(
    guild,
    '📊 Stats du serveur',
    [
      `${settings.modules.stats ? '🟢 Module activé' : "🔴 Module désactivé — ajoute un compteur pour l'activer"}`,
      '',
      `📁 **Catégorie** — ${category ? `**${category.name}**` : `\`${settings.statsConfig.categoryName}\` (créée avec le premier compteur)`}`,
      `👁️ **Qui voit les compteurs** — ${viewRoles}`,
      `**Compteurs (${counters.length}) :**`,
      list,
      '',
      'Avec des rôles configurés : everyone est **totalement refusé** (voir compris) et les rôles n\'ont que "Voir le salon". Les salons sont **synchronisés avec la catégorie**.',
      'Mise à jour **automatique tous les jours à 4h** (+ au démarrage du bot). Compteurs par rôle : **nom du rôle tel quel**, sans emoji ajouté.',
    ].join('\n'),
  );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:st:addrole')
    .setPlaceholder('➕ CRÉER des compteurs : choisis un ou plusieurs rôles…')
    .setMinValues(1)
    .setMaxValues(10);

  const viewRolesSelect = new RoleSelectMenuBuilder()
    .setCustomId('setup:st:viewroles')
    .setPlaceholder('👁️ VISIBILITÉ : qui peut voir la catégorie (pas de création ici)…')
    .setMinValues(0)
    .setMaxValues(10);
  if (settings.statsConfig.accessRoles?.length)
    viewRolesSelect.setDefaultRoles(settings.statsConfig.accessRoles.slice(0, 10));

  const components = [
    new ActionRowBuilder().addComponents(roleSelect),
    new ActionRowBuilder().addComponents(viewRolesSelect),
  ];

  if (counters.length) {
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId('setup:st:remove')
      .setPlaceholder('🗑️ Supprimer un compteur…')
      .addOptions(
        counters
          .slice(0, 25)
          .map((c) =>
            new StringSelectMenuOptionBuilder()
              .setValue(c.id)
              .setLabel((guild.channels.cache.get(c.channelId)?.name ?? c.label).slice(0, 100)),
          ),
      );
    components.push(new ActionRowBuilder().addComponents(removeSelect));
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:st:members').setLabel('➕ Compteur Membres').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:st:rolesid').setLabel('🆔 Rôles par ID').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('setup:st:catname')
        .setLabel('📁 Nom de la catégorie')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('setup:st:refresh')
        .setLabel('🔄 Actualiser')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!counters.length),
      backButton('home'),
    ),
  );

  return { embeds: [embed], components };
}

// ── Page antiraid ─────────────────────────────────────────────────────────────

const AR_SANCTION_LABELS = { mute: 'derank complet + mute 24h', ban24: 'ban 24h', ban: 'ban définitif' };
const AR_MASSJOIN_LABELS = { alert: 'alerte seule', kick: 'kick ⚠️' };

function antiraidView(guild) {
  const settings = getSettings(guild.id);
  const ar = settings.antiraidConfig;
  const dot = (enabled) => (enabled ? '🟢' : '🔴');
  const whitelist = ar.whitelist.map((id) => `<@${id}>`).join(' ') || '*personne (owner toujours exempté)*';

  const embed = panelEmbed(
    guild,
    '🛡️ Antiraid',
    [
      `${settings.modules.antiraid ? '🟢 Module activé' : "🔴 Module désactivé — active une protection pour l'activer"}`,
      '',
      `${dot(ar.antibot.enabled)} 🤖 **Antibot** — **seul le owner** peut ajouter des bots (bot kick + ajouteur puni)`,
      `${dot(ar.antichannel.enabled)} 📁 **Antichannel** — ${ar.antichannel.max} créations/suppressions de salons en ${ar.antichannel.seconds}s`,
      `${dot(ar.antirole.enabled)} 🎭 **Antirole** — ${ar.antirole.max} créations/suppressions de rôles en ${ar.antirole.seconds}s`,
      `${dot(ar.antiwebhook.enabled)} 🪝 **Antiwebhook** — webhook créé par un non-whitelisté : supprimé + punition`,
      `${dot(ar.antiban.enabled)} 🔨 **Antiban** — ${ar.antiban.max} bans en ${ar.antiban.seconds}s`,
      `${dot(ar.massjoin.enabled)} 👥 **Vague d'arrivées** — ${ar.massjoin.max} arrivées en ${ar.massjoin.seconds}s → **${AR_MASSJOIN_LABELS[ar.massjoin.mode]}**`,
      '',
      `⚖️ **Punition :** ${AR_SANCTION_LABELS[ar.sanction] ?? AR_SANCTION_LABELS.mute} · 📜 tout part dans le salon logs-raid`,
      '⚠️ *Vagues de boost : le seuil par défaut (50/100s) laisse passer largement tes arrivées groupées, et le mode **alerte** ne touche aucun membre.*',
    ].join('\n'),
  );

  const toggle = (key, emoji, label) =>
    new ButtonBuilder()
      .setCustomId(`setup:ar:toggle:${key}`)
      .setLabel(`${emoji} ${label} : ${ar[key].enabled ? 'ON' : 'OFF'}`)
      .setStyle(ar[key].enabled ? ButtonStyle.Success : ButtonStyle.Secondary);

  const whitelistSelect = new UserSelectMenuBuilder()
    .setCustomId('setup:ar:whitelist')
    .setPlaceholder("🤍 Whitelist : jamais touchés par l'antiraid…")
    .setMinValues(0)
    .setMaxValues(25);
  if (ar.whitelist.length) whitelistSelect.setDefaultUsers(ar.whitelist.slice(0, 25));

  const embed2 = embed.addFields({ name: '🤍 Whitelist', value: whitelist.slice(0, 1024) });

  return {
    embeds: [embed2],
    components: [
      new ActionRowBuilder().addComponents(
        toggle('antibot', '🤖', 'Antibot'),
        toggle('antichannel', '📁', 'Antichannel'),
        toggle('antirole', '🎭', 'Antirole'),
      ),
      new ActionRowBuilder().addComponents(
        toggle('antiwebhook', '🪝', 'Antiwebhook'),
        toggle('antiban', '🔨', 'Antiban'),
        toggle('massjoin', '👥', "Vague d'arrivées"),
      ),
      new ActionRowBuilder().addComponents(whitelistSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('setup:ar:sanction')
          .setLabel(`⚖️ Punition : ${AR_SANCTION_LABELS[ar.sanction] ?? AR_SANCTION_LABELS.mute}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup:ar:joinmode')
          .setLabel(`👥 Mode arrivées : ${AR_MASSJOIN_LABELS[ar.massjoin.mode]}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup:ar:limits').setLabel('⚙️ Seuils').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup:ar:wlid').setLabel('🆔 Whitelist par ID').setStyle(ButtonStyle.Primary),
        backButton('home'),
      ),
    ],
  };
}

const PAGES = {
  home: hubView,
  general: generalView,
  admins: adminsView,
  modules: modulesView,
  moderation: moderationView,
  logs: logsView,
  verification: verificationView,
  automod: automodView,
  tickets: ticketsView,
  tksettings: ticketSettingsView,
  tkreviews: ticketReviewsView,
  custom: customView,
  giveaways: giveawaysView,
  tempvoc: tempvocView,
  stats: statsView,
  antiraid: antiraidView,
};

// ── Routeur des interactions du panneau (customId = "setup:...") ────────────

async function handleSetupComponent(interaction) {
  const [, action, ...args] = interaction.customId.split(':');
  const guild = interaction.guild;

  // Chaque interaction relance le compte à rebours d'inactivité
  if (interaction.message) watchPanel(interaction.message);

  switch (action) {
    case 'nav':
      return interaction.update((PAGES[interaction.values[0]] ?? hubView)(guild));

    case 'goto':
      return interaction.update((PAGES[args[0]] ?? hubView)(guild));

    case 'done': {
      releasePanel(interaction.message.id);
      const embed = panelEmbed(
        guild,
        '✅ Setup terminé',
        'Relance `/setup` à tout moment pour modifier la configuration.\nUtilise `/help` pour voir les commandes disponibles.',
      );
      return interaction.update({ embeds: [embed], components: [] });
    }

    case 'modules': {
      const enabled = new Set(interaction.values);
      updateSettings(guild.id, (s) => {
        for (const key of Object.keys(MODULES)) s.modules[key] = enabled.has(key);
      });
      return interaction.update(modulesView(guild));
    }

    case 'admins': {
      if (args[0] === 'byid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:admin')
          .setTitle('Admin par ID Discord')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID du membre (ajout si absent, retrait sinon)')
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(30),
            ),
          );
        return interaction.showModal(modal);
      }
      const ids = [...interaction.users.filter((u) => !u.bot).keys()];
      updateSettings(guild.id, (s) => {
        s.admins = ids;
      });
      return interaction.update(adminsView(guild));
    }

    case 'color': {
      const modal = new ModalBuilder()
        .setCustomId('setup:modal:color')
        .setTitle('Couleur des embeds')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('hex')
              .setLabel('Couleur au format hexadécimal')
              .setPlaceholder('#5865F2')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(7),
          ),
        );
      return interaction.showModal(modal);
    }

    case 'status': {
      const modal = new ModalBuilder()
        .setCustomId('setup:modal:status')
        .setTitle('Statut du bot')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('text')
              .setLabel('Texte du statut (vide = aucun statut)')
              .setValue(require('./botStatus').getActivityText() ?? '')
              .setPlaceholder('🐍 MEDUSA SHOP')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(100),
          ),
        );
      return interaction.showModal(modal);
    }

    case 'mod': {
      if (args[0] === 'dm') {
        updateSettings(guild.id, (s) => {
          s.moderationConfig.dmOnSanction = !s.moderationConfig.dmOnSanction;
        });
        return interaction.update(moderationView(guild));
      }
      if (args[0] === 'strikes') {
        updateSettings(guild.id, (s) => {
          s.moderationConfig.strikes.enabled = !s.moderationConfig.strikes.enabled;
        });
        return interaction.update(moderationView(guild));
      }
      if (args[0] === 'strikescfg') {
        const strikes = getSettings(guild.id).moderationConfig.strikes;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:modstrikes')
          .setTitle('Sanctions par paliers')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('window')
                .setLabel('Fenêtre en jours (seuls ces warns comptent)')
                .setValue(`${strikes.windowDays}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('mutecount')
                .setLabel('Warns pour le mute automatique')
                .setValue(`${strikes.muteThreshold}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('muteduration')
                .setLabel('Durée du mute (ex: 1h, 24h, 3j — max 28j)')
                .setValue(strikes.muteDuration)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('bancount')
                .setLabel('Warns pour le ban définitif')
                .setValue(`${strikes.banThreshold}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
          );
        return interaction.showModal(modal);
      }
      if (args[0] === 'muteduration') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:muteduration')
          .setTitle('Durée de mute par défaut')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Durée (ex: 30m, 1h, 2j)')
                .setPlaceholder('1h')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'modal': {
      if (args[0] === 'color') {
        const hex = interaction.fields.getTextInputValue('hex').replace(/^#/, '');
        if (!/^[0-9a-f]{6}$/i.test(hex)) {
          return interaction.reply({
            content: '❌ Format invalide. Exemple attendu : `#5865F2`',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.color = parseInt(hex, 16);
        });
        return interaction.update(generalView(guild));
      }
      if (args[0] === 'status') {
        const text = interaction.fields.getTextInputValue('text').trim();
        require('./botStatus').setActivityText(interaction.client, text);
        return interaction.update(generalView(guild));
      }

      if (args[0] === 'muteduration') {
        const input = interaction.fields.getTextInputValue('duration').trim();
        const duration = parseDuration(input);
        if (!duration) {
          return interaction.reply({
            content: '❌ Durée invalide. Exemples : `30m`, `1h`, `2j`.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.moderationConfig.defaultMuteDuration = formatDuration(duration).replaceAll(' ', '');
        });
        return interaction.update(moderationView(guild));
      }

      if (args[0] === 'admin') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({
            content: "❌ ID invalide. Colle un ID Discord (Mode développeur → clic droit → Copier l'identifiant).",
            flags: MessageFlags.Ephemeral,
          });
        }
        const settings = getSettings(guild.id);
        if (settings.admins.includes(id)) {
          updateSettings(guild.id, (s) => {
            s.admins = s.admins.filter((a) => a !== id);
          });
          return interaction.update(adminsView(guild));
        }
        const user = await interaction.client.users.fetch(id).catch(() => null);
        if (!user) {
          return interaction.reply({
            content: `❌ Aucun utilisateur Discord trouvé avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (user.bot) {
          return interaction.reply({ content: '❌ Un bot ne peut pas être admin.', flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => {
          s.admins.push(id);
        });
        return interaction.update(adminsView(guild));
      }

      if (args[0] === 'logchannel') {
        const type = args[1];
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({
            content: '❌ ID invalide. Colle un ID de salon, une mention `<#…>` ou un lien de salon.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
          return interaction.reply({
            content: `❌ Aucun salon textuel trouvé sur ce serveur avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.logsChannels[type] = channel.id;
          s.modules.logs = true;
        });
        return interaction.update(logTypeView(guild, type));
      }

      if (args[0] === 'amspam') {
        const messages = parseInt(interaction.fields.getTextInputValue('messages'), 10);
        const seconds = parseInt(interaction.fields.getTextInputValue('seconds'), 10);
        if (
          !Number.isInteger(messages) ||
          messages < 2 ||
          messages > 20 ||
          !Number.isInteger(seconds) ||
          seconds < 2 ||
          seconds > 60
        ) {
          return interaction.reply({
            content: '❌ Valeurs invalides : 2 à 20 messages, fenêtre de 2 à 60 secondes.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.automodConfig.antispam.messages = messages;
          s.automodConfig.antispam.seconds = seconds;
        });
        return interaction.update(automodView(guild));
      }

      if (args[0] === 'ammention') {
        const max = parseInt(interaction.fields.getTextInputValue('max'), 10);
        if (!Number.isInteger(max) || max < 2 || max > 30) {
          return interaction.reply({
            content: '❌ Valeur invalide : entre 2 et 30 mentions.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.automodConfig.antimention.max = max;
        });
        return interaction.update(automodView(guild));
      }

      if (args[0] === 'amwords') {
        const words = interaction.fields
          .getTextInputValue('words')
          .split(',')
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length >= 2);
        updateSettings(guild.id, (s) => {
          s.automodConfig.badwords.words = [...new Set(words)].slice(0, 200);
        });
        return interaction.update(automodView(guild));
      }

      if (args[0] === 'ammute') {
        const duration = parseDuration(interaction.fields.getTextInputValue('duration').trim());
        if (!duration) {
          return interaction.reply({
            content: '❌ Durée invalide. Exemples : `10m`, `1h`.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.automodConfig.muteDuration = formatDuration(duration).replaceAll(' ', '');
        });
        return interaction.update(automodView(guild));
      }

      if (args[0] === 'ccname') {
        const commandId = args[1];
        const prefix = interaction.fields.getTextInputValue('prefix').trim();
        const name = interaction.fields.getTextInputValue('name').trim().toLowerCase().replaceAll(/\s+/g, '');
        if (!['+', '!', '.', '?', '-'].includes(prefix)) {
          return interaction.reply({
            content: '❌ Préfixe invalide : utilise `+`, `!`, `.`, `?` ou `-`.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (name.length < 2) {
          return interaction.reply({
            content: '❌ Nom trop court (2 caractères minimum, sans espace).',
            flags: MessageFlags.Ephemeral,
          });
        }
        const duplicate = getSettings(guild.id).customCommands.find(
          (c) => c.id !== commandId && c.prefix === prefix && c.name === name,
        );
        if (duplicate) {
          return interaction.reply({
            content: `❌ La commande \`${prefix}${name}\` existe déjà.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          const c = s.customCommands.find((cc) => cc.id === commandId);
          if (c) {
            c.prefix = prefix;
            c.name = name;
          }
        });
        return interaction.update(customEditView(guild, commandId));
      }

      if (args[0] === 'ccresp') {
        const commandId = args[1];
        updateSettings(guild.id, (s) => {
          const c = s.customCommands.find((cc) => cc.id === commandId);
          if (c) {
            c.response.title = interaction.fields.getTextInputValue('title').trim();
            c.response.content = interaction.fields.getTextInputValue('content').trim();
            c.response.mention = interaction.fields.getTextInputValue('mention').trim();
          }
        });
        return interaction.update(customEditView(guild, commandId));
      }

      if (args[0] === 'modstrikes') {
        const windowDays = parseInt(interaction.fields.getTextInputValue('window'), 10);
        const muteThreshold = parseInt(interaction.fields.getTextInputValue('mutecount'), 10);
        const banThreshold = parseInt(interaction.fields.getTextInputValue('bancount'), 10);
        const muteDuration = interaction.fields.getTextInputValue('muteduration').trim();
        if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
          return interaction.reply({
            content: '❌ Fenêtre invalide : entre 1 et 90 jours.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (!Number.isInteger(muteThreshold) || muteThreshold < 1 || muteThreshold > 50) {
          return interaction.reply({
            content: '❌ Seuil de mute invalide : entre 1 et 50 warns.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (!Number.isInteger(banThreshold) || banThreshold <= muteThreshold || banThreshold > 50) {
          return interaction.reply({
            content: '❌ Seuil de ban invalide : il doit être supérieur au seuil de mute (et ≤ 50).',
            flags: MessageFlags.Ephemeral,
          });
        }
        const durationMs = parseDuration(muteDuration);
        if (!durationMs || durationMs > 28 * 24 * 60 * 60 * 1000) {
          return interaction.reply({
            content: '❌ Durée de mute invalide (ex: `1h`, `24h`, `3j` — maximum 28j, limite Discord).',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.moderationConfig.strikes = { enabled: true, windowDays, muteThreshold, muteDuration, banThreshold }; // on configure → ça s'active
        });
        return interaction.update(moderationView(guild));
      }

      if (args[0] === 'tkmax') {
        const max = parseInt(interaction.fields.getTextInputValue('max'), 10);
        if (!Number.isInteger(max) || max < 1 || max > 10) {
          return interaction.reply({ content: '❌ Valeur invalide : entre 1 et 10.', flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.maxPerUser = max;
        });
        return interaction.update(ticketSettingsView(guild));
      }

      if (args[0] === 'tkautoclose') {
        const days = parseInt(interaction.fields.getTextInputValue('days'), 10);
        if (!Number.isInteger(days) || (days !== 0 && (days < 2 || days > 60))) {
          return interaction.reply({
            content:
              "❌ Valeur invalide : 0 (désactivé) ou entre 2 et 60 jours (l'avertissement part 24 h avant la fermeture).",
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.autoCloseDays = days;
        });
        return interaction.update(ticketSettingsView(guild));
      }

      if (args[0] === 'tkpanel') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.panelTitle = interaction.fields.getTextInputValue('title').trim();
          s.ticketsConfig.panelMessage = interaction.fields.getTextInputValue('message').trim();
        });
        return interaction.update(ticketsView(guild));
      }

      if (args[0] === 'tkchanid') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({
            content: '❌ ID invalide. Colle un ID de salon, une mention `<#…>` ou un lien de salon.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
          return interaction.reply({
            content: `❌ Aucun salon textuel trouvé sur ce serveur avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.panelChannel = channel.id;
          s.modules.tickets = true;
        });
        return interaction.update(ticketsView(guild));
      }

      if (args[0] === 'tkfbchanid' || args[0] === 'tkrvchanid') {
        const isFeedback = args[0] === 'tkfbchanid';
        const raw = interaction.fields.getTextInputValue('id').trim();
        if (!isFeedback && !raw) {
          updateSettings(guild.id, (s) => {
            s.ticketsConfig.reviewChannel = null;
          });
          return interaction.update(ticketReviewsView(guild));
        }
        const id = extractId(raw);
        if (!id) {
          return interaction.reply({
            content: '❌ ID invalide. Colle un ID de salon, une mention `<#…>` ou un lien de salon.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
          return interaction.reply({
            content: `❌ Aucun salon textuel trouvé sur ce serveur avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          if (isFeedback) {
            s.ticketsConfig.feedbackChannel = channel.id;
            s.modules.tickets = true;
          } else {
            s.ticketsConfig.reviewChannel = channel.id;
          }
        });
        return interaction.update(ticketReviewsView(guild));
      }

      if (args[0] === 'tkfbroleid') {
        const raw = interaction.fields.getTextInputValue('id').trim();
        const id = extractId(raw);
        if (raw && (!id || !guild.roles.cache.has(id))) {
          return interaction.reply({
            content: '❌ Aucun rôle trouvé sur ce serveur avec cet ID.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.reviewRole = id ?? null;
        });
        return interaction.update(ticketReviewsView(guild));
      }

      if (args[0] === 'tklabel') {
        const typeId = args[1];
        updateSettings(guild.id, (s) => {
          const type = s.ticketsConfig.types.find((t) => t.id === typeId);
          if (type) {
            type.emoji = interaction.fields.getTextInputValue('emoji').trim();
            type.label = interaction.fields.getTextInputValue('label').trim() || 'Ticket';
            type.description = interaction.fields.getTextInputValue('description').trim();
          }
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (args[0] === 'tkopenmsg') {
        const typeId = args[1];
        updateSettings(guild.id, (s) => {
          const type = s.ticketsConfig.types.find((t) => t.id === typeId);
          if (type) type.openMessage = interaction.fields.getTextInputValue('message').trim();
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (args[0] === 'stcatname') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const { renameStatsCategory } = require('./stats');
        await renameStatsCategory(guild, name);
        return interaction.update(statsView(guild));
      }

      if (args[0] === 'tvname') {
        const template = interaction.fields.getTextInputValue('template').trim();
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.nameTemplate = template;
        });
        return interaction.update(tempvocView(guild));
      }

      if (args[0] === 'tvchan') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({
            content: '❌ ID invalide. Colle un ID de salon vocal ou son lien.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isVoiceBased()) {
          return interaction.reply({
            content: `❌ Aucun salon **vocal** trouvé sur ce serveur avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.generatorChannel = channel.id;
          s.modules.tempvoc = true;
        });
        const { applyGeneratorPermissions } = require('./tempvoc');
        await applyGeneratorPermissions(guild);
        return interaction.update(tempvocView(guild));
      }

      if (args[0] === 'arwlid') {
        const ids = [...new Set(String(interaction.fields.getTextInputValue('ids')).match(/\d{15,20}/g) ?? [])];
        updateSettings(guild.id, (s) => {
          s.antiraidConfig.whitelist = ids;
        });
        return interaction.update(antiraidView(guild));
      }

      if (args[0] === 'arlimits') {
        const parse = (value) => {
          const match = String(value)
            .trim()
            .match(/^(\d{1,3})\s*\/\s*(\d{1,4})$/);
          if (!match) return null;
          const max = parseInt(match[1], 10);
          const seconds = parseInt(match[2], 10);
          if (max < 2 || max > 100 || seconds < 5 || seconds > 3600) return null;
          return { max, seconds };
        };
        const values = {
          antichannel: parse(interaction.fields.getTextInputValue('antichannel')),
          antirole: parse(interaction.fields.getTextInputValue('antirole')),
          antiban: parse(interaction.fields.getTextInputValue('antiban')),
          massjoin: parse(interaction.fields.getTextInputValue('massjoin')),
        };
        if (Object.values(values).some((v) => !v)) {
          return interaction.reply({
            content: '❌ Format invalide. Exemple : `3/30` (3 actions max en 30 secondes). Max 2-100, secondes 5-3600.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          for (const [key, value] of Object.entries(values)) {
            s.antiraidConfig[key].max = value.max;
            s.antiraidConfig[key].seconds = value.seconds;
          }
        });
        return interaction.update(antiraidView(guild));
      }

      if (args[0] === 'verifroleid') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        const role = id && guild.roles.cache.get(id);
        if (!role) {
          return interaction.reply({
            content: `❌ Aucun rôle trouvé sur ce serveur avec cet ID.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (role.managed || role.position >= guild.members.me.roles.highest.position) {
          return interaction.reply({
            content: '❌ Je ne peux pas attribuer ce rôle (intégration ou au-dessus de mon rôle).',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.verifConfig.role = role.id;
          s.modules.verification = true;
        });
        return interaction.update(verificationView(guild));
      }

      if (args[0] === 'gvroleid') {
        const raw = interaction.fields.getTextInputValue('id').trim();
        const id = raw ? extractId(raw) : null;
        if (raw && (!id || !guild.roles.cache.has(id))) {
          return interaction.reply({
            content: '❌ Aucun rôle trouvé sur ce serveur avec cet ID.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.giveawaysConfig.requiredRole = id ?? null;
          s.modules.giveaways = true;
        });
        return interaction.update(giveawaysView(guild));
      }

      if (args[0] === 'tvrolesid') {
        const access = parseRoleIds(guild, interaction.fields.getTextInputValue('access'));
        const adminRaw = interaction.fields.getTextInputValue('admin').trim();
        const adminId = adminRaw ? extractId(adminRaw) : null;
        if (adminRaw && (!adminId || !guild.roles.cache.has(adminId))) {
          return interaction.reply({
            content: '❌ Le rôle admin est introuvable sur ce serveur.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.accessRoles = access;
          s.tempvocConfig.adminRole = adminId ?? null;
        });
        const { applyGeneratorPermissions } = require('./tempvoc');
        await applyGeneratorPermissions(guild);
        return interaction.update(tempvocView(guild));
      }

      if (args[0] === 'strolesid') {
        const toCreate = parseRoleIds(guild, interaction.fields.getTextInputValue('create'));
        const view = parseRoleIds(guild, interaction.fields.getTextInputValue('view'));
        updateSettings(guild.id, (s) => {
          s.statsConfig.accessRoles = view;
        });
        const { createCounter, applyStatsPermissions } = require('./stats');
        const existing = new Set(
          getSettings(guild.id)
            .statsConfig.counters.map((c) => c.roleId)
            .filter(Boolean),
        );
        for (const roleId of toCreate) {
          if (!existing.has(roleId)) await createCounter(guild, { type: 'role', roleId });
        }
        await applyStatsPermissions(guild);
        return interaction.update(statsView(guild));
      }

      if (args[0] === 'ccrolesid') {
        const commandId = args[1];
        const roles = parseRoleIds(guild, interaction.fields.getTextInputValue('roles'));
        updateSettings(guild.id, (s) => {
          const c = s.customCommands.find((cc) => cc.id === commandId);
          if (c) c.allowedRoles = roles;
        });
        return interaction.update(customEditView(guild, commandId));
      }

      if (args[0] === 'tkreqroleid') {
        const raw = interaction.fields.getTextInputValue('id').trim();
        const id = raw ? extractId(raw) : null;
        if (raw && (!id || !guild.roles.cache.has(id))) {
          return interaction.reply({
            content: '❌ Aucun rôle trouvé sur ce serveur avec cet ID.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.requiredRole = id ?? null;
        });
        return interaction.update(ticketsView(guild));
      }

      if (args[0] === 'tkcatid') {
        const typeId = args[1];
        const id = extractId(interaction.fields.getTextInputValue('id'));
        const category = id && (await guild.channels.fetch(id).catch(() => null));
        if (!category || category.type !== ChannelType.GuildCategory) {
          return interaction.reply({
            content:
              "❌ Aucune **catégorie** trouvée sur ce serveur avec cet ID (attention : il faut l'ID de la catégorie, pas d'un salon).",
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          const type = s.ticketsConfig.types.find((t) => t.id === typeId);
          if (type) type.categoryId = category.id;
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (args[0] === 'tkrolesid') {
        const typeId = args[1];
        const mentions = parseRoleIds(guild, interaction.fields.getTextInputValue('mentions'));
        const access = parseRoleIds(guild, interaction.fields.getTextInputValue('access'));
        updateSettings(guild.id, (s) => {
          const type = s.ticketsConfig.types.find((t) => t.id === typeId);
          if (type) {
            type.mentionRoles = mentions;
            type.accessRoles = access;
          }
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (args[0] === 'verifmsg') {
        const template = interaction.fields.getTextInputValue('template').trim();
        updateSettings(guild.id, (s) => {
          s.verifConfig.message = template;
        });
        return interaction.update(verificationView(guild));
      }

      if (args[0] === 'verifchan') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({
            content: '❌ ID invalide. Colle un ID de salon, une mention `<#…>` ou un lien de salon.',
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
          return interaction.reply({
            content: `❌ Aucun salon textuel trouvé sur ce serveur avec l'ID \`${id}\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.verifConfig.channel = channel.id;
          s.modules.verification = true;
        });
        return interaction.update(verificationView(guild));
      }
      break;
    }

    case 'am': {
      const sub = args[0];

      if (sub === 'toggle') {
        const key = args[1];
        updateSettings(guild.id, (s) => {
          s.automodConfig[key].enabled = !s.automodConfig[key].enabled;
          if (s.automodConfig[key].enabled) s.modules.automod = true; // on active une protection → le module s'active
        });
        return interaction.update(automodView(guild));
      }

      if (sub === 'linkmode') {
        updateSettings(guild.id, (s) => {
          s.automodConfig.antilink.mode = s.automodConfig.antilink.mode === 'all' ? 'invites' : 'all';
        });
        return interaction.update(automodView(guild));
      }

      if (sub === 'sanction') {
        const cycle = { none: 'warn', warn: 'mute', mute: 'none' };
        updateSettings(guild.id, (s) => {
          s.automodConfig.sanction = cycle[s.automodConfig.sanction];
        });
        return interaction.update(automodView(guild));
      }

      if (sub === 'spamcfg') {
        const am = getSettings(guild.id).automodConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:amspam')
          .setTitle("Seuil de l'antispam")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('messages')
                .setLabel('Nombre de messages (2 à 20)')
                .setValue(`${am.antispam.messages}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('seconds')
                .setLabel('Fenêtre en secondes (2 à 60)')
                .setValue(`${am.antispam.seconds}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'mentioncfg') {
        const am = getSettings(guild.id).automodConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:ammention')
          .setTitle("Seuil de l'antimention")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('max')
                .setLabel('Mentions max par message (2 à 30)')
                .setValue(`${am.antimention.max}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'wordscfg') {
        const am = getSettings(guild.id).automodConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:amwords')
          .setTitle('Liste des mots interdits')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('words')
                .setLabel('Mots séparés par des virgules')
                .setValue(am.badwords.words.join(', ').slice(0, 4000))
                .setPlaceholder('mot1, mot2, mot3')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(4000),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'wordsview') {
        const { words } = getSettings(guild.id).automodConfig.badwords;
        return interaction.reply({
          content: words.length
            ? `🤬 **${words.length} mot(s) interdit(s) :**\n${words.join(', ').slice(0, 1900)}`
            : 'La liste des mots interdits est vide. Utilise 📝 pour en ajouter ou 📥 pour charger la liste par défaut.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'wordsdefault') {
        const defaultWords = require('./badwords-default');
        updateSettings(guild.id, (s) => {
          s.automodConfig.badwords.words = [...new Set([...s.automodConfig.badwords.words, ...defaultWords])].slice(
            0,
            300,
          );
          s.automodConfig.badwords.enabled = true;
          s.modules.automod = true;
        });
        return interaction.update(automodView(guild));
      }

      if (sub === 'muteduration') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:ammute')
          .setTitle('Durée du mute automod')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Durée (ex: 10m, 1h)')
                .setValue(getSettings(guild.id).automodConfig.muteDuration)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'tk': {
      const sub = args[0];

      if (sub === 'panelchannel') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.panelChannel = interaction.values[0];
          s.modules.tickets = true; // on configure → le module s'active
        });
        return interaction.update(ticketsView(guild));
      }

      if (sub === 'reqrole') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.requiredRole = interaction.values[0] ?? null;
        });
        return interaction.update(ticketsView(guild));
      }

      if (sub === 'type') {
        let typeId = interaction.values[0];
        if (typeId === '__new') {
          typeId = `t${Date.now().toString(36)}`;
          updateSettings(guild.id, (s) => {
            s.ticketsConfig.types.push({
              id: typeId,
              emoji: '🎫',
              label: 'Nouveau type',
              description: '',
              categoryId: null,
              mentionRoles: [],
              accessRoles: [],
              openMessage: '',
            });
            s.modules.tickets = true;
          });
        }
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (sub === 'settings') return interaction.update(ticketSettingsView(guild));

      if (sub === 'fbchan') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.feedbackChannel = interaction.values[0];
          s.modules.tickets = true; // on configure → le module s'active
        });
        return interaction.update(ticketReviewsView(guild));
      }

      if (sub === 'rvchan') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.reviewChannel = interaction.values[0] ?? null;
        });
        return interaction.update(ticketReviewsView(guild));
      }

      if (sub === 'fbrole') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.reviewRole = interaction.values[0] ?? null;
        });
        return interaction.update(ticketReviewsView(guild));
      }

      if (sub === 'fboff') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.feedbackChannel = null;
        });
        return interaction.update(ticketReviewsView(guild));
      }

      if (sub === 'fbchanid' || sub === 'rvchanid') {
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:tk${sub}`)
          .setTitle(sub === 'fbchanid' ? 'Salon des avis publiés' : 'Salon staff de validation')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel(
                  sub === 'fbchanid'
                    ? 'ID, mention <#…> ou lien du salon'
                    : 'ID ou lien (vide = validation en MP au owner)',
                )
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(sub === 'fbchanid')
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'fbroleid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tkfbroleid')
          .setTitle('Rôle donné au client')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID ou mention du rôle (vide = aucun)')
                .setValue(getSettings(guild.id).ticketsConfig.reviewRole ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'closeonleave') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.closeOnLeave = !s.ticketsConfig.closeOnLeave;
        });
        return interaction.update(ticketSettingsView(guild));
      }

      if (sub === 'transcriptdm') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.transcriptDM = !s.ticketsConfig.transcriptDM;
        });
        return interaction.update(ticketSettingsView(guild));
      }

      if (sub === 'autoclose') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tkautoclose')
          .setTitle('Fermeture des tickets inactifs')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('days')
                .setLabel("Jours d'inactivité (0 = désactivé, 2 à 60)")
                .setValue(`${getSettings(guild.id).ticketsConfig.autoCloseDays}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'maxper') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tkmax')
          .setTitle('Tickets max par personne')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('max')
                .setLabel('Nombre (1 à 10)')
                .setValue(`${getSettings(guild.id).ticketsConfig.maxPerUser}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'panelmsg') {
        const tc = getSettings(guild.id).ticketsConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tkpanel')
          .setTitle('Titre et message du panneau')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('title')
                .setLabel("Titre de l'embed (optionnel)")
                .setValue(tc.panelTitle ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(200),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('message')
                .setLabel("Message de l'embed")
                .setValue(tc.panelMessage.slice(0, 4000))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(4000),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'img') {
        const { requestImageUpload } = require('./customCommands');
        requestImageUpload(interaction, { kind: 'ticket' });
        return interaction.reply({
          content:
            "🖼️ **Envoie maintenant l'image du panneau dans ce salon** (en pièce jointe — stockée sur le serveur, elle n'expirera jamais).\nTu peux aussi coller une URL externe (imgur…), ou taper `supprimer` pour retirer l'image actuelle. ⏱️ 2 minutes.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'chanid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tkchanid')
          .setTitle('Salon du panneau de tickets')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID, mention <#…> ou lien du salon')
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'publish') {
        const tc = getSettings(guild.id).ticketsConfig;
        const channel = tc.panelChannel && guild.channels.cache.get(tc.panelChannel);
        if (!channel || tc.types.length === 0) {
          return interaction.reply({
            content: "❌ Configure d'abord le salon du panneau et au moins un type.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const sent = await channel.send(buildTicketPanel(guild, interaction.user)).catch(() => null);
        if (!sent) {
          return interaction.reply({
            content: `❌ Impossible de publier dans ${channel} (vérifie mes permissions).`,
            flags: MessageFlags.Ephemeral,
          });
        }
        // Supprime l'ancien panneau publié, puis mémorise le nouveau
        if (tc.lastPanelChannel && tc.lastPanelMessage) {
          const oldChannel = guild.channels.cache.get(tc.lastPanelChannel);
          await oldChannel?.messages.delete(tc.lastPanelMessage).catch(() => {});
        }
        updateSettings(guild.id, (s) => {
          s.modules.tickets = true;
          s.ticketsConfig.lastPanelChannel = channel.id;
          s.ticketsConfig.lastPanelMessage = sent.id;
        });
        await interaction.reply({
          content: `📤 Panneau de tickets publié dans ${channel}${tc.lastPanelMessage ? ' (ancien panneau supprimé)' : ''}.`,
          flags: MessageFlags.Ephemeral,
        });
        return interaction.message.edit(ticketsView(guild)).catch(() => {});
      }

      if (sub === 'reqroleid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tkreqroleid')
          .setTitle('Rôle requis pour ouvrir un ticket')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID ou mention du rôle (vide = tout le monde)')
                .setValue(getSettings(guild.id).ticketsConfig.requiredRole ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      // Sous-commandes liées à un type : cat / mention / access / label / openmsg / del / catid / rolesid / up / down
      const typeId = args[1];

      if (sub === 'up' || sub === 'down') {
        updateSettings(guild.id, (s) => {
          const types = s.ticketsConfig.types;
          const index = types.findIndex((t) => t.id === typeId);
          const target = sub === 'up' ? index - 1 : index + 1;
          if (index !== -1 && target >= 0 && target < types.length) {
            [types[index], types[target]] = [types[target], types[index]];
          }
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (sub === 'catid') {
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:tkcatid:${typeId}`)
          .setTitle('Catégorie des tickets de ce type')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID ou lien de la catégorie')
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'rolesid' && typeId) {
        const type = getSettings(guild.id).ticketsConfig.types.find((t) => t.id === typeId);
        if (!type) return interaction.update(ticketsView(guild));
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:tkrolesid:${typeId}`)
          .setTitle('Rôles du type (IDs ou mentions)')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('mentions')
                .setLabel('Rôles mentionnés (IDs séparés par espaces)')
                .setValue((type.mentionRoles ?? []).join(' '))
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(400),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('access')
                .setLabel('Rôles ayant accès (IDs séparés par espaces)')
                .setValue((type.accessRoles ?? []).join(' '))
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(400),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'cat') {
        updateSettings(guild.id, (s) => {
          const type = s.ticketsConfig.types.find((t) => t.id === typeId);
          if (type) type.categoryId = interaction.values[0];
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (sub === 'mention' || sub === 'access') {
        updateSettings(guild.id, (s) => {
          const type = s.ticketsConfig.types.find((t) => t.id === typeId);
          if (type) type[sub === 'mention' ? 'mentionRoles' : 'accessRoles'] = interaction.values;
        });
        return interaction.update(ticketTypeView(guild, typeId));
      }

      if (sub === 'del') {
        updateSettings(guild.id, (s) => {
          s.ticketsConfig.types = s.ticketsConfig.types.filter((t) => t.id !== typeId);
        });
        return interaction.update(ticketsView(guild));
      }

      if (sub === 'label') {
        const type = getSettings(guild.id).ticketsConfig.types.find((t) => t.id === typeId);
        if (!type) return interaction.update(ticketsView(guild));
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:tklabel:${typeId}`)
          .setTitle('Nom et description du type')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('emoji')
                .setLabel('Emoji (optionnel)')
                .setValue(type.emoji ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('label')
                .setLabel('Nom du type')
                .setValue(type.label)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('description')
                .setLabel('Description (affichée dans le sélecteur)')
                .setValue(type.description ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'openmsg') {
        const type = getSettings(guild.id).ticketsConfig.types.find((t) => t.id === typeId);
        if (!type) return interaction.update(ticketsView(guild));
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:tkopenmsg:${typeId}`)
          .setTitle("Message d'ouverture du ticket")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('message')
                .setLabel("Message envoyé à l'ouverture")
                .setValue(type.openMessage ?? '')
                .setPlaceholder('Merci de nous avoir contactés, précise ce que tu souhaites.')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(2000),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'cc': {
      const sub = args[0];

      if (sub === 'pick') {
        let commandId = interaction.values[0];
        if (commandId === '__new') {
          commandId = `c${Date.now().toString(36)}`;
          updateSettings(guild.id, (s) => {
            s.customCommands.push({
              id: commandId,
              prefix: '+',
              name: `commande${s.customCommands.length + 1}`,
              allowedRoles: [],
              deleteTrigger: true,
              response: { embed: true, title: '', content: '', image: null },
            });
            s.modules.custom = true; // on configure → le module s'active
          });
        }
        return interaction.update(customEditView(guild, commandId));
      }

      const commandId = args[1];
      const findCommand = (s) => s.customCommands.find((c) => c.id === commandId);

      if (sub === 'roles') {
        updateSettings(guild.id, (s) => {
          const c = findCommand(s);
          if (c) c.allowedRoles = interaction.values;
        });
        return interaction.update(customEditView(guild, commandId));
      }

      if (sub === 'deltrig') {
        updateSettings(guild.id, (s) => {
          const c = findCommand(s);
          if (c) c.deleteTrigger = !c.deleteTrigger;
        });
        return interaction.update(customEditView(guild, commandId));
      }

      if (sub === 'embed') {
        updateSettings(guild.id, (s) => {
          const c = findCommand(s);
          if (c) c.response.embed = !c.response.embed;
        });
        return interaction.update(customEditView(guild, commandId));
      }

      if (sub === 'del') {
        updateSettings(guild.id, (s) => {
          const command = s.customCommands.find((c) => c.id === commandId);
          if (command) {
            // Nettoie l'image stockée sur le disque avec la commande
            const { deleteStoredImage } = require('./customCommands');
            deleteStoredImage(command.response.image);
          }
          s.customCommands = s.customCommands.filter((c) => c.id !== commandId);
        });
        return interaction.update(customView(guild));
      }

      if (sub === 'name') {
        const command = getSettings(guild.id).customCommands.find((c) => c.id === commandId);
        if (!command) return interaction.update(customView(guild));
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:ccname:${commandId}`)
          .setTitle('Préfixe et nom de la commande')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('prefix')
                .setLabel('Préfixe : + ! . ? ou -')
                .setValue(command.prefix)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(1),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('name')
                .setLabel('Nom (sans espace, ex: regles)')
                .setValue(command.name)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(30),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'resp') {
        const command = getSettings(guild.id).customCommands.find((c) => c.id === commandId);
        if (!command) return interaction.update(customView(guild));
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:ccresp:${commandId}`)
          .setTitle('Réponse de la commande')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Titre (embed seulement, optionnel)')
                .setValue(command.response.title ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(200),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Message ({membre} {salon} {serveur}…)')
                .setValue(command.response.content ?? '')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(4000),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('mention')
                .setLabel('Mention au-dessus (ex: @everyone) — ping réel')
                .setValue(command.response.mention ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'rolesid') {
        const command = getSettings(guild.id).customCommands.find((c) => c.id === commandId);
        if (!command) return interaction.update(customView(guild));
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:ccrolesid:${commandId}`)
          .setTitle('Rôles autorisés (IDs ou mentions)')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('roles')
                .setLabel('IDs séparés par espaces (vide = tout le monde)')
                .setValue(command.allowedRoles.join(' '))
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(400),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'img') {
        const { requestImageUpload } = require('./customCommands');
        requestImageUpload(interaction, { kind: 'cc', commandId });
        return interaction.reply({
          content:
            "🖼️ **Envoie maintenant l'image dans ce salon** (en pièce jointe — je la stocke sur le serveur, elle n'expirera jamais).\nTu peux aussi coller une URL externe (imgur…), ou taper `supprimer` pour retirer l'image actuelle. ⏱️ 2 minutes.",
          flags: MessageFlags.Ephemeral,
        });
      }
      break;
    }

    case 'gv': {
      if (args[0] === 'reqrole') {
        updateSettings(guild.id, (s) => {
          s.giveawaysConfig.requiredRole = interaction.values[0] ?? null;
          s.modules.giveaways = true; // on configure → le module s'active
        });
        return interaction.update(giveawaysView(guild));
      }

      if (args[0] === 'roleid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:gvroleid')
          .setTitle('Rôle requis pour participer')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID ou mention du rôle (vide = tout le monde)')
                .setValue(getSettings(guild.id).giveawaysConfig.requiredRole ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'tv': {
      const sub = args[0];
      const { applyGeneratorPermissions } = require('./tempvoc');

      if (sub === 'generator') {
        await interaction.deferUpdate();
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.generatorChannel = interaction.values[0];
          s.modules.tempvoc = true; // on configure → le module s'active
        });
        await applyGeneratorPermissions(guild);
        return interaction.editReply(tempvocView(guild));
      }

      if (sub === 'roles') {
        await interaction.deferUpdate();
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.accessRoles = interaction.values;
        });
        await applyGeneratorPermissions(guild);
        return interaction.editReply(tempvocView(guild));
      }

      if (sub === 'adminrole') {
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.adminRole = interaction.values[0] ?? null;
        });
        return interaction.update(tempvocView(guild));
      }

      if (sub === 'create') {
        await interaction.deferUpdate();
        const channel = await guild.channels
          .create({
            name: '➕ Crée ton salon',
            type: ChannelType.GuildVoice,
          })
          .catch(() => null);
        if (!channel) {
          return interaction.followUp({
            content: '❌ Impossible de créer le salon générateur (vérifie mes permissions).',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.tempvocConfig.generatorChannel = channel.id;
          s.modules.tempvoc = true;
        });
        await applyGeneratorPermissions(guild);
        return interaction.editReply(tempvocView(guild));
      }

      if (sub === 'name') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tvname')
          .setTitle('Modèle de nom des salons')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('template')
                .setLabel('Nom (variable {pseudo})')
                .setValue(getSettings(guild.id).tempvocConfig.nameTemplate)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(90),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'byid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tvchan')
          .setTitle('Salon générateur')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID ou lien du salon vocal')
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'rolesid') {
        const tv = getSettings(guild.id).tempvocConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:tvrolesid')
          .setTitle('Rôles des vocaux (IDs ou mentions)')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('access')
                .setLabel("Rôles d'accès (IDs, vide = tout le monde)")
                .setValue((tv.accessRoles ?? []).join(' '))
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(400),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('admin')
                .setLabel('Rôle admin (ID, vide = aucun)')
                .setValue(tv.adminRole ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'st': {
      const sub = args[0];
      const { createCounter, removeCounter, updateCounters } = require('./stats');

      if (sub === 'members') {
        await interaction.deferUpdate();
        const counter = await createCounter(guild, { type: 'members' });
        if (!counter) {
          return interaction.followUp({
            content: '❌ Impossible de créer le salon compteur (vérifie mes permissions).',
            flags: MessageFlags.Ephemeral,
          });
        }
        return interaction.editReply(statsView(guild));
      }

      if (sub === 'addrole') {
        await interaction.deferUpdate();
        const existing = new Set(
          getSettings(guild.id)
            .statsConfig.counters.map((c) => c.roleId)
            .filter(Boolean),
        );
        let failed = 0;
        for (const roleId of interaction.values) {
          if (existing.has(roleId)) continue; // déjà un compteur pour ce rôle
          const counter = await createCounter(guild, { type: 'role', roleId });
          if (!counter) failed++;
        }
        if (failed) {
          await interaction.followUp({
            content: `❌ ${failed} compteur(s) n'ont pas pu être créés (vérifie mes permissions).`,
            flags: MessageFlags.Ephemeral,
          });
        }
        return interaction.editReply(statsView(guild));
      }

      if (sub === 'remove') {
        await interaction.deferUpdate();
        await removeCounter(guild, interaction.values[0]);
        return interaction.editReply(statsView(guild));
      }

      if (sub === 'refresh') {
        await interaction.deferUpdate();
        const { applyStatsPermissions } = require('./stats');
        await applyStatsPermissions(guild).catch(() => {}); // réapplique aussi les permissions
        await updateCounters(guild).catch(() => {});
        return interaction.editReply(statsView(guild));
      }

      if (sub === 'viewroles') {
        await interaction.deferUpdate();
        updateSettings(guild.id, (s) => {
          s.statsConfig.accessRoles = interaction.values;
        });
        const { applyStatsPermissions } = require('./stats');
        await applyStatsPermissions(guild);
        return interaction.editReply(statsView(guild));
      }

      if (sub === 'rolesid') {
        const st = getSettings(guild.id).statsConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:strolesid')
          .setTitle('Rôles des stats (IDs ou mentions)')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('create')
                .setLabel('Créer des compteurs pour ces rôles (IDs)')
                .setPlaceholder('123… 456… (vide = aucun nouveau compteur)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(400),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('view')
                .setLabel('Rôles voyant les compteurs (IDs, vide = tous)')
                .setValue((st.accessRoles ?? []).join(' '))
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(400),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'catname') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:stcatname')
          .setTitle('Nom de la catégorie de stats')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('name')
                .setLabel('Nom de la catégorie')
                .setValue(getSettings(guild.id).statsConfig.categoryName)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'ar': {
      const sub = args[0];

      if (sub === 'toggle') {
        const key = args[1];
        updateSettings(guild.id, (s) => {
          s.antiraidConfig[key].enabled = !s.antiraidConfig[key].enabled;
          if (s.antiraidConfig[key].enabled) s.modules.antiraid = true; // on active → le module s'active
        });
        return interaction.update(antiraidView(guild));
      }

      if (sub === 'sanction') {
        const cycle = { mute: 'ban24', ban24: 'ban', ban: 'mute' };
        updateSettings(guild.id, (s) => {
          s.antiraidConfig.sanction = cycle[s.antiraidConfig.sanction] ?? 'mute';
        });
        return interaction.update(antiraidView(guild));
      }

      if (sub === 'joinmode') {
        updateSettings(guild.id, (s) => {
          s.antiraidConfig.massjoin.mode = s.antiraidConfig.massjoin.mode === 'alert' ? 'kick' : 'alert';
        });
        return interaction.update(antiraidView(guild));
      }

      if (sub === 'whitelist') {
        updateSettings(guild.id, (s) => {
          s.antiraidConfig.whitelist = interaction.values;
        });
        return interaction.update(antiraidView(guild));
      }

      if (sub === 'wlid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:arwlid')
          .setTitle('Whitelist antiraid (IDs)')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('ids')
                .setLabel('IDs séparés par espaces (vide = personne)')
                .setValue(getSettings(guild.id).antiraidConfig.whitelist.join(' '))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(1000),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'limits') {
        const ar = getSettings(guild.id).antiraidConfig;
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:arlimits')
          .setTitle('Seuils antiraid (max/secondes)')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('antichannel')
                .setLabel('Salons : max/secondes')
                .setValue(`${ar.antichannel.max}/${ar.antichannel.seconds}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('antirole')
                .setLabel('Rôles : max/secondes')
                .setValue(`${ar.antirole.max}/${ar.antirole.seconds}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('antiban')
                .setLabel('Bans : max/secondes')
                .setValue(`${ar.antiban.max}/${ar.antiban.seconds}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('massjoin')
                .setLabel('Arrivées : max/secondes')
                .setValue(`${ar.massjoin.max}/${ar.massjoin.seconds}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(10),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'verif': {
      const sub = args[0];

      if (sub === 'channel') {
        updateSettings(guild.id, (s) => {
          s.verifConfig.channel = interaction.values[0];
          s.modules.verification = true; // on configure → le module s'active
        });
        return interaction.update(verificationView(guild));
      }

      if (sub === 'role') {
        const role = interaction.roles.first();
        if (!role || role.managed || role.position >= guild.members.me.roles.highest.position) {
          return interaction.reply({
            content:
              '❌ Je ne peux pas attribuer ce rôle : il est géré par une intégration ou au-dessus de mon rôle. Choisis-en un autre ou monte mon rôle.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => {
          s.verifConfig.role = role.id;
          s.modules.verification = true;
        });
        return interaction.update(verificationView(guild));
      }

      if (sub === 'publish') {
        const vc = getSettings(guild.id).verifConfig;
        const channel = vc.channel && guild.channels.cache.get(vc.channel);
        if (!channel || !vc.role) {
          return interaction.reply({
            content: "❌ Configure d'abord le salon et le rôle.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const sent = await channel.send(buildVerifyPanel(guild, interaction.user)).catch(() => null);
        if (!sent) {
          return interaction.reply({
            content: `❌ Impossible de publier dans ${channel} (vérifie mes permissions).`,
            flags: MessageFlags.Ephemeral,
          });
        }
        // Supprime l'ancien panneau publié, puis mémorise le nouveau
        if (vc.lastPanelChannel && vc.lastPanelMessage) {
          const oldChannel = guild.channels.cache.get(vc.lastPanelChannel);
          await oldChannel?.messages.delete(vc.lastPanelMessage).catch(() => {});
        }
        updateSettings(guild.id, (s) => {
          s.modules.verification = true;
          s.verifConfig.lastPanelChannel = channel.id;
          s.verifConfig.lastPanelMessage = sent.id;
        });
        await interaction.reply({
          content: `📤 Panneau de vérification publié dans ${channel}${vc.lastPanelMessage ? ' (ancien panneau supprimé)' : ''}.`,
          flags: MessageFlags.Ephemeral,
        });
        return interaction.message.edit(verificationView(guild)).catch(() => {});
      }

      if (sub === 'msg') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:verifmsg')
          .setTitle('Message du panneau de vérification')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('template')
                .setLabel('Variable : {serveur} — règles bienvenues !')
                .setValue(getSettings(guild.id).verifConfig.message)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(4000),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'chanid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:verifchan')
          .setTitle('Salon de vérification')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID, mention <#…> ou lien du salon')
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }

      if (sub === 'roleid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:verifroleid')
          .setTitle('Rôle donné à la vérification')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID ou mention du rôle')
                .setValue(getSettings(guild.id).verifConfig.role ?? '')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }

    case 'logs': {
      const sub = args[0];

      if (sub === 'type') return interaction.update(logTypeView(guild, interaction.values[0]));

      if (sub === 'auto') {
        await interaction.deferUpdate();
        await autoConfigureLogs(guild);
        return interaction.editReply(logsView(guild));
      }

      if (sub === 'channel') {
        const type = args[1];
        updateSettings(guild.id, (s) => {
          s.logsChannels[type] = interaction.values[0];
          s.modules.logs = true;
        });
        return interaction.update(logTypeView(guild, type));
      }

      if (sub === 'create') {
        const type = args[1];
        await interaction.deferUpdate();
        await createLogChannel(guild, type);
        updateSettings(guild.id, (s) => {
          s.modules.logs = true;
        });
        return interaction.editReply(logTypeView(guild, type));
      }

      if (sub === 'off') {
        const type = args[1];
        updateSettings(guild.id, (s) => {
          delete s.logsChannels[type];
        });
        return interaction.update(logTypeView(guild, type));
      }

      if (sub === 'byid') {
        const type = args[1];
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:logchannel:${type}`)
          .setTitle(`Salon des logs ${LOG_TYPES[type].label}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('id')
                .setLabel('ID, mention <#…> ou lien du salon')
                .setPlaceholder('1234567890123456789')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100),
            ),
          );
        return interaction.showModal(modal);
      }
      break;
    }
  }
}

module.exports = { hubView, customView, customEditView, ticketsView, handleSetupComponent, watchPanel };
