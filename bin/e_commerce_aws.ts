#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ProductsAppStack } from '../lib/stack/productsApp-stack';
import { ECommerceApiStack } from '../lib/stack/ecommerceApi-stack';
import { EventsDdbStack } from '../lib/stack/eventsDdb-stack';
import { ProductEventsFunctionStack } from '../lib/stack/productEventsFunction-stack';
import { OrdersApplicationStack } from '../lib/stack/ordersApplications-stack';

const app = new cdk.App();

const tags = {
  cost: "ECommerce",
  team: "Inatel",
}

const env: cdk.Environment = {
  account: "361354063663",
  region: "us-east-1"
}

const eventsDdbStack = new EventsDdbStack(app, "EventsDdb", {
  tags: tags,
  env: env
})
const productEventsFunctionStack = new ProductEventsFunctionStack(app, "ProductEventsFunction", {
  eventsDdb: eventsDdbStack.table,
  tags: tags,
  env: env
})


const productsAppStack = new ProductsAppStack(app, "ProductsApp", {
  productEventsFunction: productEventsFunctionStack.handler,
  tags: tags,
  env: env
})
productsAppStack.addDependency(productEventsFunctionStack)

const ordersApplicationStack = new OrdersApplicationStack(app, "OrdersApp", {
  productsDdb: productsAppStack.productsDdb,
  eventsDdb: eventsDdbStack.table,
  tags: tags,
  env: env
})
ordersApplicationStack.addDependency(productsAppStack)
ordersApplicationStack.addDependency(eventsDdbStack)


const eCommerceApiStack = new ECommerceApiStack(app, "ECommerceApi", {
  productsHandler: productsAppStack.handler,
  ordersHandler: ordersApplicationStack.ordersHandler,
  tags: tags,
  env: env
})
eCommerceApiStack.addDependency(productsAppStack)
eCommerceApiStack.addDependency(ordersApplicationStack)