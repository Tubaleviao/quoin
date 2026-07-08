import { defineApi } from '@quoin/core'

export default defineApi({
  endpoints: {
    'POST /books':            { description: 'Add a new book',          auth: { roles: ['librarian'] } },
    'POST /members':          { description: 'Register a new member',   auth: { roles: ['librarian'] } },
    'POST /loans':            { description: 'Borrow a book',           auth: { roles: ['member'] } },
    'DELETE /loans/:id':      { description: 'Return a borrowed book',  auth: { roles: ['member', 'librarian'] } },
    'GET /books':             { description: 'List all books',          returns: 'Book', auth: { roles: ['member', 'librarian'] } },
    'GET /books/:id':         { description: 'Get book details',        returns: 'Book', auth: { roles: ['member', 'librarian'] } },
    'GET /members':           { description: 'List all members',        returns: 'Member', auth: { roles: ['librarian'] } },
    'GET /loans':             { description: 'List all loans',          returns: 'Loan', auth: { roles: ['librarian'] } },
    'GET /members/:id/loans': { description: 'Member loan history',     returns: 'Loan', auth: { roles: ['member', 'librarian'] } },
  },
})
