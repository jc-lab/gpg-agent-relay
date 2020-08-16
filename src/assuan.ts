import * as net from 'net';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';

export interface IOptions {
  path: string;
}

export type ConnectHandler = () => void;
export type ReadHandler = (data: Buffer) => Promise<void>;
export type CloseHandler = () => Promise<void>;
export type ErrorHandler = (err: Error) => void;

export class AssuanClient implements IOptions {
  public readonly path: string;
  private _readHandler: ReadHandler;
  private _closeHandler: CloseHandler;
  private _errorHandler: ErrorHandler;

  private _clientSocket: net.Socket | null = null;
  private _connected: boolean = false;

  private _isAssuan: boolean = false;
  private _nonce!: Buffer;

  private constructor(opts: IOptions) {
    this.path = opts.path;
  }

  public get connected(): boolean {
    return this._connected;
  }

  public onRead(handler: ReadHandler) {
    this._readHandler = handler;
  }

  public onClose(handler: CloseHandler) {
    this._closeHandler = handler;
  }

  public onError(handler: ErrorHandler) {
    this._errorHandler = handler;
  }

  public connect(): Promise<void> {
    const dest = path.resolve(this.path);

    if (!fs.existsSync(dest)) {
      return Promise.reject(new Error('Not exists'));
    }

    return util.promisify(fs.stat)(dest)
      .then(stat => {
        if (stat.isFile()) {
          return this._connectInfoFileSocket(dest);
        } else {
          return this._connectUnixDomainSocket(dest);
        }
      });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._clientSocket) {
        this._clientSocket.end(() => {
          this._clientSocket = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public write(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._clientSocket) {
        this._clientSocket.write(data, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        reject(new Error('Not connected'));
      }
    });
  }

  private _connectSocket(socket: net.Socket): Promise<void> {
    this._clientSocket = socket;
    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        this._connected = true;

        if (this._isAssuan) {
          socket.write(this._nonce, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
          return ;
        }

        resolve();
      });
      socket.on('error', (err) => {
        if (this._connected) {
          this._errorHandler(err);
        } else {
          reject(err);
        }
      });
      socket.on('data', (data) => {
        const pause = !socket.isPaused();
        if (pause) {
          socket.pause();
        }
        this._readHandler(data)
          .catch((err) => {
            this._errorHandler(err);
          })
          .finally(() => {
            if (pause) {
              socket.resume();
            }
          });
      });
      socket.on('close', () => {
        this._closeHandler();
        this._clientSocket = null;
      });
    });
  }

  private _connectInfoFileSocket(dest: string): Promise<void> {
    this._isAssuan = true;
    return util.promisify(fs.readFile)(dest)
      .then(fileBuffer => {
        const nlchar = '\n'.charCodeAt(0);
        const linePos = fileBuffer.findIndex((v) => v === nlchar);
        const portPart = fileBuffer.slice(0, linePos).toString('ascii');
        const noncePart = fileBuffer.slice(linePos + 1);
        this._nonce = noncePart;
        const s = net.createConnection({
          host: 'localhost',
          port: parseInt(portPart)
        });
        return this._connectSocket(s);
      });
  }

  private _connectUnixDomainSocket(dest: string): Promise<void> {
    const s = net.createConnection({
      path: this.path
    });
    return this._connectSocket(s);
  }

  public static create(opts: IOptions): AssuanClient {
    return new AssuanClient(opts);
  }
}
