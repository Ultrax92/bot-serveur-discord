const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const db = require('./db');
const { getSettings, updateSettings, isModuleEnabled } = require('./settings');
const { parseDuration, formatDuration } = require('./utils');

// Messages programmés récurrents : le bot publie un embed dans un salon à
// intervalle régulier (annonce hebdo, rappel feedback…). Panneau /schedule.

const listStmt = db.prepare('SELECT * FROM scheduled_messages WHERE guild_id = ? ORDER BY id');
const getStmt = db.prepare('SELECT * FROM scheduled_messages WHERE id = ? AND guild_id = ?');
const insertStmt = db.prepare(`
  INSERT INTO scheduled_messages (guild_id, name, title, message, mention, interval_ms, next_run, enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
`);
const updateContentStmt = db.prepare(
  'UPDATE scheduled_messages SET name = ?, title = ?, message = ?, mention = ?, interval_ms = ?, next_run = ? WHERE id = ?',
);
const setChannelStmt = db.prepare('UPDATE scheduled_messages SET channel_id = ?, enabled = 1 WHERE id = ?');
const setEnabledStmt = db.prepare('UPDATE scheduled_messages SET enabled = ? WHERE id = ?');
const setNextRunStmt = db.prepare('UPDATE scheduled_messages SET next_run = ? WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ?');
const dueStmt = db.prepare('SELECT * FROM scheduled_messages WHERE enabled = 1 AND next_run <= ?');

// '@everyone', '@here' ou un rôle (id/mention) → contenu de ping hors embed
function mentionContent(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '@everyone' || trimmed === '@here') return trimmed;
  const id = trimmed.match(/\d{15,20}/)?.[0];
  return id ? `<@&${id}>` : null;
}

// 'JJ/MM/AAAA HH:MM', 'JJ/MM HH:MM' ou 'HH:MM' (passé = demain) → timestamp futur
function parseFrDateTime(input) {
  const match = String(input)
    .trim()
    .match(/^(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+)?(\d{1,2})[h:](\d{2})$/i);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  const now = new Date();
  const date = new Date(now);
  date.setSeconds(0, 0);
  date.setHours(Number(hours), Number(minutes));
  if (day) {
    date.setFullYear(year ? (Number(year) < 100 ? 2000 + Number(year) : Number(year)) : now.getFullYear());
    date.setMonth(Number(month) - 1, Number(day));
  } else if (date <= now) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime() > Date.now() ? date.getTime() : null;
}

// ── Envoi ─────────────────────────────────────────────────────────────────────

async function sendScheduledMessage(client, row) {
  const guild = client.guilds.cache.get(row.guild_id);
  const channel = row.channel_id && guild?.channels.cache.get(row.channel_id);
  if (!channel) return false;
  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setDescription(row.message.slice(0, 4000))
    .setTimestamp();
  if (row.title) embed.setTitle(row.title.slice(0, 256));
  const content = mentionContent(row.mention);
  return channel
    .send({ ...(content ? { content } : {}), embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

function startSchedulerWorker(client) {
  setInterval(async () => {
    for (const row of dueStmt.all(Date.now())) {
      if (!isModuleEnabled(row.guild_id, 'scheduler')) continue;
      const ok = await sendScheduledMessage(client, row).catch(() => false);
      if (!ok) {
        setEnabledStmt.run(0, row.id);
        console.error(
          `[scheduler] Message programmé #${row.id} (${row.name}) désactivé : salon introuvable ou envoi refusé.`,
        );
        continue;
      }
      // Rattrapage sans spam : si le bot était éteint plusieurs cycles, un seul envoi
      let next = row.next_run + row.interval_ms;
      if (next <= Date.now()) next = Date.now() + row.interval_ms;
      setNextRunStmt.run(next, row.id);
    }
  }, 60_000);
}

// ── Panneau /schedule ─────────────────────────────────────────────────────────

function schedulePanel(guild) {
  const rows = listStmt.all(guild.id);
  const list = rows.length
    ? rows
        .map(
          (r) =>
            `\`#${r.id}\` ${r.enabled ? '🟢' : '🔴'} **${r.name}** → ${r.channel_id ? `<#${r.channel_id}>` : '⚠️ *pas de salon*'} · toutes les ${formatDuration(r.interval_ms)} · prochain <t:${Math.floor(r.next_run / 1000)}:R>`,
        )
        .join('\n')
    : '*Aucun message programmé — crée le premier dans le menu ci-dessous.*';

  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle('⏰ Messages programmés')
    .setDescription(
      [
        "Le bot publie un **embed récurrent** dans le salon de ton choix (annonce hebdo, rappel feedback…). Mention `@everyone`/`@here`/rôle possible au-dessus de l'embed.",
        `${getSettings(guild.id).modules.scheduler ? '🟢 Module activé' : "🔴 Module désactivé — il s'activera à la création d'un message"}`,
        '',
        `**Messages (${rows.length}) :**`,
        list,
      ].join('\n'),
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('sch:pick')
    .setPlaceholder('⏰ Gérer un message programmé…')
    .addOptions([
      ...rows.slice(0, 24).map((r) =>
        new StringSelectMenuOptionBuilder()
          .setValue(`${r.id}`)
          .setLabel(`#${r.id} — ${r.name}`.slice(0, 100))
          .setDescription(`toutes les ${formatDuration(r.interval_ms)}`.slice(0, 100)),
      ),
      new StringSelectMenuOptionBuilder()
        .setValue('__new')
        .setLabel('➕ Créer un nouveau message programmé')
        .setDescription('Nom, message, intervalle, mention'),
    ]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sch:home').setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), buttons] };
}

function scheduleEditView(guild, id) {
  const row = getStmt.get(id, guild.id);
  if (!row) return schedulePanel(guild);
  const channel = row.channel_id && guild.channels.cache.get(row.channel_id);

  const embed = new EmbedBuilder()
    .setColor(getSettings(guild.id).color)
    .setTitle(`⏰ Message programmé #${row.id} — ${row.name}`)
    .setDescription(
      [
        `${row.enabled ? '🟢 **Actif**' : '🔴 **En pause**'} — ${channel ? `dans ${channel}` : "⚠️ **choisis un salon** ci-dessous pour l'activer"}`,
        `🔁 **Intervalle :** toutes les ${formatDuration(row.interval_ms)} — ⏭️ **prochain envoi :** <t:${Math.floor(row.next_run / 1000)}:f> (<t:${Math.floor(row.next_run / 1000)}:R>)`,
        `📣 **Mention :** ${mentionContent(row.mention) ?? '*aucune*'}`,
        '',
        `**Aperçu :**${row.title ? `\n> **${row.title}**` : ''}`,
        `> ${row.message.slice(0, 800).replace(/\n/g, '\n> ')}`,
      ].join('\n'),
    );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`sch:chan:${row.id}`)
    .setPlaceholder('📢 Salon où publier ce message…')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (channel) channelSelect.setDefaultChannels([channel.id]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sch:content:${row.id}`)
      .setLabel('✏️ Contenu & intervalle')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sch:next:${row.id}`).setLabel('⏭️ Prochain envoi').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`sch:send:${row.id}`)
      .setLabel('📤 Envoyer maintenant')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!channel),
    new ButtonBuilder()
      .setCustomId(`sch:toggle:${row.id}`)
      .setLabel(row.enabled ? '🔴 Mettre en pause' : '🟢 Activer')
      .setStyle(row.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!channel),
    new ButtonBuilder().setCustomId('sch:home').setLabel('◀️ Retour').setStyle(ButtonStyle.Secondary),
  );

  const extraButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sch:chanid:${row.id}`)
      .setLabel('🆔 Salon par ID ou lien')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sch:del:${row.id}`).setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(channelSelect), extraButtons, buttons],
  };
}

function contentModal(row) {
  return new ModalBuilder()
    .setCustomId(`sch:mcontent:${row?.id ?? 'new'}`)
    .setTitle(row ? `Modifier ${row.name}`.slice(0, 45) : 'Nouveau message programmé')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Nom (affiché dans le panneau)')
          .setValue(row?.name ?? '')
          .setPlaceholder('Rappel feedback hebdo')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(60),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel("Titre de l'embed (optionnel)")
          .setValue(row?.title ?? '')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel("Message de l'embed")
          .setValue(row?.message ?? '')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('interval')
          .setLabel('Intervalle (ex: 7j, 24h, 1h — min 10m)')
          .setValue(row ? formatDuration(row.interval_ms) : '7j')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mention')
          .setLabel('Mention (@everyone, @here ou ID de rôle)')
          .setValue(row?.mention ?? '')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100),
      ),
    );
}

// ── Interactions (customId "sch:...") ─────────────────────────────────────────

async function handleScheduleComponent(interaction) {
  const guild = interaction.guild;
  const [, action, arg] = interaction.customId.split(':');

  if (action === 'home') return interaction.update(schedulePanel(guild));

  if (action === 'pick') {
    if (interaction.values[0] === '__new') return interaction.showModal(contentModal(null));
    return interaction.update(scheduleEditView(guild, interaction.values[0]));
  }

  if (action === 'content') {
    const row = getStmt.get(arg, guild.id);
    if (!row) return interaction.update(schedulePanel(guild));
    return interaction.showModal(contentModal(row));
  }

  if (action === 'mcontent') {
    const intervalMs = parseDuration(interaction.fields.getTextInputValue('interval').trim());
    if (!intervalMs || intervalMs < 10 * 60_000) {
      return interaction.reply({
        content: '❌ Intervalle invalide : `10m` minimum (ex: `7j`, `24h`, `1h`).',
        flags: MessageFlags.Ephemeral,
      });
    }
    const name = interaction.fields.getTextInputValue('name').trim();
    const title = interaction.fields.getTextInputValue('title').trim() || null;
    const message = interaction.fields.getTextInputValue('message').trim();
    const mention = interaction.fields.getTextInputValue('mention').trim() || null;

    if (arg === 'new') {
      const info = insertStmt.run(
        guild.id,
        name,
        title,
        message,
        mention,
        intervalMs,
        Date.now() + intervalMs,
        Date.now(),
      );
      return interaction.isFromMessage()
        ? interaction.update(scheduleEditView(guild, info.lastInsertRowid))
        : interaction.reply({ ...scheduleEditView(guild, info.lastInsertRowid), flags: MessageFlags.Ephemeral });
    }
    const row = getStmt.get(arg, guild.id);
    if (!row) return interaction.update(schedulePanel(guild));
    // L'intervalle change → le prochain envoi est recalculé ; sinon il est conservé
    const nextRun = row.interval_ms === intervalMs ? row.next_run : Date.now() + intervalMs;
    updateContentStmt.run(name, title, message, mention, intervalMs, nextRun, row.id);
    return interaction.update(scheduleEditView(guild, row.id));
  }

  if (action === 'chan') {
    setChannelStmt.run(interaction.values[0], arg);
    updateSettings(guild.id, (s) => {
      s.modules.scheduler = true; // on configure → le module s'active
    });
    return interaction.update(scheduleEditView(guild, arg));
  }

  if (action === 'chanid') {
    const modal = new ModalBuilder()
      .setCustomId(`sch:mchanid:${arg}`)
      .setTitle('Salon du message programmé')
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

  if (action === 'mchanid') {
    const id = interaction.fields
      .getTextInputValue('id')
      .match(/\d{15,20}/g)
      ?.pop();
    const channel = id && (await guild.channels.fetch(id).catch(() => null));
    if (!channel || !channel.isTextBased() || channel.isThread() || channel.isVoiceBased()) {
      return interaction.reply({
        content: `❌ Aucun salon textuel trouvé sur ce serveur avec cet ID.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    setChannelStmt.run(channel.id, arg);
    updateSettings(guild.id, (s) => {
      s.modules.scheduler = true;
    });
    return interaction.update(scheduleEditView(guild, arg));
  }

  if (action === 'next') {
    const modal = new ModalBuilder()
      .setCustomId(`sch:mnext:${arg}`)
      .setTitle('Date du prochain envoi')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('when')
            .setLabel('JJ/MM/AAAA HH:MM ou HH:MM (passé = demain)')
            .setPlaceholder('12/07/2026 18:00')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20),
        ),
      );
    return interaction.showModal(modal);
  }

  if (action === 'mnext') {
    const when = parseFrDateTime(interaction.fields.getTextInputValue('when'));
    if (!when) {
      return interaction.reply({
        content: '❌ Date invalide ou passée. Formats : `12/07/2026 18:00`, `12/07 18:00` ou `18:00`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    setNextRunStmt.run(when, arg);
    return interaction.update(scheduleEditView(guild, arg));
  }

  if (action === 'toggle') {
    const row = getStmt.get(arg, guild.id);
    if (!row) return interaction.update(schedulePanel(guild));
    setEnabledStmt.run(row.enabled ? 0 : 1, row.id);
    return interaction.update(scheduleEditView(guild, arg));
  }

  if (action === 'send') {
    const row = getStmt.get(arg, guild.id);
    if (!row) return interaction.update(schedulePanel(guild));
    const ok = await sendScheduledMessage(interaction.client, row);
    await interaction.update(scheduleEditView(guild, arg));
    return interaction.followUp({
      content: ok
        ? `📤 Message envoyé dans <#${row.channel_id}> (test — le planning n'est pas modifié).`
        : '❌ Envoi impossible (salon introuvable ou permissions manquantes).',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === 'del') {
    deleteStmt.run(arg, guild.id);
    return interaction.update(schedulePanel(guild));
  }
}

module.exports = { schedulePanel, handleScheduleComponent, startSchedulerWorker };
