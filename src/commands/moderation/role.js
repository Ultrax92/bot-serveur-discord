const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed, checkHierarchy } = require('../../core/utils');

function checkRoleManageable(interaction, role) {
  if (role.managed) return 'Ce rôle est géré par une intégration, il ne peut pas être attribué manuellement.';
  if (role.position >= interaction.guild.members.me.roles.highest.position)
    return 'Ce rôle est au-dessus de mon rôle le plus haut, je ne peux pas le gérer.';
  return null;
}

module.exports = {
  module: 'moderation',
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription("Gère les rôles d'un membre")
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription("L'action à effectuer")
        .setRequired(true)
        .addChoices(
          { name: '➕ Ajouter un rôle', value: 'add' },
          { name: '➖ Retirer un rôle', value: 'remove' },
          { name: '💥 Derank (retirer tous les rôles)', value: 'derank' },
        ),
    )
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre concerné').setRequired(true))
    .addRoleOption((opt) => opt.setName('rôle').setDescription('Le rôle (requis pour ajouter/retirer)')),

  async execute(interaction) {
    const action = interaction.options.getString('action');
    const member = interaction.options.getMember('membre');
    const role = interaction.options.getRole('rôle');

    if (!member) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Membre introuvable sur ce serveur.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'derank') {
      const hierarchyError = checkHierarchy(interaction, member);
      if (hierarchyError) {
        return interaction.reply({ embeds: [errorEmbed(interaction, hierarchyError)], flags: MessageFlags.Ephemeral });
      }
      const removable = member.roles.cache.filter(
        (r) =>
          r.id !== interaction.guild.roles.everyone.id &&
          !r.managed &&
          r.position < interaction.guild.members.me.roles.highest.position,
      );
      await member.roles.remove(removable, `Derank par ${interaction.user.tag}`);
      return interaction.reply({
        embeds: [successEmbed(interaction, `**${member.user.tag}** a perdu **${removable.size}** rôle(s).`)],
      });
    }

    if (!role) {
      return interaction.reply({
        embeds: [errorEmbed(interaction, 'Précise le rôle à ajouter ou retirer.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    const roleError = checkRoleManageable(interaction, role);
    if (roleError) {
      return interaction.reply({ embeds: [errorEmbed(interaction, roleError)], flags: MessageFlags.Ephemeral });
    }

    if (action === 'add') {
      await member.roles.add(role, `Rôle ajouté par ${interaction.user.tag}`);
      return interaction.reply({
        embeds: [successEmbed(interaction, `Le rôle ${role} a été ajouté à **${member.user.tag}**.`)],
      });
    }
    await member.roles.remove(role, `Rôle retiré par ${interaction.user.tag}`);
    return interaction.reply({
      embeds: [successEmbed(interaction, `Le rôle ${role} a été retiré à **${member.user.tag}**.`)],
    });
  },
};
