const { defineFabric } = require('@quoin/core')

module.exports = defineFabric({
  meta: {
    name: 'LibrarySystem',
    description: 'Library book lending system',
    version: '1.0.0',
  },

  entities: {
    Book:   require('./entities/Book'),
    Member: require('./entities/Member'),
    Loan:   require('./entities/Loan'),
  },

  apis: {
    LibraryAPI: require('./apis/LibraryAPI'),
  },
})
