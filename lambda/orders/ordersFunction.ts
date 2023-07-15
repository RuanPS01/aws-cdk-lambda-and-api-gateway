import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import { v4 as uuid } from "uuid"
import { DocumentClient } from "aws-sdk/clients/dynamodb"
import * as AWSRay from 'aws-xray-sdk'
import { SNS } from "aws-sdk"

AWSRay.captureAWS(require("aws-sdk"))

const productsDdb = process.env.PRODUCTS_DDB!
const ordersDdb = process.env.ORDERS_DDB!
const orderEventsTopicArn = process.env.ORDER_EVENTS_TOPIC_ARN!

const ddbClient = new DocumentClient()
const snsClient = new SNS()

interface OrderEvent {
    email: string
    orderId: string
    shipping: {
        type: string
        carrier: string
    }
    billing: {
        payment: string
        totalPrice: number
    }
    productCodes: string[]
    requestId: string
}

enum OrderEventType {
    CREATED = "CREATED",
    DELETED = "DELETED"
} // ESTÁ FALTANDO NO MATERIAL DE AULA

enum PaymentType {
    CASH = "CASH",
    DEBIT_CARD = "DEBIT_CARD",
    CREDIT_CARD = "CREDIT_CARD",
}

enum ShippingType {
    ECONOMIC = "ECONOMIC",
    URGENT = "URGENT",
}

enum CarrierType {
    CORREIOS = "CORREIOS",
    FEDEX = "FEDEX",
}

interface OrderRequest {
    email: string
    productIds: string[]
    payment: PaymentType
    shipping: {
        type: ShippingType
        carrier: CarrierType
    }
}

interface OrderProductResponse {
    code: string
    price: number
}

interface OrderProduct {
    code: string
    price: number
}

interface OrderResponse {
    email: string
    id: string
    createAt: number
    billing: {
        payment: PaymentType
        totalPrice: number
    }
    shipping: {
        type: ShippingType
        carrier: CarrierType
    }
    products?: OrderProductResponse[]
}

interface Order {
    pk: string
    sk: string
    createAt: number
    billing: {
        payment: PaymentType
        totalPrice: number
    }
    shipping: {
        type: ShippingType
        carrier: CarrierType
    }
    products?: OrderProduct[]
}

export interface Product {
    id: string // partition key - pk
    productName: string
    code: string
    price: number
    model: string
    productUrl: string
}

export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    const method = event.httpMethod;
    const apiRequestId = event.requestContext.requestId;
    const lambdaRequestId = context.awsRequestId;

    console.log(
        `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`
    );

    if (event.resource === "/orders") {
        if (method === "GET") {
            if (event.queryStringParameters) {
                if (event.queryStringParameters.email) {
                    if (event.queryStringParameters.orderId) {
                        // Get one order from a user
                        console.log("GET /orders (one order from a user)")
                        try {
                            const order = await getOrder(
                                event.queryStringParameters.email,
                                event.queryStringParameters.orderId
                            );
                            return {
                                statusCode: 200,
                                body: JSON.stringify(convertToOrderResponse(order))
                            }
                        } catch (error) {
                            console.log((<Error>error).message)
                            return {
                                statusCode: 404,
                                body: (<Error>error).message
                            }
                        }
                    } else {
                        // Get all orders from a user
                        console.log("GET /orders (all orders from a user)")
                        const orders = await getOrdersByEmail(event.queryStringParameters.email)
                        return {
                            statusCode: 200,
                            body: JSON.stringify(orders.map(convertToOrderResponse))
                        }
                    }
                }
            } else {
                // Get all orders
                console.log("GET /orders (all orders)")
                const orders = await getAllOrders()
                return {
                    statusCode: 200,
                    body: JSON.stringify(orders.map(convertToOrderResponse))
                }
            }
        } else if (method === "POST") {
            console.log("POST /orders")

            const orderRequest = JSON.parse(event.body!) as OrderRequest
            const products = await getProductsById(orderRequest.productIds)

            if (products.length === orderRequest.productIds.length) {
                const order = buildOrder(orderRequest, products)
                const orderCreated = await createOrder(order)

                const eventResult = await sendOrderEvent(
                    orderCreated, OrderEventType.CREATED, lambdaRequestId
                );
                console.log(
                    `Order created event sent - OrderId: ${orderCreated.sk} - MessageId:
                    ${eventResult.MessageId}`
                );

                return {
                    statusCode: 201,
                    body: JSON.stringify(convertToOrderResponse(orderCreated))
                }
            } else {
                return {
                    statusCode: 404,
                    body: "Some product was not found"
                }
            }
        } else if (method === "DELETE") {
            console.log("DELETE /orders")
            try {
                const orderDeleted = await deleteOrder(
                    event.queryStringParameters!.email!,
                    event.queryStringParameters!.orderId!
                )

                const eventResult = await sendOrderEvent(
                    orderDeleted, OrderEventType.DELETED, lambdaRequestId
                );
                console.log(
                    `Order deleted event sent - OrderId: ${orderDeleted.sk} - MessageId:
                    ${eventResult.MessageId}`
                );

                return {
                    statusCode: 200,
                    body: JSON.stringify(convertToOrderResponse(orderDeleted))
                }
            } catch (error) {
                console.log((<Error>error).message)
                return {
                    statusCode: 404,
                    body: (<Error>error).message
                }
            }
        }
    }

    return {
        statusCode: 400,
        body: "Bad request"
    }
}

function sendOrderEvent(order: Order, eventType: OrderEventType, requestId: string) {
    const productCodes: string[] = []
    order.products?.forEach((product) => {
        productCodes.push(product.code)
    })
    const orderEvent: OrderEvent = {
        email: order.pk,
        orderId: order.sk!,
        billing: order.billing,
        shipping: order.shipping,
        requestId: requestId,
        productCodes: productCodes
    }

    return snsClient.publish({
        TopicArn: orderEventsTopicArn,
        Message: JSON.stringify(orderEvent),
        MessageAttributes: {
            eventType: {
                DataType: 'String',
                StringValue: eventType
            }
        }
    }).promise()
}

async function getProductsById(productIds: string[]): Promise<Product[]> {
    const keys: { id: string }[] = []
    productIds.forEach((productId) => {
        keys.push({
            id: productId
        })
    })
    const data = await ddbClient.batchGet({
        RequestItems: {
            [productsDdb]: {
                Keys: keys
            }
        }
    }).promise()
    return data.Responses![productsDdb] as Product[]
}

async function createOrder(order: Order): Promise<Order> {
    await ddbClient.put({
        TableName: ordersDdb,
        Item: order
    }).promise()
    return order
}

function convertToOrderResponse(order: Order): OrderResponse {
    const orderProducts: OrderProductResponse[] = []
    order.products?.forEach((product) => {
        orderProducts.push({
            code: product.code,
            price: product.price
        })
    })
    const orderResponse: OrderResponse = {
        email: order.pk,
        id: order.sk,
        createAt: order.createAt,
        products: orderProducts.length ? orderProducts : undefined,
        billing: {
            payment: order.billing.payment,
            totalPrice: order.billing.totalPrice
        },
        shipping: {
            type: order.shipping.type,
            carrier: order.shipping.carrier
        }
    }
    return orderResponse
}

function buildOrder(orderRequest: OrderRequest, products: Product[]): Order {
    const orderProducts: OrderProduct[] = [] // Obs: No material a tipagem est'a errada
    let totalPrice = 0
    products.forEach((product) => {
        totalPrice += product.price
        orderProducts.push({
            code: product.code,
            price: product.price
        })
    })
    const order: Order = {
        pk: orderRequest.email,
        sk: uuid(),
        createAt: Date.now(),
        billing: {
            payment: orderRequest.payment,
            totalPrice: 0
        },
        shipping: {
            type: orderRequest.shipping.type,
            carrier: orderRequest.shipping.carrier
        },
        products: orderProducts
    }
    return order
}

async function getAllOrders(): Promise<Order[]> {
    // SCAN É UM CRIME!!
    const data = await ddbClient.scan({
        TableName: ordersDdb,
    }).promise()
    return data.Items as Order[]
}

async function getOrdersByEmail(email: string): Promise<Order[]> {
    const data = await ddbClient.query({
        TableName: ordersDdb,
        KeyConditionExpression: "pk = :email", // apenas para parametros chave pk ou sk
        //FilterExpression:  (posso usar esse parametro para filtrar demais valores da tabela)
        ExpressionAttributeValues: {
            ":email": email
        }
    }).promise()
    return data.Items as Order[]
}

async function getOrder(email: string, orderId: string): Promise<Order> {
    const data = await ddbClient.get({
        TableName: ordersDdb,
        Key: {
            pk: email,
            sk: orderId
        }
    }).promise()
    if (data.Item) {
        return data.Item as Order
    } else {
        throw new Error("Order not found");

    }
}

async function deleteOrder(email: string, orderId: string): Promise<Order> {
    const data = await ddbClient.delete({
        TableName: ordersDdb,
        Key: {
            pk: email,
            sk: orderId
        },
        ReturnValues: "ALL_OLD"
    }).promise()
    if (data.Attributes) {
        return data.Attributes as Order
    } else {
        throw new Error('Order not found')
    }
}