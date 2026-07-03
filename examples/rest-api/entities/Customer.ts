import { defineEntity } from '@quoin/core'

export default defineEntity({
  description: 'A registered customer',
  goal: 'Track customer identity and contact details',
  fields: {
    id:              { type: 'uuid',   primaryKey: true },
    email:           { type: 'email',  pii: true, gdpr: { category: 'contact', retention: '7y', legalBasis: 'contract' }, description: 'Primary contact email' },
    name:            { type: 'string', pii: true, gdpr: { category: 'identity' }, description: 'Full legal name' },
    createdAt:       { type: 'timestamp' },
    shippingAddress: { type: 'string', nullable: true, description: 'Default shipping address' },
  },
  relations: {
    orders: { name: 'orders', kind: 'hasMany', target: 'Order', foreignKey: 'customerId' },
  },
})
