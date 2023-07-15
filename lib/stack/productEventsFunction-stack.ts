import * as cdk from 'aws-cdk-lib'
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import { Construct } from 'constructs';
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

interface ProductEventsFunctionStackProps extends cdk.StackProps {
    eventsDdb: dynamodb.Table
}

export class ProductEventsFunctionStack extends cdk.Stack {
    readonly handler: lambdaNodeJS.NodejsFunction
    constructor(scope: Construct, id: string, props: ProductEventsFunctionStackProps) {
        super(scope, id, props)

        this.handler = new lambdaNodeJS.NodejsFunction(this, "ProductEventsFunction", {
            functionName: "ProductEventsFunction",
            entry: "lambda/products/productEventsFunction.ts",
            handler: "handler",
            bundling: {
                minify: false,
                sourceMap: false,
            },
            memorySize: 128,
            environment: {
                EVENTS_DDB: props.eventsDdb.tableName
            },
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_143_0,
            timeout: cdk.Duration.seconds(10),
        });

        props.eventsDdb.grantWriteData(this.handler)
    }
}