/** Book names/aliases from the V107 handover. This parses references, not verse text. */
export const BIBLE_BOOKS:readonly (readonly [string,number,string])[]=[["1. Mose",50,"gen,1mo,1mose,genesis"],["2. Mose",40,"ex,2mo,2mose,exodus"],["3. Mose",27,"lev,3mo,3mose,levitikus"],["4. Mose",36,"num,4mo,4mose,numeri"],["5. Mose",34,"dtn,5mo,5mose,deuteronomium"],["Josua",24,"jos"],["Richter",21,"ri,richter"],["Rut",4,"rut,ruth"],["1. Samuel",31,"1sam"],["2. Samuel",24,"2sam"],["1. Könige",22,"1kön,1koe,1kon"],["2. Könige",25,"2kön,2koe,2kon"],["1. Chronik",29,"1chr"],["2. Chronik",36,"2chr"],["Esra",10,"esr"],["Nehemia",13,"neh"],["Esther",10,"est,ester"],["Hiob",42,"hi,hiob,ijob"],["Psalm",150,"ps,psalm,psalmen"],["Sprüche",31,"spr,sprüche,sprueche"],["Prediger",12,"pred,koh"],["Hoheslied",8,"hld,hohelied"],["Jesaja",66,"jes"],["Jeremia",52,"jer"],["Klagelieder",5,"klgl,klag"],["Hesekiel",48,"hes,ez"],["Daniel",12,"dan"],["Hosea",14,"hos"],["Joel",4,"joel"],["Amos",9,"am"],["Obadja",1,"obd"],["Jona",4,"jon"],["Micha",7,"mi"],["Nahum",3,"nah"],["Habakuk",3,"hab"],["Zefanja",3,"zef"],["Haggai",2,"hag"],["Sacharja",14,"sach"],["Maleachi",3,"mal"],["Matthäus",28,"mt,matth,matt"],["Markus",16,"mk,mark"],["Lukas",24,"lk,luk"],["Johannes",21,"joh,jh"],["Apostelgeschichte",28,"apg,act"],["Römer",16,"röm,roem,rom"],["1. Korinther",16,"1kor"],["2. Korinther",13,"2kor"],["Galater",6,"gal"],["Epheser",6,"eph"],["Philipper",4,"phil"],["Kolosser",4,"kol"],["1. Thessalonicher",5,"1thess,1th"],["2. Thessalonicher",3,"2thess,2th"],["1. Timotheus",6,"1tim"],["2. Timotheus",4,"2tim"],["Titus",3,"tit"],["Philemon",1,"phlm"],["Hebräer",13,"hebr,heb"],["Jakobus",5,"jak"],["1. Petrus",5,"1petr,1pt"],["2. Petrus",3,"2petr,2pt"],["1. Johannes",5,"1joh"],["2. Johannes",1,"2joh"],["3. Johannes",1,"3joh"],["Judas",1,"jud"],["Offenbarung",22,"offb,off,apk"]];
const norm=(s:string)=>s.toLocaleLowerCase('de-DE').replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u').replace(/ß/g,'ss').replace(/ae/g,'a').replace(/oe/g,'o').replace(/ue/g,'u').replace(/[.\s]/g,'');
export interface ParsedReference {reference:string;book:string;chapter:number;verse?:number;end?:number;following:boolean}
/** No guesses on ambiguous abbreviations, malformed ranges or trailing input. */
export function parseBibleReference(raw:string):ParsedReference|null {
  if(raw.length>500||/[\u0000-\u001f]/.test(raw))return null;
  const m=raw.trim().match(/^((?:[1-3]\.?\s*)?[^\d]+?)\s*(?:Kap(?:itel)?\.?\s*)?(\d{1,3})(?:\s*(?:(?:[,.:]|ab\s+Vers|Vers)\s*|\s+)(\d{1,3})(?:\s*[-–]\s*(\d{1,3})|\s*(ff?\.?))?)?\s*$/i);
  if(!m)return null;
  const key=norm(m[1]),matches=BIBLE_BOOKS.filter(b=>[b[0],...b[2].split(',')].some(k=>norm(k)===key));
  const candidates=matches.length?matches:BIBLE_BOOKS.filter(b=>key.length>=2&&norm(b[0]).startsWith(key));
  if(candidates.length!==1)return null;
  const [book,maxChapter]=candidates[0],chapter=Number(m[2]),verse=m[3]?Number(m[3]):undefined,end=m[4]?Number(m[4]):undefined,following=!!m[5]||/ab\s+Vers/i.test(raw);
  if(chapter<1||chapter>maxChapter||verse!==undefined&&(verse<1||verse>176)||end!==undefined&&(end<verse!||end>176))return null;
  const reference=`${book} Kap. ${chapter}`+(verse===undefined?'':following?` ab Vers ${verse}`:` Vers ${verse}${end===undefined?'':`–${end}`}`);
  return {reference,book,chapter,verse,end,following};
}
