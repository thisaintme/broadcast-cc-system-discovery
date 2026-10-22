import {mkdir,open,readFile,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import type {JournalEntry,JournalPort} from './live-contract.ts';
/** Bounded local JSONL journal. Only caller-owned diagnostic strings; never raw OBS replies. */
export class LiveJournal implements JournalPort{
  private queue:Promise<void>=Promise.resolve();
  constructor(private file:()=>string,private maxBytes=1024*1024){}
  append(action:string,stage:string,detail:string):Promise<void>{
    const clean=(s:string,n:number)=>s.replace(/[\u0000-\u001f]/g,' ').slice(0,n);
    const row:JournalEntry={at:new Date().toISOString(),action:clean(action,80),stage:clean(stage,80),detail:clean(detail,600)};
    const job=this.queue.then(async()=>{
      const file=this.file();await mkdir(path.dirname(file),{recursive:true,mode:0o700});
      const size=await stat(file).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return 0;throw e;});
      if(size>=this.maxBytes){
        await rm(file+'.2',{force:true});
        try{await rename(file+'.1',file+'.2');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        await rename(file,file+'.1');
      }
      const handle=await open(file,'a',0o600);
      try{await handle.writeFile(JSON.stringify(row)+'\n');await handle.sync();}finally{await handle.close();}
    });
    this.queue=job.catch(()=>{});return job;
  }
  async entries():Promise<JournalEntry[]>{
    await this.queue;const rows:JournalEntry[]=[];
    for(const suffix of ['.2','.1','']){
      const content=await readFile(this.file()+suffix,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
      for(const line of content.split('\n'))try{
        const r=JSON.parse(line);if(['at','action','stage','detail'].every(k=>typeof r[k]==='string'))rows.push({at:r.at,action:r.action,stage:r.stage,detail:r.detail});
      }catch{/* Ignore only an incomplete final row, never execute log content. */}
    }
    return rows.slice(-250).reverse();
  }
}
