import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {connections,localEndpoint,object,text} from './workspace.ts';
import type {Connection} from './model.ts';
const exec=promisify(execFile);
const LIMIT=8*1024*1024;
/** An internal export is opt-in and read in memory. Never log raw bodies or parse errors. */
export function parseCompanionExport(body:string):{build:string;connections:Connection[]} {
  if(Buffer.byteLength(body)>LIMIT)throw new Error('Companion export exceeds the 8 MiB limit.');
  let raw:unknown;
  try{raw=JSON.parse(body.replace(/^\uFEFF/,''));}catch{throw new Error('Companion returned a non-JSON response. Response body withheld.');}
  const data=object(raw);
  if(data.type!=='full' || !data.instances || !data.companionBuild)throw new Error('Response is not a supported Companion full export.');
  return {build:text(data.companionBuild),connections:connections(data.instances)};
}
export async function inspectCompanion(endpoint:string):Promise<{build:string;connections:Connection[]}> {
  const url=localEndpoint(endpoint,'companion')+'/int/export/full?format=json';
  const marker='\nBROADCAST_CC_HTTP_STATUS:';
  let stdout:string;
  try {
    const result=await exec('/usr/bin/curl',[
      '--disable','--silent','--show-error','--noproxy','*','--proto','=http,https',
      '--connect-timeout','2','--max-time','8','--max-filesize',String(LIMIT),
      '--write-out',marker+'%{http_code}','--url',url,
    ],{encoding:'utf8',maxBuffer:LIMIT+1024,timeout:10000});
    stdout=result.stdout;
  } catch {throw new Error('Companion export could not be retrieved. Check that Companion is running and its base port is correct.');}
  const index=stdout.lastIndexOf(marker), code=stdout.slice(index+marker.length).trim();
  if(index<0 || code!=='200')throw new Error(`Companion HTTP ${/^\d{3}$/.test(code)?code:'unknown'}. Redirects are not followed.`);
  return parseCompanionExport(stdout.slice(0,index));
}
