//https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import { v4 as uuid } from "uuid"
import { DocumentClient } from "aws-sdk/clients/dynamodb"
import * as AWSRay from 'aws-xray-sdk'
import { Lambda } from "aws-sdk"

AWSRay.captureAWS(require("aws-sdk"))
// bibliotecas que não serão incorporadas no artefato que vai para o serviço lambda,
// pois ja fazem parte do ambiente node da aws

export interface Product {
    id: string // partition key - pk
    productName: string
    code: string
    price: number
    model: string
    productUrl: string
}

export enum ProductEventType {
    CREATED = "PRODUCT_CREATED",
    UPDATED = "PRODUCT_UPDATED",
    DELETED = "PRODUCT_DELETED",
}

export interface ProductEvent {
    requestId: string
    eventType: ProductEventType
    productId: string
    productCode: string
    productPrice: number
    email: string
}

const productsDdb = process.env.PRODUCTS_DDB!
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME!

const ddbClient = new DocumentClient()
const lambdaClient = new Lambda()
// variáveis do lado de fora do handler faz com que a função
// lambda inicie mais rápida

export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    const method = event.httpMethod;
    //TODO - remover - apenas para teste
    console.log(event);
    const apiRequestId = event.requestContext.requestId;
    const lambdaRequestId = context.awsRequestId;
    const ids_of_event = {
        api_gw_request_id: apiRequestId,
        lambda_request_id: lambdaRequestId,
    }
    console.log(
        `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`
    );
    if (event.resource === "/products") {
        if (method === "GET") {
            console.log("GET /products")
            const products = await getAllProducts()
            return {
                statusCode: 200,
                headers: {},
                body: JSON.stringify(products),
            };
        } else if (method === "POST") {
            console.log('POST /products')

            const product = JSON.parse(event.body!) as Product

            const productCreated = await createProduct(product)

            const response = await sendProductEvent(productCreated, ProductEventType.CREATED, "matilde@inatel.br", apiRequestId)
            console.log(response)

            return {
                statusCode: 201,
                body: JSON.stringify(productCreated)
            }
        }
    } else if (event.resource === "/products/{id}") {
        const productId = event.pathParameters!.id as string
        if (method === "GET") {
            console.log(`GET /products/${productId}`)

            try {
                const product = await getProductById(productId)
                return {
                    statusCode: 200,
                    headers: {},
                    body: JSON.stringify(product),
                }
            } catch (error) {
                console.error((<Error>error).message)
                return {
                    statusCode: 404,
                    headers: {},
                    body: (<Error>error).message
                }
            }
        } else if (method === "DELETE") {
            console.log(`DELETE /products/${productId}`)
            try {
                const productDeleted = await deleteProductById(productId)

                const response = await sendProductEvent(productDeleted, ProductEventType.DELETED, "cleidison@inatel.br", apiRequestId)
                console.log(response)

                return {
                    statusCode: 200,
                    body: JSON.stringify(productDeleted)
                }
            } catch (error) {
                console.error((<Error>error).message);
                return {
                    statusCode: 404,
                    headers: {},
                    body: (<Error>error).message
                }
            }
        } else if (method === "PUT") {
            console.log(`PUT /products/${productId}`)
            const product = JSON.parse(event.body!) as Product
            try {
                const productUpdated = await updateProduct(productId, product)

                const response = await sendProductEvent(productUpdated, ProductEventType.UPDATED, "cleidison@inatel.br", apiRequestId)
                console.log(response)

                return {
                    statusCode: 200,
                    body: JSON.stringify(productUpdated),
                }
            } catch (ConditionalCheckFailedEsception) {
                return {
                    statusCode: 404,
                    headers: {},
                    body: "Product not found"
                }
            }
        }
    }
    return {
        statusCode: 400,
        headers: {},
        body: JSON.stringify({
            message: "Bad request",
            ...ids_of_event
        }),
    };
}

async function getAllProducts(): Promise<Product[]> {
    //EVITE O USO DO SCAN EM PROJETOS DE MAIS LARGA ESCALA
    const data = await ddbClient.scan({
        TableName: productsDdb
    }).promise()

    return data.Items as Product[]
}

async function getProductById(productId: string): Promise<Product> {
    const data = await ddbClient.get({
        TableName: productsDdb,
        Key: {
            id: productId
        }
    }).promise()

    if (data.Item) {
        return data.Item as Product
    } else {
        throw new Error("Product not found.")
    }
}

async function deleteProductById(productId: string): Promise<Product> {
    const data = await ddbClient.delete({
        TableName: productsDdb,
        Key: {
            'id': productId
        },
        ReturnValues: "ALL_OLD"
    }).promise()
    if (data.Attributes) {
        return data.Attributes as Product
    } else {
        throw new Error("Product not found")
    }
}

async function createProduct(product: Product): Promise<Product> {
    product.id = uuid()
    await ddbClient.put({
        TableName: productsDdb,
        Item: product
    }).promise()
    return product
}

async function updateProduct(productId: string, product: Product): Promise<Product> {
    const data = await ddbClient.update({
        TableName: productsDdb,
        Key: {
            id: productId
        },
        ConditionExpression: "attribute_exists(id)",
        ReturnValues: "UPDATED_NEW",
        UpdateExpression: "set productName = :n, code = :c, price = :p, model = :m, productUrl = :u",
        ExpressionAttributeValues: {
            ":n": product.productName,
            ":c": product.code,
            ":p": product.price,
            ":m": product.model,
            ":u": product.productUrl
        }
    }).promise()
    data.Attributes!.id = productId
    return data.Attributes as Product
}

function sendProductEvent(product: Product, eventType: ProductEventType, email: string, apiGwRequestId: string) {
    const event: ProductEvent = {
        email,
        eventType,
        productCode: product.code,
        productId: product.id,
        productPrice: product.price,
        requestId: apiGwRequestId
    }

    return lambdaClient.invoke({
        FunctionName: productEventsFunctionName,
        Payload: JSON.stringify(event),
        InvocationType: "Event"
    }).promise()
}