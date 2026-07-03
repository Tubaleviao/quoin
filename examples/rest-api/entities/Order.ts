import { defineEntity } from '@quoin/core'

export default defineEntity({
  description: 'A customer purchase request',
  goal: 'Track the full lifecycle of a purchase from placement to fulfillment',
  fields: {
    id:                 { type: 'uuid' ,    primaryKey: true },
    status:             { type: 'enum',     values: ['draft', 'placed', 'paid', 'shipped', 'delivered', 'cancelled'], description: 'Current lifecycle state of the order' },
    totalAmount:        { type: 'decimal',  description: 'Sum of all line item prices' },
    customerId:         { type: 'uuid',     foreignKey: 'Customer.id' },
    placedAt:           { type: 'timestamp', nullable: true },
    cancelledAt:        { type: 'timestamp', nullable: true },
    cancellationReason: { type: 'string',   nullable: true },
  },
  stateMachine: {
    field: 'status',
    initial: 'draft',
    states: {
      draft:     'Order created but not submitted',
      placed:    'Order submitted by customer',
      paid:      'Payment confirmed',
      shipped:   'Package handed to carrier',
      delivered: { description: 'Package received by customer', terminal: true },
      cancelled: { description: 'Order cancelled', terminal: true },
    },
    transitions: [
      { from: 'draft',            to: 'placed',    trigger: 'placeOrder',      guards: ['Order must have at least one line item', 'Customer must have a valid shipping address'], effect: 'Sets placedAt to current timestamp' },
      { from: 'placed',           to: 'paid',      trigger: 'confirmPayment',  guard: 'Payment amount must match order total', effect: 'Triggers inventory reservation' },
      { from: 'paid',             to: 'shipped',   trigger: 'ship' },
      { from: 'shipped',          to: 'delivered', trigger: 'deliver' },
      { from: ['draft', 'placed'], to: 'cancelled', trigger: 'cancel',         guard: 'Only the owning customer or an admin may cancel', effect: 'Sets cancelledAt and cancellationReason' },
    ],
  },
  behaviors: {
    placeOrder: {
      description: 'Submits a draft order for processing',
      rules: ['Order must have at least one line item', 'Customer must have a valid shipping address'],
      auth: { roles: ['customer', 'admin'] },
    },
    confirmPayment: {
      description: 'Records successful payment for an order',
      rules: ['Payment amount must match order total'],
      auth: { roles: ['payment-service'] },
    },
    cancel: {
      description: 'Cancels an order and records the reason',
      rules: ['Only the owning customer or an admin may cancel'],
      input: { reason: { type: 'string', description: 'Why the order was cancelled' } },
      auth: { roles: ['customer', 'admin'] },
    },
  },
  relations: {
    lineItems: { name: 'lineItems', kind: 'hasMany',    target: 'LineItem', foreignKey: 'orderId' },
    customer:  { name: 'customer',  kind: 'belongsTo',  target: 'Customer', foreignKey: 'customerId' },
  },
})
