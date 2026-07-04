const { onInviteCreate } = require('../core/invites');

module.exports = {
  name: 'inviteCreate',
  execute(invite) {
    onInviteCreate(invite);
  },
};
