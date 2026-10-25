import {mkdir,readFile,rename,open,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {YouTubeFailure,blankYouTubeState,parseState} from './youtube-model.ts';
import type {YouTubeState} from './youtube-model.ts';
export interface StateStore {load():Promise<YouTubeState>;save(value:YouTubeState):Promise<void>}
export interface SecretStore {load():Promise<string|null>;save(value:string):Promise<void>;clear():Promise<void>}
export interface Cryptography {available():boolean;encrypt(value:string):Buffer;decrypt(value:Buffer):string}
const missing=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==='ENOENT';
async function bytes(file:string,max:number):Promise<Buffer|null>{
  try{if((await stat(file)).size>max)throw new YouTubeFailure('YouTube local data exceeds its size limit.');return await readFile(file);}catch(e){if(missing(e))return null;throw new YouTubeFailure('YouTube local data could not be read; it has not been overwritten.');}
}
/** Write-ahead state must reach disk before a remote create request, so uncertain results cannot silently duplicate events. */
async function atomic(file:string,value:Buffer|string):Promise<void>{
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temporary=`${file}.${randomUUID()}.tmp`;
  let handle;
  try{handle=await open(temporary,'wx',0o600);await handle.writeFile(value);await handle.sync();await handle.close();handle=undefined;await rename(temporary,file);}
  catch{throw new YouTubeFailure('YouTube local data could not be saved. Check storage; no automatic retry was made.');}
  finally{if(handle)await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
export class YouTubeFileState implements StateStore {
  constructor(private file:string){}
  async load():Promise<YouTubeState>{const b=await bytes(this.file,1024*1024);if(!b)return blankYouTubeState();try{return parseState(JSON.parse(b.toString('utf8')));}catch{throw new YouTubeFailure('Saved YouTube associations are invalid. They have not been replaced.');}}
  async save(value:YouTubeState):Promise<void>{await atomic(this.file,JSON.stringify(parseState(value),null,2)+'\n');}
}
/** Encrypted sidecar, deliberately excluded from workspace exports. No plaintext fallback. */
export class YouTubeSecretFile implements SecretStore {
  constructor(private file:string,private crypto:Cryptography){}
  private available():void{if(!this.crypto.available())throw new YouTubeFailure('Secure credential storage is unavailable. Unlock the macOS Keychain and retry; no tokens will be stored as plaintext.');}
  async load():Promise<string|null>{const b=await bytes(this.file,128*1024);if(!b)return null;this.available();try{return this.crypto.decrypt(b);}catch{throw new YouTubeFailure('Saved Google credentials cannot be decrypted. Reconnect Google using this Mac’s Keychain.');}}
  async save(value:string):Promise<void>{this.available();let b:Buffer;try{b=this.crypto.encrypt(value);}catch{throw new YouTubeFailure('Google credentials could not be encrypted.');}await atomic(this.file,b);}
  async clear():Promise<void>{try{await unlink(this.file);}catch(e){if(!missing(e))throw new YouTubeFailure('Saved Google credentials could not be removed.');}}
}
