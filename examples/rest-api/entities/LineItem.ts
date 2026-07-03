import { defineEntity } from '@quoin/core'

export default defineEntity({
  description: 'A single product within an order',
  goal: 'Record what was ordered and at what price',
  fields: {
    id:        { type: 'uuid',    primaryKey: true },
    orderId:   { type: 'uuid',    foreignKey: 'Order.id' },
    productId: { type: 'uuid',    foreignKey: 'Product.id' },
    quantity:  { type: 'integer', description: 'Number of units ordered' },
    unitPrice: { type: 'decimal', description: 'Price per unit at time of order' },
    subtotal:  { type: 'decimal', description: 'quantity × unitPrice' },
  },
  relations: {
    order: { name: 'order', kind: 'belongsTo', target: 'Order', foreignKey: 'orderId' },
  },
})
