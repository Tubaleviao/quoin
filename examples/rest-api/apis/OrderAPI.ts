import { defineApi } from '@quoin/core'

export default defineApi({
  endpoints: {
    'POST /orders':          { behavior: 'Order.placeOrder',      description: 'Place a new order' },
    'POST /orders/:id/pay':  { behavior: 'Order.confirmPayment',  description: 'Confirm payment for an order' },
    'DELETE /orders/:id':    { behavior: 'Order.cancel',          description: 'Cancel an order' },
    'GET /orders/:id':       { returns: 'Order',                  description: 'Get order details',                      auth: { roles: ['customer', 'admin'] } },
    'GET /orders':           { returns: 'Order',                  description: 'List orders for authenticated customer', auth: { roles: ['customer', 'admin'] } },
  },
})
