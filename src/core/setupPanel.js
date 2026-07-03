const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder, ChannelType, EmbedBuilder,
} = require('discord.js');
const { MODULES, getSettings, updateSettings } = require('./settings');
const { LOG_TYPES, autoConfigureLogs, createLogChannel } = require('./logs');

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

// ── Page d'accueil ────────────────────────────────────────────────────────────

function hubView(guild) {
  const settings = getSettings(guild.id);
  const enabledCount = Object.keys(MODULES).filter((k) => settings.modules[k]).length;
  const logsCount = Object.keys(LOG_TYPES).filter((t) => {
    return settings.logsChannels[t] && guild.channels.cache.get(settings.logsChannels[t]);
  }).length;

  const embed = panelEmbed(guild, `🛠️ Setup de ${guild.name}`, [
    'Bienvenue dans le panneau de configuration !',
    '',
    `🧩 **Modules** — ${enabledCount}/${Object.keys(MODULES).length} activés`,
    `📜 **Salons de logs** — ${logsCount}/${Object.keys(LOG_TYPES).length} configurés`,
    '',
    'Choisis une section dans le menu, ou clique sur **⚡ Setup rapide** pour tout configurer d\'un coup avec les réglages recommandés.',
  ].join('\n'));

  const nav = new StringSelectMenuBuilder()
    .setCustomId('setup:nav')
    .setPlaceholder('📂 Choisis une section à configurer…')
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('modules').setLabel('Modules').setEmoji('🧩')
        .setDescription('Activer ou désactiver les fonctionnalités du bot'),
      new StringSelectMenuOptionBuilder().setValue('logs').setLabel('Salons de logs').setEmoji('📜')
        .setDescription('Choisir ou créer un salon pour chaque type de log'),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:quick').setLabel('⚡ Setup rapide').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup:done').setLabel('✅ Terminer').setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(nav), buttons] };
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
    `• Clique sur **➕ Créer** pour créer \`#${meta.channelName}\` dans la catégorie 📜 Logs`,
  ].join('\n'));

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:logs:channel:${type}`)
    .setPlaceholder('🔍 Choisir un salon existant…')
    .setChannelTypes(ChannelType.GuildText);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:logs:create:${type}`).setLabel('➕ Créer le salon').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:logs:off:${type}`).setLabel('🔴 Désactiver ce log').setStyle(ButtonStyle.Danger)
      .setDisabled(!settings.logsChannels[type]),
    backButton('logs'),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(channelSelect), buttons] };
}

// ── Routeur des interactions du panneau (customId = "setup:...") ────────────

async function handleSetupComponent(interaction) {
  const [, action, ...args] = interaction.customId.split(':');
  const guild = interaction.guild;

  switch (action) {
    case 'nav': {
      const page = interaction.values[0];
      return interaction.update(page === 'modules' ? modulesView(guild) : logsView(guild));
    }

    case 'goto': {
      const target = args[0];
      if (target === 'logs') return interaction.update(logsView(guild));
      return interaction.update(hubView(guild));
    }

    case 'quick': {
      await interaction.deferUpdate();
      updateSettings(guild.id, (s) => {
        s.modules.moderation = true;
        s.modules.utility = true;
        s.modules.logs = true;
      });
      await autoConfigureLogs(guild);
      return interaction.editReply(hubView(guild));
    }

    case 'done': {
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
      break;
    }
  }
}

module.exports = { hubView, handleSetupComponent };
