import { SNSMessage, SNSEvent, Context } from "aws-lambda"
import { AWSError } from "aws-sdk"
import { DocumentClient } from "aws-sdk/clients/dynamodb"
import DynamoDB = require("aws-sdk/clients/dynamodb")
import { PromiseResult } from "aws-sdk/lib/request"
import * as AWSRay from 'aws-xray-sdk'

AWSRay.captureAWS(require("aws-sdk"))

const eventsDdb = process.env.EVENTS_DDB!
const ddbClient = new DocumentClient()

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
}

export interface OrderEventDdb {
    pk: string;
    sk: string;
    ttl: number;
    email: string;
    createdAt: number;
    requestId: string;
    eventType: string;
    info: {
        orderId: string;
        productCodes: string[];
        messageId: string;
    }
}

export const handler = async (event: SNSEvent, context: Context): Promise<void> => {
    //Criando um batch de promises
    const promises: Promise<PromiseResult<DynamoDB.DocumentClient.PutItemOutput,
        AWSError>>[] = []
    //processando paralelamente meus record
    event.Records.forEach((record) => {
        promises.push(createEvent(record.Sns))
    })
    await Promise.all(promises)
    return
}
function createEvent(body: SNSMessage) {
    const event = JSON.parse(body.Message) as OrderEvent
    console.log(`Order event - MessageId: ${body.MessageId}`)

    const timestamp = Date.now()
    const ttl = ~~(timestamp / 1000 + 5 * 60)
    const eventType = body.MessageAttributes["eventType"].Value
    const orderEventDdb: OrderEventDdb = {
        pk: `#order_${event.orderId}`,
        sk: `${eventType}#${timestamp}`,
        ttl: ttl,
        email: event.email,
        createdAt: timestamp,
        requestId: event.requestId,
        eventType: eventType,
        info: {
            orderId: event.orderId,
            productCodes: event.productCodes,
            messageId: body.MessageId
        }
    }
    return createOrderEvent(orderEventDdb)
}
function createOrderEvent(orderEvent: OrderEventDdb) {
    return ddbClient.put({
        TableName: eventsDdb,
        Item: orderEvent
    }).promise()
}
