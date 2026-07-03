const { defineEntity } = require('@quoin/core')

module.exports = defineEntity({
  description: 'A registered library member',
  goal: 'Track member identity and borrowing eligibility',
  fields: {
    id:                  { type: 'uuid',   primaryKey: true },
    name:                { type: 'string', pii: true, gdpr: { category: 'identity' } },
    email:               { type: 'email',  pii: true, gdpr: { category: 'contact', retention: '3y', legalBasis: 'contract' } },
    status:              { type: 'enum',   values: ['active', 'suspended'] },
    membershipExpiresAt: { type: 'date' },
  },
  stateMachine: {
    field: 'status',
    initial: 'active',
    states: {
      active:    'Member can borrow and reserve books',
      suspended: 'Member cannot borrow until reinstated',
    },
    transitions: [
      { from: 'active',    to: 'suspended', trigger: 'suspend',   guard: 'Only a librarian may suspend a member' },
      { from: 'suspended', to: 'active',    trigger: 'reinstate', guard: 'Only a librarian may reinstate a member' },
    ],
  },
})
