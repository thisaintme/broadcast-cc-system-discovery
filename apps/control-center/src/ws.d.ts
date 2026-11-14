/** Minimal declarations for the pinned, bundled ws transport (no browser or arbitrary RPC API). */
declare module 'ws' {
  import {EventEmitter} from 'node:events';
  import type {IncomingMessage} from 'node:http';
  import type {Duplex} from 'node:stream';
  export class WebSocket extends EventEmitter {
    static OPEN:number;readyState:number;
    constructor(url:string,options?:Record<string,unknown>);
    send(data:string|Buffer):void;close():void;terminate():void;
    on(event:'message',listener:(data:Buffer)=>void):this;
    on(event:'error',listener:(error:Error)=>void):this;
    on(event:string,listener:(...args:any[])=>void):this;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(options:{noServer?:boolean;maxPayload?:number;port?:number;host?:string});
    handleUpgrade(request:IncomingMessage,socket:Duplex,head:Buffer,callback:(client:WebSocket)=>void):void;
    close(callback?:()=>void):void;
  }
}
