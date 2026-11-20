import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BIBLE_BOOKS,parseBibleReference} from './bible-reference.ts';
import {TRANSLATIONS,parseSongs} from './presentation-model.ts';
import type {BibleChapter,Song,Translation,MediaItem} from './presentation-model.ts';

export interface BibleData {translation:Translation;attribution:string;source:string;books:{chapters:{verses:{n:number;text:string;omitted?:boolean}[]}[]}[]}
/** Immutable, bundled Bible corpus. Input is never fetched from a renderer-provided URL. */
export class ContentLibrary {
  private cache=new Map<Translation,Promise<BibleData>>();
  private songs:Song[]=[];
  private corrupt=false;
  constructor(private readonly dataDirectory:string,private readonly userDirectory:string){}
  async load():Promise<void>{
    try{this.songs=parseSongs(JSON.parse(await readFile(path.join(this.userDirectory,'songs.json'),'utf8')));}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'){this.corrupt=true;throw new Error('Die Liederdatei ist nicht lesbar. Sie wurde nicht überschrieben.');}}
  }
  async bible(translation:Translation):Promise<BibleData>{
    if(!Object.hasOwn(TRANSLATIONS,translation))throw new Error('Unbekannte Bibelausgabe.');
    let existing=this.cache.get(translation);if(existing)return existing;
    existing=(async()=>{const raw=JSON.parse(await readFile(path.join(this.dataDirectory,'bibles',translation+'.json'),'utf8')) as BibleData;
      if(raw.translation!==translation||!raw.attribution||!Array.isArray(raw.books)||raw.books.length!==66)throw new Error('Die lokale Bibelausgabe ist unvollständig.');
      for(let b=0;b<66;b++){
        if(raw.books[b].chapters.length!==(b===28?3:b===38?4:BIBLE_BOOKS[b][1]))throw new Error('Die lokale Bibelausgabe enthält eine falsche Kapitelzahl.');
        for(const chapter of raw.books[b].chapters){let previous=0;if(!Array.isArray(chapter.verses)||!chapter.verses.length)throw new Error('Ein Kapitel fehlt.');for(const v of chapter.verses){if(!Number.isInteger(v.n)||v.n<=previous||typeof v.text!=='string'||(!v.text.trim()&&v.omitted!==true))throw new Error('Ein Vers ist ungültig.');previous=v.n;}}
      }
      return raw;})();this.cache.set(translation,existing);try{return await existing;}catch(e){this.cache.delete(translation);throw e;}
  }
  async chapter(translation:Translation,book:number,chapter:number):Promise<BibleChapter>{
    if(!Number.isInteger(book)||book<0||book>=66||!Number.isInteger(chapter)||chapter<1||chapter>(book===28?3:book===38?4:BIBLE_BOOKS[book][1]))throw new Error('Bitte ein gültiges Buch und Kapitel auswählen.');
    const data=await this.bible(translation);
    return {translation,book,name:BIBLE_BOOKS[book][0],chapter,verses:structuredClone(data.books[book].chapters[chapter-1].verses),attribution:data.attribution};
  }
  async reference(reference:string,translation:Translation):Promise<{chapter:BibleChapter;verse:number;reference:string}>{
    const parsed=parseBibleReference(reference);if(!parsed)throw new Error('Die Bibelstelle ist nicht eindeutig. Bitte Buch, Kapitel und Vers prüfen.');
    const book=BIBLE_BOOKS.findIndex(b=>b[0]===parsed.book),chapter=await this.chapter(translation,book,parsed.chapter);
    const verse=parsed.verse??1;
    if(!chapter.verses.some(v=>v.n===verse)||(parsed.end&&!chapter.verses.some(v=>v.n===parsed.end)))throw new Error('Dieser Vers ist in der gewählten Ausgabe nicht vorhanden.');
    return {chapter,verse,reference:parsed.reference};
  }
  search(q:string):{id:string;number:string;title:string;pages:number}[]{
    const query=String(q).slice(0,200).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de-DE');
    return this.songs.filter(s=>(s.number+' '+s.title).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de-DE').includes(query)).slice(0,100).map(s=>({id:s.id,number:s.number,title:s.title,pages:s.order.length}));
  }
  song(id:string):Song{const found=this.songs.find(s=>s.id===id);if(!found)throw new Error('Das ausgewählte Lied fehlt in der Liederdatei.');return structuredClone(found);}
  async importSongs(raw:unknown):Promise<number>{
    if(this.corrupt)throw new Error('Die vorhandene Liederdatei ist beschädigt. Bitte zuerst sichern und reparieren.');
    const songs=parseSongs(raw);await mkdir(this.userDirectory,{recursive:true,mode:0o700});const file=path.join(this.userDirectory,'songs.json');
    await writeFile(file+'.tmp',JSON.stringify({songs})+'\n',{encoding:'utf8',mode:0o600});await rename(file+'.tmp',file);this.songs=songs;return songs.length;
  }
  /** Caller decodes and re-encodes the chosen image; arbitrary original bytes are never served. */
  async saveImage(png:Buffer,name:string,kind:'image'|'logo'):Promise<MediaItem>{
    if(png.length>12*1024*1024||png.length<8||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Das Bild ist zu groß oder ungültig.');
    const id=createHash('sha256').update(png).digest('hex'),file=id+'.png';const folder=path.join(this.userDirectory,'media');await mkdir(folder,{recursive:true,mode:0o700});
    await writeFile(path.join(folder,file),png,{mode:0o600});return {id,name:name.replace(/[\u0000-\u001f]/g,'').slice(0,100)||'Bild',file,kind};
  }
  get count():number{return this.songs.length;}
}
