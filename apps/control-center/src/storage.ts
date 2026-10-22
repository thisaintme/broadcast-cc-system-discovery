import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {blankWorkspace} from './model.ts';
import type {Workspace} from './model.ts';
import {validateWorkspace} from './workspace.ts';
export async function loadWorkspace(file:string):Promise<Workspace> {
  try {return validateWorkspace(JSON.parse(await readFile(file,'utf8')),true);}
  catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return blankWorkspace();throw new Error('Saved workspace is invalid. It was not overwritten; import a valid workspace to recover.');}
}
export async function saveWorkspace(file:string,w:Workspace):Promise<void> {
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.tmp';
  try {
    await writeFile(tmp,JSON.stringify(validateWorkspace(w),null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    await rename(tmp,file);
  } finally {await rm(tmp,{force:true}).catch(()=>{});}
}
