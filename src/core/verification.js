const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getSettings, isModuleEnabled } = require('./settings');
const { sendLog, userAuthor, idLine } = require('./logs');

// Le panneau publié dans le salon de vérification (bouton persistant : il
// survit aux redémarrages du bot car identifié par son customId)
function buildVerifyPanel(guild) {
  const settings = getSettings(guild.id);
  const embed = new EmbedBuilder()
    .setColor(settings.color)
    .setTitle('✅ Vérification')
    .setDescription(settings.verifConfig.message.replaceAll('{serveur}', guild.name));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:go').setLabel('Se vérifier').setEmoji('✅').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

// Clic d'un membre sur le bouton de vérification
async function handleVerifyButton(interaction) {
  const guild = interaction.guild;

  if (!isModuleEnabled(guild.id, 'verification')) {
    return interaction.reply({ content: 'La vérification est désactivée sur ce serveur.', flags: MessageFlags.Ephemeral });
  }

  const { role: roleId } = getSettings(guild.id).verifConfig;
  const role = roleId && guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({ content: '⚠️ La vérification est mal configurée (rôle introuvable). Préviens un admin.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.member.roles.cache.has(role.id)) {
    return interaction.reply({ content: 'Tu es déjà vérifié. ✅', flags: MessageFlags.Ephemeral });
  }
  if (role.managed || role.position >= guild.members.me.roles.highest.position) {
    return interaction.reply({ content: '⚠️ Je ne peux pas attribuer le rôle de vérification (hiérarchie). Préviens un admin.', flags: MessageFlags.Ephemeral });
  }

  await interaction.member.roles.add(role, 'Vérification');

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor(userAuthor(interaction.user))
    .setDescription([
      `✅ **S'est vérifié** — rôle ${role} attribué`,
      idLine(interaction.user),
      `**Compte créé** <t:${Math.floor(interaction.user.createdTimestamp / 1000)}:R>`,
    ].join('\n'))
    .setTimestamp();
  await sendLog(guild, 'verif', embed);

  return interaction.reply({ content: `✅ Tu es vérifié, bienvenue sur **${guild.name}** !`, flags: MessageFlags.Ephemeral });
}

module.exports = { buildVerifyPanel, handleVerifyButton };
