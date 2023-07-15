//https://docs.aws.amazon.com/cdk/api/v2/docs/aws-construct-library.html
import * as cdk from 'aws-cdk-lib'
//https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html
import * as lambda from "aws-cdk-lib/aws-lambda"
//https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import { Construct } from 'constructs';

import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

interface ProductsAppStackProps extends cdk.StackProps {
    productEventsFunction: lambdaNodeJS.NodejsFunction
}

export class ProductsAppStack extends cdk.Stack {
    readonly handler: lambdaNodeJS.NodejsFunction;
    readonly productsDdb: dynamodb.Table

    constructor(scope: Construct, id: string, props: ProductsAppStackProps) {
        super(scope, id, props)

        this.productsDdb = new dynamodb.Table(this, "ProductsDdb", {
            tableName: "products",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 1,
            writeCapacity: 1,
        });


        this.handler = new lambdaNodeJS.NodejsFunction(this, "ProductsFunction", {
            functionName: "ProductsFunction",
            entry: "lambda/products/productsFunction.ts",
            handler: "handler",
            bundling: {
                minify: false,
                sourceMap: false,
            },
            memorySize: 128,
            environment: {
                PRODUCTS_DDB: this.productsDdb.tableName,
                PRODUCT_EVENTS_FUNCTION_NAME: props.productEventsFunction.functionName
            },
            tracing: lambda.Tracing.ACTIVE,
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_143_0,
            timeout: cdk.Duration.seconds(10),
        });
        this.productsDdb.grantReadWriteData(this.handler);
        props.productEventsFunction.grantInvoke(this.handler)
    }
}