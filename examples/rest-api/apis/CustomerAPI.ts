import { defineApi } from '@quoin/core'

export default defineApi({
  endpoints: {
    'POST /customers':    { description: 'Register a new customer', returns: 'Customer' },
    'GET /customers/:id': { returns: 'Customer', auth: { roles: ['customer', 'admin'] } },
  },
})
