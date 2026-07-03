const { defineApi } = require('@quoin/core')

module.exports = defineApi({
  endpoints: {
    'POST /loans':            { description: 'Borrow a book',        auth: { roles: ['member'] } },
    'DELETE /loans/:id':      { description: 'Return a borrowed book', auth: { roles: ['member', 'librarian'] } },
    'GET /books':             { description: 'List all books',        returns: 'Book', auth: { roles: ['member', 'librarian'] } },
    'GET /books/:id':         { description: 'Get book details',      returns: 'Book', auth: { roles: ['member', 'librarian'] } },
    'GET /members/:id/loans': { description: 'Member loan history',   returns: 'Loan', auth: { roles: ['member', 'librarian'] } },
  },
})
