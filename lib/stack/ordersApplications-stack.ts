import * as cdk from 'aws-cdk-lib'
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import { Construct } from 'constructs';
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as sns from "aws-cdk-lib/aws-sns"
import * as subs from "aws-cdk-lib/aws-sns-subscriptions"

interface OrdersApplicationStackProps extends cdk.StackProps {
    productsDdb: dynamodb.Table
    eventsDdb: dynamodb.Table
}

export class OrdersApplicationStack extends cdk.Stack {
    readonly ordersHandler: lambdaNodeJS.NodejsFunction;

    constructor(scope: Construct, id: string, props: OrdersApplicationStackProps) {
        super(scope, id, props)

        //TODO: remover - para teste apenas
        const ordersTopic = new sns.Topic(this, "OrderEventsTopic", {
            displayName: "Order events topic",
            topicName: "order-events"
        })

        ordersTopic.addSubscription(new subs.EmailSubscription("ruanpatrick.s@hotmail.com", {
            json: true
        }))

        const ordersDdb = new dynamodb.Table(this, "OrdersDdb", {
            tableName: "orders",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 1,
            writeCapacity: 1,
            partitionKey: {
                name: "pk",
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: "sk",
                type: dynamodb.AttributeType.STRING
            }
        })

        this.ordersHandler = new lambdaNodeJS.NodejsFunction(this, "ProductsFunction", {
            functionName: "OrdersFUnction",
            entry: "lambda/orders/ordersFunction.ts",
            handler: "handler",
            bundling: {
                minify: true,
                sourceMap: false,
            },
            memorySize: 128,
            environment: {
                PRODUCTS_DDB: props.productsDdb.tableName,
                ORDERS_DDB: ordersDdb.tableName,
                ORDER_EVENTS_TOPIC_ARN: ordersTopic.topicArn
            },
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_143_0,
            timeout: cdk.Duration.seconds(10),
        })
        props.productsDdb.grantReadData(this.ordersHandler)
        ordersDdb.grantReadWriteData(this.ordersHandler)
        ordersTopic.grantPublish(this.ordersHandler)
    }
}