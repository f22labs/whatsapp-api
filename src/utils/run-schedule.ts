//@ts-nocheck
import { dbserver } from "../db/db.connect";
import { sendMessageController } from "../whatsapp/whatsapp.module";
import schedule from  "node-schedule";

export async function deliverMessage(id, incomingVersion) {
  console.log("deliverMessage");
  const client = await dbConnect();
  const records = await client
    .db("scheduled_message")
    .collection("message")
    .find({ _id: id })
    .toArray();
  if (records.length > 0) {
    const { message, status, sender, receiver, isActive, version } = records[0];
    console.log("");
    if (!isActive || version != incomingVersion || status === "success") {
      return;
    }
    try {
      const { instance } = await client
        .db("scheduled_message")
        .collection("users")
        .findOne({ user: sender });
      await client
        .db("scheduled_message")
        .collection("message")
        .updateOne({ _id: id }, { $set: { status: "sent" } });
        console.log(instance , message , receiver );
        
      const res = await sendMessageController.sendText(
        { instanceName: "test" },
        {
          textMessage: { text: message },
          number: receiver,
          options: { delay: 1200 },
        }
      );
      console.log(res , "res");
      
      if (res?.key?.id) {
        await client
          .db("scheduled_message")
          .collection("message")
          .updateOne(
            { _id: id },
            {
              $set: {
                whatsapp_acknowledgement_id: res?.key?.id,
                status: "success",
              },
            }
          );
      }
    } catch (err) {
      await client
        .db("scheduled_message")
        .collection("message")
        .updateOne({ _id: id }, { $set: { status: "failed" } });
    }
  }
}

export async function dbConnect() {
  const client = dbserver.getClient();
  await client.connect();
  return client;
}

export async function schedlueMessage(id, version, scheduleTime) {
  console.log("schedlueMessage");
  try {
    schedule.scheduleJob(scheduleTime, () => {
      deliverMessage(id, version);
    });
  } catch (error) {
    console.log("Erorr in Schedule:", error);
  }
}

export async function decrementMessageLimit(userNumber) {
  console.log("decerementcount");
  try {
    const client = await dbConnect();
    await client
      .db("scheduled_message")
      .collection("users")
      .updateOne(
        { user: userNumber },
        {
          $inc: { allowMessageCount: -1 },
          $set: { updated_at: new Date().toISOString() },
        }
      );
  } catch (error) {
    console.log("Error in DecrementCount:", error);
  }
}
