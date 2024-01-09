/**
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ @author jrCleber                                                             │
 * │ @filename monitor.service.ts                                                 │
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
 * │ @class                                                                       │
 * │ @constructs WAMonitoringService                                              │
 * │ @param {EventEmitter2} eventEmitter                                          │
 * │ @param {ConfigService} configService                                         │
 * │ @param {RepositoryBroker} repository                                         │
 * │ @param {RedisCache} cache                                                    │
 * ├──────────────────────────────────────────────────────────────────────────────┤
 * │ @important                                                                   │
 * │ For any future changes to the code in this file, it is recommended to        │
 * │ contain, together with the modification, the information of the developer    │
 * │ who changed it and the date of modification.                                 │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

import { opendirSync, readdirSync, rmSync } from 'fs';
import { WAStartupService } from './whatsapp.service';
import { INSTANCE_DIR } from '../../config/path.config';
import EventEmitter2 from 'eventemitter2';
import { join } from 'path';
import { Logger } from '../../config/logger.config';
import { ConfigService, Database, DelInstance, Redis } from '../../config/env.config';
import { RepositoryBroker } from '../repository/repository.manager';
import { NotFoundException } from '../../exceptions';
import { Db } from 'mongodb';
import { RedisCache } from '../../db/redis.client';
import axios from 'axios';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const callWithRetry = async (fn, retries = 10, depth = 0) => {
  try {
    return await fn();
  } catch (e) {
    if (depth > retries) {
      throw e;
    }
    await wait(2 ** depth * 10);

    return callWithRetry(fn, retries, depth + 1);
  }
};

export class WAMonitoringService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly repository: RepositoryBroker,
    private readonly cache: RedisCache,
  ) {
    this.removeInstance();
    this.noConnection();
    this.delInstanceFiles();

    Object.assign(this.db, configService.get<Database>('DATABASE'));
    Object.assign(this.redis, configService.get<Redis>('REDIS'));

    this.dbInstance = this.db.ENABLED
      ? this.repository.dbServer?.db(this.db.CONNECTION.DB_PREFIX_NAME + '-instances')
      : undefined;
  }

  private readonly db: Partial<Database> = {};
  private readonly redis: Partial<Redis> = {};

  private dbInstance: Db;

  private readonly logger = new Logger(WAMonitoringService.name);
  public readonly waInstances: Record<string, WAStartupService> = {};

  public delInstanceTime(instance: string) {
    const time = this.configService.get<DelInstance>('DEL_INSTANCE');
    if (typeof time === 'number' && time > 0) {
      setTimeout(
        () => {
          if (this.waInstances[instance]?.connectionStatus?.state !== 'open') {
            delete this.waInstances[instance];
          }
        },
        1000 * 60 * time,
      );
    }
  }

  public async instanceInfo(instanceName?: string) {
    console.log('===============INSTA=========================', instanceName);

    if (instanceName && !this.waInstances[instanceName]) {
      throw new NotFoundException(`Instance "${instanceName}" not found`);
    }

    const instances: any[] = [];
    // console.log(Object.entries(this.waInstances), 'this.waInstances');

    // const filteredInstances = Object.entries(this.waInstances).filter((i) => i === instanceName)
    const filteredInstances: WAStartupService[] = [];
    for await (const [key, value] of Object.entries(this.waInstances)) {
      if (value && value.instanceName === instanceName) {
        filteredInstances.push(value);
      }
    }
    const checkConnection = async () => {
      if (filteredInstances[0].connectionStatus.state === 'open') {
        console.log('PAPERLONDON..................................');

        return {
          instance: {
            instanceName: filteredInstances[0].instanceName,
            owner: filteredInstances[0].wuid,
            profileName: (await filteredInstances[0].getProfileName()) || 'not loaded',
            profilePictureUrl: filteredInstances[0].profilePictureUrl,
          },
        };
      } else {
        throw 'instance not connected';
      }
    };

    const conn = await callWithRetry(checkConnection, 10);
    instances.push(conn);

    return instances.find((i) => i.instance.instanceName === instanceName);
  }

  public async instanceInfoOld(instanceName?: string, maxRetries = 10) {
    if (instanceName && !this.waInstances[instanceName]) {
      return null; // Return null when the instance is not found
    }

    try {
      const instances: any[] = [];

      for await (const [key, value] of Object.entries(this.waInstances)) {
        if (value) {
          const auth = await this.repository.auth.find(key);
          instances.push({
            instance: {
              instanceName: key,
              owner: value.wuid,
              profileName: (await value.getProfileName()) || 'not loaded',
              profilePictureUrl: value.profilePictureUrl,
            },
            auth,
          });
        }
      }

      // const filteredInstances =

      for await (const [key, value] of Object.entries(this.waInstances)) {
        if (value && value.connectionStatus.state === 'open') {
          const auth = await this.repository.auth.find(key);
          instances.push({
            instance: {
              instanceName: key,
              owner: value.wuid,
              profileName: (await value.getProfileName()) || 'not loaded',
              profilePictureUrl: value.profilePictureUrl,
            },
            auth,
          });
        }
      }
      const foundInstance = instances.find(
        (i) => i.instance.instanceName === instanceName,
      );

      return foundInstance;
    } catch (error) {
      return null;
    }

    // const wait = (ms) => new Promise((res) => setTimeout(res, ms));

    // const callWithRetry = async (retries = 10, depth = 0) => {
    //   try {

    //     if (retry < maxRetries - 1) {
    //       await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second (adjust as needed)
    //     }
    //   }
    // }

    // return null; // Return null if the instance is not found after all retry attempts
  }

  private delInstanceFiles() {
    setInterval(
      async () => {
        if (this.db.ENABLED && this.db.SAVE_DATA.INSTANCE) {
          const collections = await this.dbInstance.collections();
          collections.forEach(async (collection) => {
            const name = collection.namespace.replace(/^[\w-]+./, '');
            await this.dbInstance.collection(name).deleteMany({
              $or: [
                { _id: { $regex: /^app.state.*/ } },
                { _id: { $regex: /^session-.*/ } },
              ] as any[],
            });
          });
        } else if (this.redis.ENABLED) {
        } else {
          const dir = opendirSync(INSTANCE_DIR, { encoding: 'utf-8' });
          for await (const dirent of dir) {
            if (dirent.isDirectory()) {
              const files = readdirSync(join(INSTANCE_DIR, dirent.name), {
                encoding: 'utf-8',
              });
              files.forEach(async (file) => {
                if (file.match(/^app.state.*/) || file.match(/^session-.*/)) {
                  rmSync(join(INSTANCE_DIR, dirent.name, file), {
                    recursive: true,
                    force: true,
                  });
                }
              });
            }
          }
        }
      },
      3600 * 1000 * 2,
    );
  }

  private async cleaningUp(instanceName: string) {
    if (this.db.ENABLED && this.db.SAVE_DATA.INSTANCE) {
      await this.repository.dbServer.connect();
      const collections: any[] = await this.dbInstance.collections();
      if (collections.length > 0) {
        await this.dbInstance.dropCollection(instanceName);
      }
      return;
    }

    if (this.redis.ENABLED) {
      this.cache.reference = instanceName;
      await this.cache.delAll();
      return;
    }
    rmSync(join(INSTANCE_DIR, instanceName), { recursive: true, force: true });
  }

  public async loadInstance() {
    const set = async (name: string) => {
      const instance = new WAStartupService(
        this.configService,
        this.eventEmitter,
        this.repository,
        this.cache,
      );
      instance.instanceName = name;
      await instance.connectToWhatsapp();
      this.waInstances[name] = instance;
    };

    try {
      if (this.redis.ENABLED) {
        await this.cache.connect(this.redis as Redis);
        const keys = await this.cache.instanceKeys();
        if (keys?.length > 0) {
          keys.forEach(async (k) => await set(k.split(':')[1]));
        }
        return;
      }

      if (this.db.ENABLED && this.db.SAVE_DATA.INSTANCE) {
        await this.repository.dbServer.connect();
        const collections: any[] = await this.dbInstance.collections();
        if (collections.length > 0) {
          collections.forEach(
            async (coll) => await set(coll.namespace.replace(/^[\w-]+\./, '')),
          );
        }
        return;
      }

      const dir = opendirSync(INSTANCE_DIR, { encoding: 'utf-8' });
      for await (const dirent of dir) {
        if (dirent.isDirectory()) {
          const files = readdirSync(join(INSTANCE_DIR, dirent.name), {
            encoding: 'utf-8',
          });
          if (files.length === 0) {
            rmSync(join(INSTANCE_DIR, dirent.name), { recursive: true, force: true });
            break;
          }

          await set(dirent.name);
        }
      }
    } catch (error) {
      this.logger.error(error);
    }
  }

  private removeInstance() {
    this.eventEmitter.on('remove.instance', async (instanceName: string) => {
      const headers = {
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        token: process.env.RUBY_BEARER,
      };
      try {
        this.waInstances[instanceName] = undefined;
      } catch {}

      try {
        this.cleaningUp(instanceName);
      } finally {
        try {
          const { STAGING_RUBY_URL } = process.env;
          const res = await axios.delete(STAGING_RUBY_URL, { headers });
          const { status, data } = res;
          this.logger.warn(
            `Delete Instance from Ruby status : "${status}" Data : "${JSON.stringify(
              data,
            )}"`,
          );
        } catch (error) {
          this.logger.warn('Get Error on Ruby API!!!');
        }

        this.logger.warn(`Instance "${instanceName}" - REMOVED`);
      }
    });
  }

  private noConnection() {
    this.eventEmitter.on('no.connection', async (instanceName) => {
      const del = this.configService.get<DelInstance>('DEL_INSTANCE');
      if (del) {
        try {
          this.waInstances[instanceName] = undefined;
          this.cleaningUp(instanceName);
        } catch (error) {
          this.logger.error({
            localError: 'noConnection',
            warn: 'Error deleting instance from memory.',
            error,
          });
        } finally {
          this.logger.warn(`Instance "${instanceName}" - NOT CONNECTION`);
        }
      }
    });
  }
}
