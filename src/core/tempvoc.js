const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('./db');
const { getSettings, isModuleEnabled } = require('./settings');
const { isBotAdmin } = require('./permissions');

// Droits du rôle "admin" des vocaux temporaires (relevés de la config ChannelManager
// de l'utilisateur) : quasi tout, SAUF gérer le salon/permissions/webhooks et les
// commandes d'application. Les flags absents de la version de discord.js sont ignorés.
const P = PermissionFlagsBits;
const ADMIN_ALLOW = [
  P.ViewChannel, P.CreateInstantInvite, P.Connect, P.Speak, P.Stream,
  P.UseSoundboard, P.UseExternalSounds, P.UseVAD, P.PrioritySpeaker,
  P.MuteMembers, P.DeafenMembers, P.MoveMembers,
  P.SendMessages, P.EmbedLinks, P.AttachFiles, P.AddReactions,
  P.UseExternalEmojis, P.UseExternalStickers, P.MentionEveryone,
  P.ManageMessages, P.ReadMessageHistory, P.SendTTSMessages, P.SendVoiceMessages,
  P.SendPolls, P.CreateEvents, P.ManageEvents, P.UseEmbeddedActivities,
].filter(Boolean);
const ADMIN_DENY = [
  P.ManageChannels, P.ManageRoles, P.ManageWebhooks,
  P.UseApplicationCommands, P.UseExternalApps,
].filter(Boolean);

// Droits des rôles d'accès (ex: membres) sur les vocaux créés, relevés de la
// config ChannelManager : voix et chat basiques, rien de plus.
const MEMBER_ALLOW = [
  P.ViewChannel, P.CreateInstantInvite, P.Connect, P.Speak, P.Stream,
  P.UseVAD, P.PrioritySpeaker,
  P.SendMessages, P.AddReactions, P.ReadMessageHistory,
].filter(Boolean);
const MEMBER_DENY = [
  P.ManageChannels, P.ManageRoles, P.ManageWebhooks,
  P.UseSoundboard, P.UseExternalSounds,
  P.MuteMembers, P.DeafenMembers, P.MoveMembers,
  P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis, P.UseExternalStickers,
  P.MentionEveryone, P.ManageMessages, P.SendTTSMessages, P.SendVoiceMessages,
  P.SendPolls, P.CreateEvents, P.ManageEvents,
  P.UseApplicationCommands, P.UseEmbeddedActivities, P.UseExternalApps,
].filter(Boolean);

// @everyone : TOUT refusé explicitement quand des rôles d'accès sont configurés
// (un deny partiel laisserait des permissions en héritage, exploitables par les
// clients modifiés type Vencord qui affichent les salons cachés)
const EVERYONE_DENY_ALL = [...new Set([
  ...MEMBER_ALLOW, ...MEMBER_DENY,
  P.PinMessages, P.BypassSlowmode, P.SetVoiceChannelStatus, P.RequestToSpeak,
  P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads, P.ManageThreads,
].filter(Boolean))];

// Rôles d'accès : le nécessaire en vert, TOUT le reste explicitement en rouge
const MEMBER_DENY_COMPLETE = EVERYONE_DENY_ALL.filter((p) => !MEMBER_ALLOW.includes(p));

const insertStmt = db.prepare('INSERT OR REPLACE INTO tempvoc_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)');
const byChannelStmt = db.prepare('SELECT * FROM tempvoc_channels WHERE channel_id = ?');
const deleteStmt = db.prepare('DELETE FROM tempvoc_channels WHERE channel_id = ?');
const allStmt = db.prepare('SELECT * FROM tempvoc_channels');

function controlPanel(member) {
  const embed = new EmbedBuilder()
    .setColor(getSettings(member.guild.id).color)
    .setTitle('🔊 Ton salon vocal')
    .setDescription([
      `Ce salon t'appartient, ${member} ! Il sera **supprimé dès qu'il sera vide**.`,
      '',
      '✏️ **Renommer** · 🔒 **Verrouiller/ouvrir** · 👥 **Limite de places**',
      '*(Discord limite les renommages à 2 par 10 minutes)*',
    ].join('\n'));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tv:rename').setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tv:lock').setLabel('Verrouiller / Ouvrir').setEmoji('🔒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tv:limit').setLabel('Limite').setEmoji('👥').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [buttons] };
}

// Verrouille le salon générateur : chat/parole/stream bloqués pour tous (c'est un
// salon de passage), et visibilité restreinte aux rôles d'accès s'il y en a
async function applyGeneratorPermissions(guild) {
  const config = getSettings(guild.id).tempvocConfig;
  const channel = config.generatorChannel && guild.channels.cache.get(config.generatorChannel);
  if (!channel) return false;

  const accessRoles = (config.accessRoles ?? []).filter((id) => guild.roles.cache.has(id));
  const everyoneDeny = accessRoles.length
    ? EVERYONE_DENY_ALL // tout refusé explicitement, les rôles d'accès ré-autorisent le minimum
    : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream];

  const ok = await channel.permissionOverwrites.set([
    { id: guild.roles.everyone.id, deny: everyoneDeny },
    ...accessRoles.map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    })),
  ], 'Configuration des vocaux temporaires').then(() => true).catch(() => false);
  return ok;
}

// Création à la connexion au générateur + suppression des salons vides
async function handleVoiceState(oldState, newState) {
  const guild = newState.guild ?? oldState.guild;
  if (!guild || !isModuleEnabled(guild.id, 'tempvoc')) return;
  const config = getSettings(guild.id).tempvocConfig;

  // Connexion au salon générateur → création du salon perso
  if (newState.channelId && newState.channelId === config.generatorChannel
    && newState.member && !newState.member.user.bot) {
    const member = newState.member;
    const name = config.nameTemplate
      .replaceAll('{pseudo}', member.displayName ?? member.user.username)
      .slice(0, 100);

    // Les salons créés héritent de la visibilité restreinte du générateur
    const accessRoles = (config.accessRoles ?? []).filter((id) => guild.roles.cache.has(id));
    const overwrites = [
      {
        id: member.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers],
      },
    ];
    if (accessRoles.length) {
      overwrites.push(
        { id: guild.roles.everyone.id, deny: EVERYONE_DENY_ALL },
        ...accessRoles.map((id) => ({ id, allow: MEMBER_ALLOW, deny: MEMBER_DENY_COMPLETE })),
      );
    } else {
      // Pas de restriction de visibilité : droits basiques pour tous, le reste en rouge
      overwrites.push({ id: guild.roles.everyone.id, allow: MEMBER_ALLOW, deny: MEMBER_DENY_COMPLETE });
    }

    // Rôle "admin" des vocaux : droits étendus sur chaque salon créé
    if (config.adminRole && guild.roles.cache.has(config.adminRole)) {
      overwrites.push({ id: config.adminRole, allow: ADMIN_ALLOW, deny: ADMIN_DENY });
    }

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: newState.channel.parentId ?? null,
      permissionOverwrites: overwrites,
    }).catch(() => null);
    if (!channel) return;

    insertStmt.run(channel.id, guild.id, member.id);
    await member.voice.setChannel(channel).catch(() => {});
    await channel.send({ content: `${member}`, ...controlPanel(member) }).catch(() => {});
  }

  // Un salon temporaire quitté et vide → suppression
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const row = byChannelStmt.get(oldState.channelId);
    if (!row) return;
    const channel = guild.channels.cache.get(oldState.channelId);
    if (!channel) {
      deleteStmt.run(oldState.channelId);
      return;
    }
    if (channel.members.filter((m) => !m.user.bot).size === 0) {
      await channel.delete('Salon vocal temporaire vide').catch(() => {});
      deleteStmt.run(oldState.channelId);
    }
  }
}

// Au démarrage : supprime les salons temporaires vides ou disparus, et
// réapplique le verrouillage du générateur (les mises à jour de permissions
// prennent ainsi effet à chaque redémarrage, sans manipulation)
async function cleanupTempvoc(client) {
  for (const row of allStmt.all()) {
    const guild = client.guilds.cache.get(row.guild_id);
    const channel = guild?.channels.cache.get(row.channel_id);
    if (!channel) {
      deleteStmt.run(row.channel_id);
      continue;
    }
    if (channel.members.filter((m) => !m.user.bot).size === 0) {
      await channel.delete('Salon vocal temporaire vide (nettoyage au démarrage)').catch(() => {});
      deleteStmt.run(row.channel_id);
    }
  }

  for (const guild of client.guilds.cache.values()) {
    if (isModuleEnabled(guild.id, 'tempvoc')) {
      await applyGeneratorPermissions(guild).catch(() => {});
    }
  }
}

// Boutons ✏️ 🔒 👥 et leurs formulaires (customId "tv:...")
async function handleTempvocComponent(interaction) {
  const row = byChannelStmt.get(interaction.channelId);
  if (!row) {
    return interaction.reply({ content: 'Ce salon n\'est pas (ou plus) un salon vocal temporaire.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== row.owner_id && !isBotAdmin(interaction)) {
    return interaction.reply({ content: `Seul <@${row.owner_id}> (le propriétaire du salon) peut le gérer.`, flags: MessageFlags.Ephemeral });
  }

  const [, action] = interaction.customId.split(':');
  const channel = interaction.guild.channels.cache.get(interaction.channelId);
  if (!channel) return;

  if (action === 'rename') {
    const modal = new ModalBuilder()
      .setCustomId('tv:modal:rename')
      .setTitle('Renommer ton salon')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Nouveau nom')
          .setValue(channel.name).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
      ));
    return interaction.showModal(modal);
  }

  if (action === 'limit') {
    const modal = new ModalBuilder()
      .setCustomId('tv:modal:limit')
      .setTitle('Limite de places')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('limit').setLabel('Nombre de places (0 = illimité, max 99)')
          .setValue(`${channel.userLimit}`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
      ));
    return interaction.showModal(modal);
  }

  if (action === 'lock') {
    const everyone = interaction.guild.roles.everyone;
    const current = channel.permissionOverwrites.cache.get(everyone.id);
    const locked = current?.deny.has(PermissionFlagsBits.Connect);
    await channel.permissionOverwrites.edit(everyone, { Connect: locked ? null : false });
    return interaction.reply({
      content: locked ? '🔓 Salon ouvert à tout le monde.' : '🔒 Salon verrouillé : seuls les membres déjà présents peuvent y entrer.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === 'modal') {
    const kind = interaction.customId.split(':')[2];
    if (kind === 'rename') {
      const name = interaction.fields.getTextInputValue('name').trim().slice(0, 100);
      await channel.setName(name).catch(() => {});
      return interaction.reply({ content: `✏️ Salon renommé en **${name}** (peut prendre quelques instants, limite Discord).`, flags: MessageFlags.Ephemeral });
    }
    if (kind === 'limit') {
      const limit = parseInt(interaction.fields.getTextInputValue('limit'), 10);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        return interaction.reply({ content: '❌ Valeur invalide : entre 0 (illimité) et 99.', flags: MessageFlags.Ephemeral });
      }
      await channel.setUserLimit(limit).catch(() => {});
      return interaction.reply({ content: limit ? `👥 Limite fixée à **${limit}** place(s).` : '👥 Limite retirée (places illimitées).', flags: MessageFlags.Ephemeral });
    }
  }
}

module.exports = { handleVoiceState, handleTempvocComponent, cleanupTempvoc, applyGeneratorPermissions };
