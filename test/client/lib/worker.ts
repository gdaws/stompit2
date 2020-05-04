import { ClientSession, Subscription } from '../../../src/client/session';
import { jsonMessage } from '../../../src/client/message';
import { readJson } from '../../../src/frame/body';
import {session } from './app_utils';

export const ADDRESS_ANY = 0;
export const ADDRESS_ALL = -1;

export type PacketCommand = 'ping' | 'exit';

export  interface PacketBase {
  src: number;
  dst: number;
  ttl: number;
  cmd: PacketCommand;
};

export interface PingPacket extends PacketBase {
  cmd: 'ping';
  args: [boolean, number];
};

export interface ExitPacket extends PacketBase {
  cmd: 'exit';
};

export type Packet = PingPacket | ExitPacket;

export interface Route {
  from: string;
  to: string | undefined;
};

export function node(address: number, route: Route, init?: Packet) {

  const ttl = 1000;

  session(`Node_${address}`, async (session, log) => {

    const to = (dst: number) => ({src: address, dst, ttl});

    const send = async (packet: Packet): Promise<void> => {
    
      if (!route.to) {
        return;
      }

      const error = await session.send(jsonMessage(route.to, packet));

      if (error) {
        throw error;
      }
    };

    const receive = async (subscription: Subscription): Promise<Packet> => {

      const receiveResult = await session.receive(subscription);

      if (receiveResult.error) {
        throw receiveResult.error;
      }

      const message = receiveResult.value;

      const readResult = await readJson(message.body);

      if (readResult.error) {
        throw readResult.error;
      }

      const data = readResult.value;
      
      return data as Packet;
    };

    if (init) {
      await send(init);
    }

    const subReqResult = await session.subscribe(route.from);

    if (subReqResult.error) {
      throw subReqResult.error;
    }

    const subscription = subReqResult.value;

    while (true) {

      const packet = await receive(subscription);

      if (packet.src === address) {
        continue;
      }

      const forward = packet.dst !== address || packet.dst === ADDRESS_ALL;

      if (forward && packet.ttl > 1) {
        packet.ttl -= 1;
        send(packet);
      }
      
      const ignore = packet.dst !== address && packet.dst !== ADDRESS_ALL;

      if (ignore) {
        continue;
      }

      let response: Packet | undefined = undefined;

      switch (packet.cmd) {
        
        case 'exit':
          log('Exit instruction');
          return;
        
        case 'ping': {

          const [reply, value] = packet.args;
          
          if (!reply) {
            response = {
              ...to(packet.src), 
              cmd: 'ping', 
              args:[true, value]
            };
          }
          else {
            log(`Ping reply from node ${packet.src}`);
          }
        }
      }

      if (response) {
        await send(response);
      }
    }
  });
}
