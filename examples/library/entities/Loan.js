const { defineEntity } = require('@quoin/core')

module.exports = defineEntity({
  description: 'A record of a book being borrowed by a member',
  goal: 'Track the full lifecycle of a lending transaction',
  fields: {
    id:         { type: 'uuid',      primaryKey: true },
    bookId:     { type: 'uuid',      foreignKey: 'Book.id' },
    memberId:   { type: 'uuid',      foreignKey: 'Member.id' },
    borrowedAt: { type: 'timestamp' },
    dueAt:      { type: 'timestamp' },
    returnedAt: { type: 'timestamp', nullable: true },
  },
  relations: {
    book:   { name: 'book',   kind: 'belongsTo', target: 'Book',   foreignKey: 'bookId' },
    member: { name: 'member', kind: 'belongsTo', target: 'Member', foreignKey: 'memberId' },
  },
})
