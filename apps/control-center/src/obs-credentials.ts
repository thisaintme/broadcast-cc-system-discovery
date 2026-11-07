import type {SecretStore} from './youtube-storage.ts';
import {localEndpoint} from './workspace.ts';
import {LiveFailure} from './live-contract.ts';
export interface ObsCredentialStatus {saved:boolean;available:boolean;autoConnect:boolean;endpoint:string;error:string}
interface Credential {version:1;endpoint:string;password:string;autoConnect:boolean}
/** Write-only renderer interface; the decrypted password never leaves the main process. */
export class ObsCredentialVault {
  private value:Credential|null=null;
  private loaded=false;
  private error='';
  constructor(private store:SecretStore,private available:()=>boolean){}
  async load():Promise<void>{
    try{
      const saved=await this.store.load();
      if(saved===null)this.value=null;
      else {const v=JSON.parse(saved);if(!v||v.version!==1||Object.keys(v).some(k=>!['version','endpoint','password','autoConnect'].includes(k))||typeof v.password!=='string'||v.password.length>512||typeof v.autoConnect!=='boolean')throw new Error();
        this.value={version:1,endpoint:localEndpoint(v.endpoint,'obs'),password:v.password,autoConnect:v.autoConnect};}
      this.loaded=true;this.error='';
    }catch{this.loaded=false;this.value=null;this.error='Gespeicherter OBS-Zugang ist gesperrt oder nicht lesbar. Entsperren Sie den Schlüsselbund und versuchen Sie es erneut.';}
  }
  status():ObsCredentialStatus{return {saved:!!this.value,available:this.available(),autoConnect:this.value?.autoConnect===true,endpoint:this.value?.endpoint||'',error:this.error};}
  async save(endpoint:unknown,password:unknown,autoConnect:unknown):Promise<void>{
    if(!this.loaded||!this.available())throw new LiveFailure('Sicherer Speicher ist nicht verfügbar. Bestehende Zugangsdaten wurden nicht überschrieben.');
    if(typeof password!=='string'||password.length>512||typeof autoConnect!=='boolean')throw new LiveFailure('Ungültige Zugangsdaten.');
    const value:Credential={version:1,endpoint:localEndpoint(endpoint,'obs'),password,autoConnect};
    try{await this.store.save(JSON.stringify(value));}catch{throw new LiveFailure('OBS-Zugang konnte nicht sicher gespeichert werden.');}
    this.value=value;this.error='';
  }
  /** Endpoint-bound; credentials cannot be sent to a newly edited address. */
  passwordFor(endpoint:string,automatic=false):string|null{
    if(!this.loaded||!this.value||!this.available()||this.value.endpoint!==localEndpoint(endpoint,'obs')||(automatic&&!this.value.autoConnect))return null;
    return this.value.password;
  }
  async forget():Promise<void>{
    try{await this.store.clear();}catch{throw new LiveFailure('OBS-Zugang konnte nicht entfernt werden.');}
    this.value=null;this.loaded=true;this.error='';
  }
}
