import * as cdk from 'aws-cdk-lib';
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import { Construct } from 'constructs';
import * as apiGateway from "aws-cdk-lib/aws-apigateway"
import * as cwLogs from "aws-cdk-lib/aws-logs"

interface ECommerceApiStackProps extends cdk.StackProps {
    productsHandler: lambdaNodeJS.NodejsFunction
    ordersHandler: lambdaNodeJS.NodejsFunction
}

export class ECommerceApiStack extends cdk.Stack {
    public readonly urlOutput: cdk.CfnOutput;
    constructor(scope: Construct, id: string, props: ECommerceApiStackProps) {
        super(scope, id, props);

        const logGroup = new cwLogs.LogGroup(this, "ECommerceApiLogs");

        const api = new apiGateway.RestApi(this, "ecommerce-api", {
            restApiName: "ECommerce Service",
            cloudWatchRole: true,
            description: "This is the ECommerce service",
            deployOptions: {
                accessLogDestination: new apiGateway.LogGroupLogDestination(logGroup),
                accessLogFormat: apiGateway.AccessLogFormat.jsonWithStandardFields({
                    caller: true,
                    httpMethod: true,
                    ip: true,
                    protocol: true,
                    requestTime: true,
                    resourcePath: true,
                    responseLength: true,
                    status: true,
                    user: true,
                }),
            },
        });

        const orderRequestValidator = new apiGateway.RequestValidator(this,
            "OrderRequestValidator", {
            restApi: api,
            requestValidatorName: `Order request validator`,
            validateRequestBody: true,
        })
        const orderModel = new apiGateway.Model(this, "OrderModel", {
            modelName: "OrderModel",
            restApi: api,
            contentType: "application/json",
            schema: {
                type: apiGateway.JsonSchemaType.OBJECT,
                properties: {
                    email: {
                        type: apiGateway.JsonSchemaType.STRING
                    },
                    productIds: {
                        type: apiGateway.JsonSchemaType.ARRAY,
                        minItems: 1,
                        items: {
                            type: apiGateway.JsonSchemaType.STRING
                        }
                    },
                    payment: {
                        type: apiGateway.JsonSchemaType.STRING,
                        enum: ["CASH", "DEBIT_CARD", "CREDIT_CARD"]
                    }
                },
                required: [
                    "email",
                    "productIds",
                    "payment"
                ]
            }
        })

        //#region PRODUCTS endpoints
        const productsFunctionIntegration = new
            apiGateway.LambdaIntegration(props.productsHandler);
        const productsResource = api.root.addResource("products");
        //GET http://.../products
        productsResource.addMethod("GET", productsFunctionIntegration);
        //POST http://.../products
        productsResource.addMethod("POST", productsFunctionIntegration);
        const productIdResource = productsResource.addResource("{id}");
        //GET http://.../products/{id}
        productIdResource.addMethod("GET", productsFunctionIntegration);
        //PUT http://.../products/{id}
        productIdResource.addMethod("PUT", productsFunctionIntegration);
        //DELETE http://.../products/{id}
        productIdResource.addMethod("DELETE", productsFunctionIntegration);
        //#endregion

        //#region ORDERS endpoints
        const ordersFunctionIntegration = new apiGateway.LambdaIntegration(props.ordersHandler)
        const orderResource = api.root.addResource('orders')
        orderResource.addMethod("GET", ordersFunctionIntegration)
        orderResource.addMethod("DELETE", ordersFunctionIntegration, {
            requestParameters: {
                'method.request.querystring.email': true,
                'method.request.querystring.orderId': true,
            },
            requestValidatorOptions: {
                requestValidatorName: "Email and OrderId parameters validator",
                validateRequestParameters: true
            }
        })
        orderResource.addMethod("POST", ordersFunctionIntegration, {
            requestValidator: orderRequestValidator,
            requestModels: { "application/json": orderModel }
        })
        //#endregion

        this.urlOutput = new cdk.CfnOutput(this, "url", {
            exportName: "url",
            value: api.url,
        });
    }
}
