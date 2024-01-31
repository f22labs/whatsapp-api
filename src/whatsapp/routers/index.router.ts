//@ts-nocheck
/**
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ @author jrCleber                                                             │
 * │ @filename index.router.ts                                                    │
 * │ Developed by: Cleber Wilson                                                  │
 * │ Creation date: Nov 27, 2022                                                  │
 * │ Contact: contato@codechat.dev                                                │
 * ├──────────────────────────────────────────────────────────────────────────────┤
 * │ @copyright © Cleber Wilson 2022. All rights reserved.                        │
 * │ Licensed under the Apache License, Version 2.0                               │
 * │                                                                              │
 * │  @license "https://github.com/code-chat-br/whatsapp-api/blob/main/LICENSE"   │
 * │                                                                              │
 * │ You may not use this file except in compliance with the License.             │
 * │ You may obtain a copy of the License at                                      │
 * │                                                                              │
 * │    http://www.apache.org/licenses/LICENSE-2.0                                │
 * │                                                                              │
 * │ Unless required by applicable law or agreed to in writing, software          │
 * │ distributed under the License is distributed on an "AS IS" BASIS,            │
 * │ WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.     │
 * │                                                                              │
 * │ See the License for the specific language governing permissions and          │
 * │ limitations under the License.                                               │
 * │                                                                              │
 * │ @enum {HttpStatus}                                                           │
 * │ @constant router                                                             │
 * │ @constant authType                                                           │
 * │ @constant guards                                                             │
 * ├──────────────────────────────────────────────────────────────────────────────┤
 * │ @important                                                                   │
 * │ For any future changes to the code in this file, it is recommended to        │
 * │ contain, together with the modification, the information of the developer    │
 * │ who changed it and the date of modification.                                 │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

import { Router } from 'express';
import { Auth, configService } from '../../config/env.config';
import { instanceExistsGuard, instanceLoggedGuard } from '../guards/instance.guard';
import { authGuard } from '../guards/auth.guard';
import { ChatRouter } from './chat.router';
import { GroupRouter } from './group.router';
import { InstanceRouter } from './instance.router';
import { MessageRouter } from './sendMessage.router';
import { ViewsRouter } from './view.router';
import { WebhookRouter } from './webhook.router';
import {
  chatController,
  instanceController,
  sendMessageController,
} from '../whatsapp.module';
import {
  getBroadcastInfo,
  sendCallback,
  sendMessageResponse,
  sendMessageSlack,
  updateBroadcastStatus,
  getCampaignDetail,
  delay,
  sendmessageCallback,
} from '../../utils';
import { dbserver } from "../../db/db.connect";
import { schedlueMessage } from '../../utils/run-schedule';

enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NOT_FOUND = 404,
  FORBIDDEN = 403,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  INTERNAL_SERVER_ERROR = 500,
}

const router = Router();
const authType = configService.get<Auth>('AUTHENTICATION').TYPE;
const guards = [instanceExistsGuard, instanceLoggedGuard, authGuard[authType]];
const devRouter = Router();
devRouter
  .get('/init', async (req, res) => {
    const { id, ts } = req.query as { id: string; ts: string };

    try {
      const response = await instanceController.createInstance({ instanceName: id }, req);
      const connect = await instanceController.connectToWhatsapp({
        instanceName: response.instance.instanceName,
      });
      res.send(connect);
    } catch (e) {
      res.send({ error: ' error connect' });
    }
  })
  .get('/fetchinstance', async (req, res) => {
    const { id, ts } = req.query as { id: string; ts: string };
    try {
      const response = await instanceController.fetchInstances({
        instanceName: id,
      });
      res.send({ data: response });
    } catch (error) {
      res.send({ error: 'Not Found', message: [`Instance "${id}" not found`] });
    }
  })
  .post('/send-message', async (req, res) => {
    const processMessage = async (datamessage) => {
      const { id, message, to_phone, callback_url, callback_params, token } =
        JSON.parse(datamessage);
      const response = await checkPhoneNumberHandler(
        message,
        to_phone,
        id,
        callback_url,
        callback_params,
        token,
      );
      return response;
    };

    const checkPhoneNumberExistence = async (instance, phoneNumber) => {
      try {
        const response = await chatController.whatsappNumber(
          { instanceName: instance },
          { numbers: [phoneNumber] },
        );
        return response?.[0]?.exists;
      } catch (error) {
        return false;
      }
    };

    const checkPhoneNumberHandler = async (
      message,
      phoneNumber,
      instance,
      callback_url,
      callback_params,
      token,
    ) => {
      const numberExists = await checkPhoneNumberExistence(instance, phoneNumber);
      const instanceExists = await instanceController.fetchInstances({
        instanceName: instance,
      });
      if (instanceExists.instance.instanceName) {
        try {
          const response = await sendMessage(
            instance,
            message,
            phoneNumber,
            callback_url,
            callback_params,
            token,
          );
        } catch (error) {
          console.log(error);
        }
      } else {
      }
    };

    const sendMessage = async (
      instance,
      message,
      phoneNumber,
      callback_url,
      callback_params,
      token,
    ) => {
      let params;
      try {
        const msg = await sendMessageController.sendText(
          { instanceName: instance },
          {
            textMessage: { text: message.text },
            number: phoneNumber,
            options: { delay: 1200 },
          },
        );

        params = {
          id: instance,
          status: 'sent',
          msg_id: msg?.key?.id,
          ...callback_params,
        };

        await sendCallback(callback_url, params);
        await sendMessageSlack(params);
        await sendmessageCallback(callback_url, callback_params, token, 'completed');
        res.send(msg);
        return;
      } catch (error) {
        console.log('eror', error);
        await sendMessageResponse(error);
        await sendMessageSlack(error);
        console.log(error, 'error');
        await sendmessageCallback(callback_url, callback_params, token, 'failed');
        res.status(error.status).send({ error });
      }

      return params;
    };

    try {
      const data = Buffer.from(req.body.message_body, 'base64').toString('utf-8');
      const response = await processMessage(data);
      // res.send({ message: 'success', response });
    } catch (error) {
      res.send({ message: 'error', error });
    }
  })
  .post('/broadcast-message', async (req, res: { req: any }) => {
    function getFileNameFromURL(url) {
      const parts = url.split('/');
      const fileName = parts[parts.length - 1];
      return fileName;
    }
    const sendMediaMessage = async (
      instance,
      phoneNumber,
      mediaType,
      mediaUrl,
      caption,
      fileName,
    ) => {
      try {
        await sendMessageController.sendMedia(
          { instanceName: instance },
          {
            number: phoneNumber,
            options: {
              delay: 1200,
            },
            mediaMessage: {
              mediatype: mediaType,
              media: mediaUrl,
              caption: caption,
              fileName: getFileNameFromURL(mediaUrl),
            },
          },
        );

        return true;
      } catch (error) {
        console.log(error);
        return false;
      }
    };
    const sendMessage = async (
      instance,
      message,
      phoneNumber,
      image,
      video,
      caption,
      audio,
    ) => {
      try {
        let msg;
        if (video?.url) {
          msg = await sendMediaMessage(
            instance,
            phoneNumber,
            'video',
            video?.url,
            caption,
            message?.text,
          );
        } else if (image?.url) {
          msg = await sendMediaMessage(
            instance,
            phoneNumber,
            'image',
            image?.url,
            caption,
            'image.jpg',
          );
        } else if (audio?.url) {
          msg = await sendMediaMessage(
            instance,
            phoneNumber,
            'audio',
            audio?.url,
            caption,
            message?.text,
          );
        } else {
          msg = await sendMessageController.sendText(
            { instanceName: instance },
            {
              textMessage: { text: message },
              number: phoneNumber,
              options: {
                delay: 1200,
              },
            },
          );
        }
      } catch (error) {
        return { sucess: false };
      }
    };

    const checkPhoneNumberExistence = async (instance, phoneNumber) => {
      try {
        const response = await chatController.whatsappNumber(
          {
            instanceName: instance,
          },
          {
            numbers: [phoneNumber],
          },
        );
        return response?.[0]?.exists;
      } catch (error) {
        return false;
      }
    };

    const checkPhoneNumberHandler = async (
      message,
      phoneNumber,
      instance,
      image,
      video,
      caption,
      audio,
    ) => {
      const numberExists = await checkPhoneNumberExistence(instance, phoneNumber);
      const instanceExsits = await instanceController.fetchInstances({
        instanceName: instance,
      });

      if (numberExists && instanceExsits.instance.instanceName) {
        return sendMessageHandler(
          message?.text,
          phoneNumber,
          instance,
          image,
          video,
          caption,
          audio,
        );
      } else {
        return { success: false, reason: 'Phone number does not exist' };
      }
    };

    const sendMessageHandler = async (
      message,
      phoneNumber,
      instance,
      image,
      video,
      caption,
      audio,
    ) => {
      const response = await sendMessage(
        instance,
        message,
        phoneNumber,
        image,
        video,
        caption,
        audio,
      );
      if (response) {
        return { success: true };
      } else {
        return { success: false };
      }
    };

    const fetchAndSend = async () => {
      const sent = [];
      const failed = [];

      try {
        const base64data = Buffer.from(req.body.message_body, 'base64').toString('utf-8');
        const { broadcast_id, token, id } = JSON.parse(base64data);
        const data = await getBroadcastInfo({ broadcast_id, token });
        const { recipients = [], remaining_count = 0 } = data?.data;

        for (let i = 0; i < recipients.length; i++) {
          const { to_phone_number, message, audio } = recipients[i];

          const to_phone = to_phone_number;
          const result = await checkPhoneNumberHandler(
            message,
            to_phone,
            id,
            message?.image,
            message?.video,
            message?.caption,
            message?.audio,
          );
          if (result?.success) {
            await updateBroadcastStatus({
              broadcast_id: broadcast_id,
              to_phone: to_phone_number,
              token: token,
              status: 'completed',
            });
            sent.push({ message, recipient: recipients[i] });
          } else {
            await updateBroadcastStatus({
              broadcast_id: broadcast_id,
              to_phone: to_phone_number,
              token: token,
              status: 'failed',
            });
            failed.push({
              recipient: recipients[i],
              reason: result?.reason || 'Unknown error',
            });
          }
        }
      } catch (error) {
        console.log(error, 'error');
      }
    };

    fetchAndSend();
    res.send({ sucess: 'response' });
  })
  .get('/get-details', async (req, res) => {
    // getBroadcastInfo();
    try {
      const { id } = req.query;
      const data = await instanceController.fetchInstances({ instanceName: id });
      res.send({
        user: {
          id: data.instance.owner,
          name: data.instance.profileName,
        },
      });
    } catch (error) {
      res.send({ user: 'not found' });
    }
  })
  .get('/on-whatsapp', async (req, res) => {
    const { phone, id } = req.query as {
      phone: string;
      id: string;
    };
    try {
      const response = await chatController.whatsappNumber(
        { instanceName: id },
        { numbers: phone },
      );
      res.send({ sucess: response[0] });
    } catch (error) {
      res.send({ error: 'not on whatshapp' });
    }

    //   {
    //     "exists": true,
    //     "jid": "919827779609@s.whatsapp.net"
    // }
    // 321456
  })
  .get('/check-tenant', async (req, res) => {
    const { id } = req.query;
    try {
      const data = await instanceController.fetchInstances({ instanceName: id });
      res.send({
        id,
        status: true,
      });
    } catch (error) {
      res.send({ id, status: false });
    }
  })
  .get('/disable-whatsapp', async (req, res) => {
    const { id } = req.query;
    try {
      const data = await instanceController.logout({ instanceName: id });
      res.send({ sucess: data });
    } catch (error) {
      res.send({ sucess: data });
    }
  })
  .post("/schedule-task", async (req, res) => {
    const { id, message, receiver, schedule_time } = req.body;

    const currentDate = new Date();
    const twoWeeksLater = new Date(
      currentDate.getTime() + 14 * 24 * 60 * 60 * 1000
    );
    if (new Date(schedule_time) > twoWeeksLater) {
      res
        .status(200)
        .send({ message: "Please Schedule for two week window!!!" });
    } else {
      try {
        const instanceExists = await instanceController.fetchInstances({
          instanceName: id,
        });
       console.log(instanceExists , "instanceExists")
        if (true) {
          const client = dbserver.getClient();
          await client.connect();
          // const userNumber = await instanceController.getUserNumber({
          //   instanceName: id,
          // });
          const countFromUserTable = await client
            .db("scheduled_message")
            .collection("users")
            .findOne({
              user: '919508629990',
            });

          if (countFromUserTable?.allowMessageCount == 0) {
            return res.send({ message: null, error: "Limit exceeded" });
          } else {
            const client = dbserver.getClient();
            await client.connect();
            const userdate = new Date(schedule_time);
            let scheduleTime = userdate.toISOString();
            const { insertedId } = await client
              .db("scheduled_message")
              .collection("message")
              .insertOne({
                message,
                sender: "919508629990",
                receiver: receiver,
                schedule_time: scheduleTime,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                retry_count: 0,
                version: 0,
                status: "pending",
                isActive: true,
              });

            schedlueMessage(insertedId, 0, scheduleTime);

            if (countFromUserTable?.allowMessageCount > 0) {
              // decrementMessageLimit(userNumber);
            }

            res.send({ message: "scheduled successfully!!!" });
          }
        }
      } catch (error) {
        res.status(404).send({ error: "server error" });
      }
    }
  });
router
  .use('/dev', devRouter)
  .use(
    '/instance',
    new InstanceRouter(configService, ...guards).router,
    new ViewsRouter(instanceExistsGuard).router,
  )
  .use('/message', new MessageRouter(...guards).router)
  .use('/chat', new ChatRouter(...guards).router)
  .use('/group', new GroupRouter(...guards).router)
  .use('/webhook', new WebhookRouter(...guards).router);

export { router, HttpStatus };
