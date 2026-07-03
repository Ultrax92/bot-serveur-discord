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
    .setDescription('Gère les rôles d\'un membre')
    .addSubcommand((sub) =>
      sub.setName('add')
        .setDescription('Ajoute un rôle à un membre')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
        .addRoleOption((opt) => opt.setName('rôle').setDescription('Le rôle à ajouter').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('remove')
        .setDescription('Retire un rôle à un membre')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
        .addRoleOption((opt) => opt.setName('rôle').setDescription('Le rôle à retirer').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('derank')
        .setDescription('Retire tous les rôles d\'un membre')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à derank').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('membre');

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed(interaction, 'Membre introuvable sur ce serveur.')], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'derank') {
      const hierarchyError = checkHierarchy(interaction, member);
      if (hierarchyError) {
        return interaction.reply({ embeds: [errorEmbed(interaction, hierarchyError)], flags: MessageFlags.Ephemeral });
      }
      const removable = member.roles.cache.filter((r) =>
        r.id !== interaction.guild.roles.everyone.id && !r.managed && r.position < interaction.guild.members.me.roles.highest.position);
      await member.roles.remove(removable, `Derank par ${interaction.user.tag}`);
      return interaction.reply({ embeds: [successEmbed(interaction, `**${member.user.tag}** a perdu **${removable.size}** rôle(s).`)] });
    }

    const role = interaction.options.getRole('rôle');
    const roleError = checkRoleManageable(interaction, role);
    if (roleError) {
      return interaction.reply({ embeds: [errorEmbed(interaction, roleError)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'add') {
      await member.roles.add(role, `Rôle ajouté par ${interaction.user.tag}`);
      return interaction.reply({ embeds: [successEmbed(interaction, `Le rôle ${role} a été ajouté à **${member.user.tag}**.`)] });
    }
    if (sub === 'remove') {
      await member.roles.remove(role, `Rôle retiré par ${interaction.user.tag}`);
      return interaction.reply({ embeds: [successEmbed(interaction, `Le rôle ${role} a été retiré à **${member.user.tag}**.`)] });
    }
  },
};
