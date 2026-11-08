/** Local German reference recognition. No network, Bible text, or live-output writes. */
export interface BibleBook {name:string;chapters:number;aliases:string[]}
const rows: [string,number,string][] = [
 ['1. Mose',50,'1mo|1mos|1mose|gen|genesis'],['2. Mose',40,'2mo|2mos|2mose|ex|exod|exodus'],['3. Mose',27,'3mo|3mos|3mose|lev|levitikus'],['4. Mose',36,'4mo|4mos|4mose|num|numeri'],['5. Mose',34,'5mo|5mos|5mose|dtn|deut|deuteronomium'],
 ['Josua',24,'jos'],['Richter',21,'ri|richt'],['Rut',4,'ruth'],['1. Samuel',31,'1sam|1sa'],['2. Samuel',24,'2sam|2sa'],['1. Könige',22,'1koen|1kon|1kö|1kön'],['2. Könige',25,'2koen|2kon|2kö|2kön'],['1. Chronik',29,'1chr|1chron'],['2. Chronik',36,'2chr|2chron'],['Esra',10,'esr'],['Nehemia',13,'neh'],['Ester',10,'est|esther'],['Hiob',42,'hi|ijob|job'],['Psalm',150,'ps|psa|psalm|psalmen'],['Sprüche',31,'spr|sprueche|sprichwörter'],['Prediger',12,'pred|koh|kohelet'],['Hohelied',8,'hld|hoh'],['Jesaja',66,'jes|jesa'],['Jeremia',52,'jer'],['Klagelieder',5,'klgl|klag'],['Hesekiel',48,'hes|hesek|ez|ezechiel'],['Daniel',12,'dan'],['Hosea',14,'hos'],['Joel',4,'joe'],['Amos',9,'am'],['Obadja',1,'ob|obad'],['Jona',4,'jon'],['Micha',7,'mi|mich'],['Nahum',3,'nah'],['Habakuk',3,'hab'],['Zefanja',3,'zef|zeph|zephanja'],['Haggai',2,'hag'],['Sacharja',14,'sach|sachja'],['Maleachi',4,'mal'],
 ['Matthäus',28,'mt|mat|matt|matth'],['Markus',16,'mk|mar|mark'],['Lukas',24,'lk|luk|lu'],['Johannes',21,'joh|johann|jn'],['Apostelgeschichte',28,'apg|apost|apostel'],['Römer',16,'rom|röm|roem|roe'],['1. Korinther',16,'1kor|1korinth|1cor'],['2. Korinther',13,'2kor|2korinth|2cor'],['Galater',6,'gal'],['Epheser',6,'eph'],['Philipper',4,'phil|php'],['Kolosser',4,'kol|col'],['1. Thessalonicher',5,'1thess|1thes'],['2. Thessalonicher',3,'2thess|2thes'],['1. Timotheus',6,'1tim'],['2. Timotheus',4,'2tim'],['Titus',3,'tit'],['Philemon',1,'phlm|philem'],['Hebräer',13,'hebr|heb|hebraeer'],['Jakobus',5,'jak'],['1. Petrus',5,'1petr|1pet'],['2. Petrus',3,'2petr|2pet'],['1. Johannes',5,'1joh|1jn'],['2. Johannes',1,'2joh|2jn'],['3. Johannes',1,'3joh|3jn'],['Judas',1,'jud'],['Offenbarung',22,'offb|off|offenb|apokalypse']
];
const key=(s:string)=>s.toLowerCase().replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u').replace(/ß/g,'ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
export const BIBLE_BOOKS:BibleBook[]=rows.map(([name,chapters,aliases])=>({name,chapters,aliases:[...new Set([key(name),...aliases.split('|').map(key)])]}));
export interface PassageSuggestion {book:string;reference:string;fuzzy:boolean}
export interface PassageResult {status:'recognized'|'ambiguous'|'invalid';reference:string;message:string;suggestions:PassageSuggestion[]}
function distance(a:string,b:string):number {
 const d=Array.from({length:a.length+1},()=>Array<number>(b.length+1).fill(0));
 for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
  d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
 }return d[a.length][b.length];
}
export function parsePassage(input:string):PassageResult {
 const invalid=(message:string):PassageResult=>({status:'invalid',reference:'',message,suggestions:[]});
 if(typeof input!=='string'||input.length>500||/[\u0000-\u001f]/.test(input))return invalid('Bitte eine kurze, einzeilige Bibelstelle eingeben.');
 const text=input.trim().replace(/^(III|II|I)\.?\s+(?=[A-Za-zÄÖÜäöü])/i,m=>`${m.trim().replace('.','').length} `).replace(/[–—]/g,'-');
 const m=/^([1-5]?\s*\.?\s*[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .]*?)\s*\.?\s*(?:Kap(?:itel)?\.?\s*)?(\d{1,3})(?:\s*(?:[,.:]\s*|\s+)(?:(ab)\s+)?(?:Vers(?:e)?\s*)?(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*(ff|f)?\.?)?\s*$/i.exec(text);
 if(!m)return invalid('Zum Beispiel: 1 Kor 4, 12ff · Joh 3:16–18 · Psalm 23.');
 const term=key(m[1]),chapter=Number(m[2]),verse=m[4]?Number(m[4]):null,end=m[5]?Number(m[5]):null,following=m[6]?.toLowerCase(),from=!!m[3]||following==='ff';
 if(chapter<1||(verse!==null&&(verse<1||verse>176))||(end!==null&&(end<verse!||end>176))||(end!==null&&(following||from))||(m[3]&&following==='f')||(following==='f'&&verse===176))return invalid('Kapitel und Verse müssen positiv und der Versbereich aufsteigend sein.');
 const exact=BIBLE_BOOKS.filter(b=>b.aliases.includes(term));
 const numbered=term.match(/^\d/)?.[0]||'';
 const eligible=BIBLE_BOOKS.filter(b=>(key(b.name).match(/^\d/)?.[0]||'')===numbered);
 let matches=exact.map(book=>({book,fuzzy:false}));
 if(!matches.length&&term.replace(/^\d/,'').length>=2)matches=eligible.filter(b=>b.aliases.some(a=>a.startsWith(term))).map(book=>({book,fuzzy:true}));
 if(!matches.length&&term.replace(/^\d/,'').length>=4){
  const scored=eligible.map(book=>({book,score:Math.min(...book.aliases.filter(a=>a.length>=4).map(a=>distance(term,a)))}));
  const best=Math.min(...scored.map(x=>x.score)),limit=term.length>=8?2:1;
  if(best<=limit)matches=scored.filter(x=>x.score===best).map(({book})=>({book,fuzzy:true}));
 }
 if(!matches.length)return invalid('Buch nicht eindeutig erkannt. Bitte den Namen ausschreiben oder die freie Angabe wählen.');
 const suggestions=matches.filter(({book})=>chapter<=book.chapters).map(({book,fuzzy})=>({book:book.name,fuzzy,reference:`${book.name} Kap. ${chapter}`+(verse===null?'':from?` ab Vers ${verse}`:end!==null?` Vers ${verse}–${end}`:following==='f'?` Vers ${verse}–${verse+1}`:` Vers ${verse}`)}));
 if(!suggestions.length)return invalid('Dieses Kapitel ist für das erkannte Buch nicht vorhanden. Bei abweichender Zählung die freie Angabe wählen.');
 if(suggestions.length>1)return {status:'ambiguous',reference:'',message:'Mehrere Bücher passen. Bitte die gewünschte Stelle auswählen.',suggestions};
 return {status:'recognized',reference:suggestions[0].reference,message:suggestions[0].fuzzy?'Vorschlag erkannt – vor dem Speichern prüfen.':'Bibelstelle erkannt.',suggestions};
}
