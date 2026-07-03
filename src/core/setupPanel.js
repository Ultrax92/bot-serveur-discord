const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { MODULES, getSettings, updateSettings } = require('./settings');
const { LOG_TYPES, autoConfigureLogs, createLogChannel } = require('./logs');
const { buildVerifyPanel } = require('./verification');
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

// Extrait un ID Discord d'une saisie libre : ID brut, mention <#id>/<@id>, ou lien de salon
function extractId(input) {
  const match = input.match(/\d{15,20}/);
  return match ? match[0] : null;
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
  activePanels.set(message.id, setTimeout(() => {
    activePanels.delete(message.id);
    message.edit(expiredView()).catch(() => {});
  }, PANEL_TIMEOUT_MS));
}

function releasePanel(messageId) {
  clearTimeout(activePanels.get(messageId));
  activePanels.delete(messageId);
}

// ── Page d'accueil ────────────────────────────────────────────────────────────

function hubView(guild) {
  const settings = getSettings(guild.id);
  const enabledCount = Object.keys(MODULES).filter((k) => settings.modules[k]).length;
  const logsCount = Object.keys(LOG_TYPES).filter((t) =>
    settings.logsChannels[t] && guild.channels.cache.get(settings.logsChannels[t])).length;

  const embed = panelEmbed(guild, `🛠️ Setup de ${guild.name}`, [
    'Bienvenue dans le panneau de configuration ! Chaque section montre les réglages actuels et permet de les modifier.',
    '',
    `⚙️ **Général** — couleur des embeds : ${colorHex(settings)}`,
    `👑 **Admins du bot** — ${settings.admins.length} admin(s)`,
    `🧩 **Modules** — ${enabledCount}/${Object.keys(MODULES).length} activés`,
    `🔨 **Modération** — MP sanction ${settings.moderationConfig.dmOnSanction ? '🟢' : '🔴'} | ${settings.moderationConfig.defaultMuteDuration}`,
    `📜 **Salons de logs** — ${logsCount}/${Object.keys(LOG_TYPES).length} configurés`,
    `✅ **Vérification** — salon ${settings.verifConfig.channel ? '🟢' : '🔴'} | rôle ${settings.verifConfig.role ? '🟢' : '🔴'}`,
    '',
    'Choisis une section dans le menu pour voir et modifier ses réglages.',
  ].join('\n'));

  const nav = new StringSelectMenuBuilder()
    .setCustomId('setup:nav')
    .setPlaceholder('📂 Choisis une section à configurer…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('general').setLabel('Général').setEmoji('⚙️')
        .setDescription('Couleur des embeds du bot'),
      new StringSelectMenuOptionBuilder().setValue('admins').setLabel('Admins du bot').setEmoji('👑')
        .setDescription('Qui a accès aux commandes du bot'),
      new StringSelectMenuOptionBuilder().setValue('modules').setLabel('Modules').setEmoji('🧩')
        .setDescription('Activer ou désactiver les fonctionnalités'),
      new StringSelectMenuOptionBuilder().setValue('moderation').setLabel('Modération').setEmoji('🔨')
        .setDescription('MP aux sanctionnés, durée de mute par défaut'),
      new StringSelectMenuOptionBuilder().setValue('logs').setLabel('Salons de logs').setEmoji('📜')
        .setDescription('Un salon existant ou créé pour chaque type de log'),
      new StringSelectMenuOptionBuilder().setValue('verification').setLabel('Vérification').setEmoji('✅')
        .setDescription('Bouton de vérification qui donne un rôle'),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:done').setLabel('✅ Terminer').setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(nav), buttons] };
}

// ── Page générale ─────────────────────────────────────────────────────────────

function generalView(guild) {
  const settings = getSettings(guild.id);
  const embed = panelEmbed(guild, '⚙️ Général', [
    `🎨 **Couleur des embeds :** ${colorHex(settings)} (c'est la couleur de ce panneau)`,
  ].join('\n'));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:color').setLabel('🎨 Changer la couleur').setStyle(ButtonStyle.Primary),
    backButton('home'),
  );
  return { embeds: [embed], components: [buttons] };
}

// ── Page admins ───────────────────────────────────────────────────────────────

function adminsView(guild) {
  const settings = getSettings(guild.id);
  const list = settings.admins.length ? settings.admins.map((id) => `• <@${id}>`).join('\n') : '*Aucun admin ajouté.*';

  const embed = panelEmbed(guild, '👑 Admins du bot', [
    'Les admins ont accès à **toutes les commandes** du bot. Le owner (toi) l\'est toujours, sans apparaître ici.',
    '',
    list,
    '',
    '👇 Sélectionne dans le menu **l\'ensemble des admins** : ajoute ou retire des personnes, la sélection remplace la liste.',
    'Introuvable dans le menu ? Utilise **🆔 Ajouter/retirer par ID**.',
  ].join('\n'));

  const select = new UserSelectMenuBuilder()
    .setCustomId('setup:admins')
    .setPlaceholder('👑 Sélectionne les admins du bot…')
    .setMinValues(0)
    .setMaxValues(25);
  if (settings.admins.length) select.setDefaultUsers(settings.admins.slice(0, 25));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:admins:byid').setLabel('🆔 Ajouter/retirer par ID').setStyle(ButtonStyle.Primary),
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
  const lines = Object.entries(MODULES).map(([key, m]) =>
    `${settings.modules[key] ? '🟢' : '🔴'} ${m.emoji} **${m.label}** — ${m.description}`);

  const embed = panelEmbed(guild, '🧩 Modules', [
    'Sélectionne dans le menu **tous les modules que tu veux activer** (les non-sélectionnés seront désactivés), puis valide.',
    '',
    lines.join('\n'),
  ].join('\n'));

  const select = new StringSelectMenuBuilder()
    .setCustomId('setup:modules')
    .setPlaceholder('🧩 Sélectionne les modules à activer…')
    .setMinValues(0)
    .setMaxValues(Object.keys(MODULES).length)
    .addOptions(Object.entries(MODULES).map(([key, m]) =>
      new StringSelectMenuOptionBuilder()
        .setValue(key)
        .setLabel(m.label)
        .setEmoji(m.emoji)
        .setDescription(m.description.slice(0, 100))
        .setDefault(settings.modules[key] === true)));

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
  const { dmOnSanction, defaultMuteDuration } = settings.moderationConfig;

  const embed = panelEmbed(guild, '🔨 Réglages de modération', [
    `${dmOnSanction ? '🟢' : '🔴'} **MP au membre sanctionné** — le bot prévient en privé lors d'un warn/mute/kick/ban`,
    `⏱️ **Durée de mute par défaut** — \`${defaultMuteDuration}\` quand /mute est utilisé sans durée`,
  ].join('\n'));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:mod:dm')
      .setLabel(dmOnSanction ? '🔴 Désactiver le MP sanction' : '🟢 Activer le MP sanction')
      .setStyle(dmOnSanction ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('setup:mod:muteduration').setLabel('⏱️ Durée de mute par défaut').setStyle(ButtonStyle.Primary),
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

  const embed = panelEmbed(guild, '📜 Salons de logs', [
    'Choisis un type de log dans le menu pour lui attribuer un salon (existant ou créé pour l\'occasion).',
    '',
    lines.join('\n'),
  ].join('\n'));

  const select = new StringSelectMenuBuilder()
    .setCustomId('setup:logs:type')
    .setPlaceholder('📜 Choisis un type de log à configurer…')
    .addOptions(Object.entries(LOG_TYPES).map(([type, meta]) =>
      new StringSelectMenuOptionBuilder().setValue(type).setLabel(meta.label).setEmoji(meta.emoji)));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:logs:auto').setLabel('⚡ Créer tous les salons manquants').setStyle(ButtonStyle.Primary),
    backButton('home'),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), buttons] };
}

// ── Page d'un type de log ─────────────────────────────────────────────────────

function logTypeView(guild, type) {
  const meta = LOG_TYPES[type];
  const settings = getSettings(guild.id);
  const channel = settings.logsChannels[type] && guild.channels.cache.get(settings.logsChannels[type]);

  const embed = panelEmbed(guild, `${meta.emoji} Logs ${meta.label}`, [
    `**Salon actuel :** ${channel ? `${channel}` : '🔴 non configuré'}`,
    '',
    '• Sélectionne un **salon existant** dans le menu ci-dessous, ou',
    `• Clique sur **➕ Créer** pour créer \`#${meta.channelName}\` dans la catégorie 📜 Logs, ou`,
    '• Clique sur **🆔 Par ID** pour coller un ID, une mention `<#…>` ou un lien de salon',
  ].join('\n'));

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:logs:channel:${type}`)
    .setPlaceholder('🔍 Choisir un salon existant…')
    .setChannelTypes(ChannelType.GuildText);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:logs:create:${type}`).setLabel('➕ Créer le salon').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:logs:byid:${type}`).setLabel('🆔 Par ID').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:logs:off:${type}`).setLabel('🔴 Désactiver ce log').setStyle(ButtonStyle.Danger)
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

  const embed = panelEmbed(guild, '✅ Vérification', [
    `${settings.modules.verification ? '🟢 Module activé' : '🔴 Module désactivé — active-le dans 🧩 Modules pour que le bouton fonctionne'}`,
    '',
    `📢 **Salon du panneau** — ${channel ? `${channel}` : '🔴 non configuré'}`,
    `🎭 **Rôle donné à la vérification** — ${role ? `${role}` : '🔴 non configuré'}`,
    `📝 **Message du panneau** (variable \`{serveur}\`, jusqu'à 4000 caractères — mets-y tes règles !) :`,
    `> ${vc.message.length > 300 ? `${vc.message.slice(0, 300)}…` : vc.message}`,
    '',
    'Une fois salon + rôle choisis, clique sur **📤 Publier le panneau** : le bot poste l\'embed avec le bouton **✅ Vérification** dans le salon.',
    '💡 *Astuce : cache les autres salons au rôle @everyone et rends-les visibles au rôle vérifié.*',
  ].join('\n'));

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
    new ButtonBuilder().setCustomId('setup:verif:publish').setLabel('📤 Publier le panneau').setStyle(ButtonStyle.Success)
      .setDisabled(!channel || !role),
    new ButtonBuilder().setCustomId('setup:verif:msg').setLabel('📝 Message').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:verif:chanid').setLabel('🆔 Salon par ID').setStyle(ButtonStyle.Primary),
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

const PAGES = {
  home: hubView,
  general: generalView,
  admins: adminsView,
  modules: modulesView,
  moderation: moderationView,
  logs: logsView,
  verification: verificationView,
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
      const embed = panelEmbed(guild, '✅ Setup terminé', 'Relance `/setup` à tout moment pour modifier la configuration.\nUtilise `/help` pour voir les commandes disponibles.');
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
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('id')
              .setLabel('ID du membre (ajout si absent, retrait sinon)')
              .setPlaceholder('1234567890123456789')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(30),
          ));
        return interaction.showModal(modal);
      }
      const ids = [...interaction.users.filter((u) => !u.bot).keys()];
      updateSettings(guild.id, (s) => { s.admins = ids; });
      return interaction.update(adminsView(guild));
    }

    case 'color': {
      const modal = new ModalBuilder()
        .setCustomId('setup:modal:color')
        .setTitle('Couleur des embeds')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('hex')
            .setLabel('Couleur au format hexadécimal')
            .setPlaceholder('#5865F2')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(7),
        ));
      return interaction.showModal(modal);
    }

    case 'mod': {
      if (args[0] === 'dm') {
        updateSettings(guild.id, (s) => { s.moderationConfig.dmOnSanction = !s.moderationConfig.dmOnSanction; });
        return interaction.update(moderationView(guild));
      }
      if (args[0] === 'muteduration') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:muteduration')
          .setTitle('Durée de mute par défaut')
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('duration')
              .setLabel('Durée (ex: 30m, 1h, 2j)')
              .setPlaceholder('1h')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(10),
          ));
        return interaction.showModal(modal);
      }
      break;
    }

    case 'modal': {
      if (args[0] === 'color') {
        const hex = interaction.fields.getTextInputValue('hex').replace(/^#/, '');
        if (!/^[0-9a-f]{6}$/i.test(hex)) {
          return interaction.reply({ content: '❌ Format invalide. Exemple attendu : `#5865F2`', flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => { s.color = parseInt(hex, 16); });
        return interaction.update(generalView(guild));
      }
      if (args[0] === 'muteduration') {
        const input = interaction.fields.getTextInputValue('duration').trim();
        const duration = parseDuration(input);
        if (!duration) {
          return interaction.reply({ content: '❌ Durée invalide. Exemples : `30m`, `1h`, `2j`.', flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => { s.moderationConfig.defaultMuteDuration = formatDuration(duration).replaceAll(' ', ''); });
        return interaction.update(moderationView(guild));
      }

      if (args[0] === 'admin') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({ content: '❌ ID invalide. Colle un ID Discord (Mode développeur → clic droit → Copier l\'identifiant).', flags: MessageFlags.Ephemeral });
        }
        const settings = getSettings(guild.id);
        if (settings.admins.includes(id)) {
          updateSettings(guild.id, (s) => { s.admins = s.admins.filter((a) => a !== id); });
          return interaction.update(adminsView(guild));
        }
        const user = await interaction.client.users.fetch(id).catch(() => null);
        if (!user) {
          return interaction.reply({ content: `❌ Aucun utilisateur Discord trouvé avec l'ID \`${id}\`.`, flags: MessageFlags.Ephemeral });
        }
        if (user.bot) {
          return interaction.reply({ content: '❌ Un bot ne peut pas être admin.', flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => { s.admins.push(id); });
        return interaction.update(adminsView(guild));
      }

      if (args[0] === 'logchannel') {
        const type = args[1];
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({ content: '❌ ID invalide. Colle un ID de salon, une mention `<#…>` ou un lien de salon.', flags: MessageFlags.Ephemeral });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
          return interaction.reply({ content: `❌ Aucun salon textuel trouvé sur ce serveur avec l'ID \`${id}\`.`, flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => {
          s.logsChannels[type] = channel.id;
          s.modules.logs = true;
        });
        return interaction.update(logTypeView(guild, type));
      }

      if (args[0] === 'verifmsg') {
        const template = interaction.fields.getTextInputValue('template').trim();
        updateSettings(guild.id, (s) => { s.verifConfig.message = template; });
        return interaction.update(verificationView(guild));
      }

      if (args[0] === 'verifchan') {
        const id = extractId(interaction.fields.getTextInputValue('id'));
        if (!id) {
          return interaction.reply({ content: '❌ ID invalide. Colle un ID de salon, une mention `<#…>` ou un lien de salon.', flags: MessageFlags.Ephemeral });
        }
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
          return interaction.reply({ content: `❌ Aucun salon textuel trouvé sur ce serveur avec l'ID \`${id}\`.`, flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => { s.verifConfig.channel = channel.id; });
        return interaction.update(verificationView(guild));
      }
      break;
    }

    case 'verif': {
      const sub = args[0];

      if (sub === 'channel') {
        updateSettings(guild.id, (s) => { s.verifConfig.channel = interaction.values[0]; });
        return interaction.update(verificationView(guild));
      }

      if (sub === 'role') {
        const role = interaction.roles.first();
        if (!role || role.managed || role.position >= guild.members.me.roles.highest.position) {
          return interaction.reply({
            content: '❌ Je ne peux pas attribuer ce rôle : il est géré par une intégration ou au-dessus de mon rôle. Choisis-en un autre ou monte mon rôle.',
            flags: MessageFlags.Ephemeral,
          });
        }
        updateSettings(guild.id, (s) => { s.verifConfig.role = role.id; });
        return interaction.update(verificationView(guild));
      }

      if (sub === 'publish') {
        const vc = getSettings(guild.id).verifConfig;
        const channel = vc.channel && guild.channels.cache.get(vc.channel);
        if (!channel || !vc.role) {
          return interaction.reply({ content: '❌ Configure d\'abord le salon et le rôle.', flags: MessageFlags.Ephemeral });
        }
        const sent = await channel.send(buildVerifyPanel(guild, interaction.user)).catch(() => null);
        if (!sent) {
          return interaction.reply({ content: `❌ Impossible de publier dans ${channel} (vérifie mes permissions).`, flags: MessageFlags.Ephemeral });
        }
        updateSettings(guild.id, (s) => { s.modules.verification = true; });
        await interaction.reply({ content: `📤 Panneau de vérification publié dans ${channel} (module ✅ activé au passage).`, flags: MessageFlags.Ephemeral });
        return interaction.message.edit(verificationView(guild)).catch(() => {});
      }

      if (sub === 'msg') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:verifmsg')
          .setTitle('Message du panneau de vérification')
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('template')
              .setLabel('Variable : {serveur} — règles bienvenues !')
              .setValue(getSettings(guild.id).verifConfig.message)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(4000),
          ));
        return interaction.showModal(modal);
      }

      if (sub === 'chanid') {
        const modal = new ModalBuilder()
          .setCustomId('setup:modal:verifchan')
          .setTitle('Salon de vérification')
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('id')
              .setLabel('ID, mention <#…> ou lien du salon')
              .setPlaceholder('1234567890123456789')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(100),
          ));
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
        updateSettings(guild.id, (s) => { s.modules.logs = true; });
        return interaction.editReply(logTypeView(guild, type));
      }

      if (sub === 'off') {
        const type = args[1];
        updateSettings(guild.id, (s) => { delete s.logsChannels[type]; });
        return interaction.update(logTypeView(guild, type));
      }

      if (sub === 'byid') {
        const type = args[1];
        const modal = new ModalBuilder()
          .setCustomId(`setup:modal:logchannel:${type}`)
          .setTitle(`Salon des logs ${LOG_TYPES[type].label}`)
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('id')
              .setLabel('ID, mention <#…> ou lien du salon')
              .setPlaceholder('1234567890123456789')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(100),
          ));
        return interaction.showModal(modal);
      }
      break;
    }
  }
}

module.exports = { hubView, handleSetupComponent, watchPanel };
