import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import type {SecretStore} from './youtube-storage.ts';
import {YouTubeFailure,record,identifier} from './youtube-model.ts';
import type {Channel} from './youtube-model.ts';
export const YOUTUBE_SCOPE='https://www.googleapis.com/auth/youtube.force-ssl';
interface Credentials {clientId:string;clientSecret:string;refreshToken:string;channel:Channel|null}
export function desktopClient(raw:unknown):{clientId:string;clientSecret:string}{
  const c=record(record(raw).installed);
  if(typeof c.client_id!=='string'||c.client_id.length>300||!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(c.client_id))throw new YouTubeFailure('Import a Google OAuth Desktop app client JSON, not a service-account or Web client.');
  if(c.client_secret!==undefined&&(typeof c.client_secret!=='string'||c.client_secret.length>1024))throw new YouTubeFailure('Invalid desktop OAuth client.');
  // Never trust authorization/token URLs supplied in an imported credential file.
  return {clientId:c.client_id,clientSecret:c.client_secret||''};
}
export function pkce(verifier=randomBytes(48).toString('base64url')):{verifier:string;challenge:string}{return {verifier,challenge:createHash('sha256').update(verifier).digest('base64url')};}
export function sameState(expected:string,actual:string):boolean{const a=Buffer.from(expected),b=Buffer.from(actual);return a.length===b.length&&timingSafeEqual(a,b);}
/** System-browser OAuth with PKCE and a short-lived loopback listener. No Google password enters this app. */
export class YouTubeOAuth {
  private credentials:Credentials|null=null;private access='';private expires=0;private epoch=0;
  private cancelLogin:(()=>void)|null=null;private refreshing:Promise<string>|null=null;
  constructor(private store:SecretStore,private openBrowser:(url:string)=>Promise<void>,private http:typeof fetch=fetch){}
  get configured():boolean{return !!this.credentials;}
  get channel():Channel|null{return this.credentials?.channel?{...this.credentials.channel}:null;}
  async load():Promise<void>{
    const saved=await this.store.load();if(!saved)return;
    try{
      const r=record(JSON.parse(saved)),c=desktopClient({installed:{client_id:r.clientId,client_secret:r.clientSecret}});
      if(typeof r.refreshToken!=='string'||r.refreshToken.length>8192)throw new Error();
      const ch=r.channel===null?null:{id:identifier(record(r.channel).id),title:String(record(r.channel).title).slice(0,200)};
      this.credentials={...c,refreshToken:r.refreshToken,channel:ch};
    }catch{throw new YouTubeFailure('Saved Google authorization is invalid. Reconfigure locally; it has not been overwritten.');}
  }
  async configure(raw:unknown):Promise<void>{
    if(this.credentials?.refreshToken)throw new YouTubeFailure('Forget the existing Google sign-in before replacing its OAuth client.');
    const c={...desktopClient(raw),refreshToken:'',channel:null};await this.store.save(JSON.stringify(c));this.credentials=c;this.cancel();
  }
  cancel():void{this.epoch++;this.cancelLogin?.();this.cancelLogin=null;}
  private async tokenRequest(params:Record<string,string>):Promise<Record<string,any>>{
    let r:Response;try{r=await this.http('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),headers:{'Content-Type':'application/x-www-form-urlencoded'},redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new YouTubeFailure('Google authorization could not be completed. No broadcast was changed.');}
    let data:Record<string,any>;try{data=record(await r.json());}catch{throw new YouTubeFailure('Google returned an unreadable authorization response.');}
    if(!r.ok)throw new YouTubeFailure('Google authorization was refused, expired or revoked. Sign in again.');
    if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>16384||typeof data.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0||data.token_type!=='Bearer')throw new YouTubeFailure('Google returned incomplete authorization.');
    if(typeof data.scope==='string'&&!data.scope.split(' ').includes(YOUTUBE_SCOPE))throw new YouTubeFailure('The requested YouTube management permission was not granted.');
    return data;
  }
  async signIn(resolveChannel:(token:string)=>Promise<Channel>):Promise<Channel>{
    if(!this.credentials)throw new YouTubeFailure('Import a Google Desktop OAuth client first.');
    this.cancel();const epoch=this.epoch,c=this.credentials,{verifier,challenge}=pkce(),state=randomBytes(32).toString('base64url');
    const valid=()=>{if(epoch!==this.epoch)throw new YouTubeFailure('Google sign-in cancelled.');};
    let finish:(code:string)=>void=()=>{},fail:(e:Error)=>void=()=>{};
    const callback=new Promise<string>((resolve,reject)=>{finish=resolve;fail=reject;});
    // Attach a handler immediately: browser launch can fail before callback is awaited.
    void callback.catch(()=>{});
    const server=createServer((req,res)=>{
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'");res.setHeader('Content-Type','text/plain; charset=utf-8');
      if(req.method!=='GET'||(req.url||'').length>8192){res.writeHead(400);res.end('Invalid request.');return;}
      const u=new URL(req.url||'/','http://127.0.0.1');
      if(u.pathname!=='/oauth/callback'||!sameState(state,u.searchParams.get('state')||'')){res.writeHead(400);res.end('Invalid authorization state.');return;}
      const code=u.searchParams.get('code');
      if(u.searchParams.has('error')||!code||code.length>4096){res.end('Authorization was not granted. Return to Broadcast Control Center.');fail(new YouTubeFailure('Google sign-in was declined.'));return;}
      res.end('Authorization received. Return to Broadcast Control Center.');finish(code);
    });
    const close=()=>{server.close();server.closeAllConnections();};
    this.cancelLogin=()=>{close();fail(new YouTubeFailure('Google sign-in cancelled.'));};
    const timeout=setTimeout(()=>{close();fail(new YouTubeFailure('Google sign-in expired. Start it again.'));},180000);
    try{
      await new Promise<void>((resolve,reject)=>{server.once('error',()=>reject(new YouTubeFailure('The local Google sign-in listener could not start.')));server.listen(0,'127.0.0.1',resolve);});valid();
      const address=server.address();if(!address||typeof address==='string')throw new YouTubeFailure('The local Google callback is unavailable.');
      const redirect=`http://127.0.0.1:${address.port}/oauth/callback`,u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.search=new URLSearchParams({client_id:c.clientId,redirect_uri:redirect,response_type:'code',scope:YOUTUBE_SCOPE,access_type:'offline',prompt:'consent select_account',code_challenge:challenge,code_challenge_method:'S256',state}).toString();
      await this.openBrowser(u.href);valid();const code=await callback;valid();close();
      const data=await this.tokenRequest({client_id:c.clientId,...(c.clientSecret?{client_secret:c.clientSecret}:{}),redirect_uri:redirect,grant_type:'authorization_code',code,code_verifier:verifier});valid();
      if(typeof data.refresh_token!=='string'||!data.refresh_token||data.refresh_token.length>8192)throw new YouTubeFailure('Google did not grant persistent access. Reconnect with consent; no plaintext credentials were saved.');
      const channel=await resolveChannel(data.access_token);valid();
      const next={...c,refreshToken:data.refresh_token,channel};await this.store.save(JSON.stringify(next));valid();
      this.credentials=next;this.access=data.access_token;this.expires=Date.now()+data.expires_in*1000;return channel;
    }finally{clearTimeout(timeout);close();if(epoch===this.epoch)this.cancelLogin=null;}
  }
  async token():Promise<string>{
    if(this.access&&Date.now()<this.expires-60000)return this.access;
    if(this.refreshing)return this.refreshing;
    const c=this.credentials,epoch=this.epoch;if(!c?.refreshToken)throw new YouTubeFailure('Connect Google before managing YouTube events.');
    this.refreshing=(async()=>{
      const data=await this.tokenRequest({client_id:c.clientId,...(c.clientSecret?{client_secret:c.clientSecret}:{}),grant_type:'refresh_token',refresh_token:c.refreshToken});
      if(epoch!==this.epoch)throw new YouTubeFailure('Google authorization changed during refresh.');
      this.access=data.access_token;this.expires=Date.now()+data.expires_in*1000;return this.access;
    })();try{return await this.refreshing;}finally{this.refreshing=null;}
  }
  async forget():Promise<void>{
    this.cancel();this.access='';this.expires=0;
    const c=this.credentials;if(c){const next={...c,refreshToken:'',channel:null};await this.store.save(JSON.stringify(next));this.credentials=next;}
    else await this.store.clear();
    // This removes local access only. Google-account permission revocation is a separate user action.
  }
}
