import { Context, SQSEvent, SNSMessage } from "aws-lambda"

export async function handler(event: SQSEvent, context: Context): Promise<void> {
    // throw 'Non valid event type' // para testar a Dead Letter Queue
    event.Records.forEach((record) => {
        console.log(record.body)
    })
    return
}