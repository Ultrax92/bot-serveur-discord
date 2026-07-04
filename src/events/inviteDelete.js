const { onInviteDelete } = require('../core/invites');

module.exports = {
  name: 'inviteDelete',
  execute(invite) {
    onInviteDelete(invite);
  },
};
