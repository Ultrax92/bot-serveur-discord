const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('./db');
const { getSettings, isModuleEnabled } = require('./settings');
const { isBotAdmin } = require('./permissions');

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

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: newState.channel.parentId ?? null,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers],
        },
      ],
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

// Au démarrage : supprime les salons temporaires vides ou disparus
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

module.exports = { handleVoiceState, handleTempvocComponent, cleanupTempvoc };
