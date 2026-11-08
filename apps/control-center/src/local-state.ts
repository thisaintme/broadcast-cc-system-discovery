import {mkdir,open,readFile,rename,stat,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
/** Fixed main-process paths only. Never call this with renderer-supplied filenames. */
export async function readLocalJson(file:string,maxBytes=1024*1024):Promise<unknown|null>{
  try{if((await stat(file)).size>maxBytes)throw new Error('Local data exceeds its limit.');return JSON.parse(await readFile(file,'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('Local data could not be read. It has not been overwritten.');}
}
export async function writeLocalJson(file:string,value:unknown):Promise<void>{
  const dir=dirname(file),temp=`${file}.${randomUUID()}.tmp`;let handle;
  try{await mkdir(dir,{recursive:true,mode:0o700});handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();await handle.close();handle=undefined;await rename(temp,file);
    if(process.platform!=='win32'){const directory=await open(dir,'r');try{await directory.sync();}finally{await directory.close();}}
  }finally{if(handle)await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});}
}
