import { defineFabric } from '@quoin/core'
import Customer from '../entities/Customer'
import Order    from '../entities/Order'
import LineItem from '../entities/LineItem'
import OrderAPI    from '../apis/OrderAPI'
import CustomerAPI from '../apis/CustomerAPI'

export default defineFabric({
  meta: {
    name: 'RestAPIExample',
    description: 'Example REST API — order management system',
    version: '1.0.0',
    namespace: 'https://example.com/ontology/',
  },
  entities: { Customer, Order, LineItem },
  apis: { OrderAPI, CustomerAPI },
})
