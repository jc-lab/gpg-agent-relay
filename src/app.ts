import * as net from 'net';
import * as path from 'path';

import { AssuanClient } from './assuan';

function parseBool(s: string | undefined, def?: boolean) {
  const _def = def || false;
  if (!s) {
    return _def;
  }
  if (/true|1|yes/i.exec(s)) {
    return true;
  }
  if (/false|0|no/i.exec(s)) {
    return false;
  }
  return _def;
}

const defaultGpgAgentSock = path.join(process.env.APPDATA, 'gnupg/S.gpg-agent.extra');
const GPG_AGENT_SOCK: string = process.env.GPG_AGENT_SOCK || defaultGpgAgentSock;
const LISTEN_PORT: number = parseInt(process.env.LISTEN_PORT || '31000');

const server = net.createServer();
server.on('connection', (socket: net.Socket) => {
  console.log(`Client[${socket.remoteAddress.toString()}] connected`);
  const client = AssuanClient.create({
    path: GPG_AGENT_SOCK
  });
  socket.on('data', (data) => {
    client.write(data);
  });
  socket.on('close', () => {
    console.log(`Client[${socket.remoteAddress.toString()}] closed`);
    client.close();
  });
  socket.on('error', (err) => {
    console.error(`Client[${socket.remoteAddress.toString()}] error`, err);
  });
  client.onRead((data) => {
    return new Promise<void>((resolve, reject) => {
      socket.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    })
  });
  client.onClose(() => new Promise<void>((resolve, reject) => {
    socket.end(() => {
      resolve();
    });
  }));
  client.onError((err) => {
    console.error(err);
  });
  client.connect();
});
server.on('error', (err) => {
  console.error('LISTEN SOCKET ERROR!', err);
  process.exit(2);
});
server.on('listening', () => {
  console.log('Server started!');
  console.log(` gpg-agent socket : ${GPG_AGENT_SOCK}`);
  console.log(` listen port      : ${LISTEN_PORT}`);
});
server.listen(LISTEN_PORT);
