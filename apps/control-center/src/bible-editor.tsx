import React,{useState} from 'react';
import {parsePassage} from './bible-reference.ts';
export function BibleEditor({initial='',editing=false,locked,save}:{initial?:string;editing?:boolean;locked:boolean;save:(reference:string)=>Promise<void>}){
 const [text,setText]=useState(initial),[free,setFree]=useState(!!initial&&parsePassage(initial).status!=='recognized');
 const result=parsePassage(text),reference=free?text.trim():result.reference;
 return <form onSubmit={e=>{e.preventDefault();if(reference&&!locked)void save(reference);}}>
  <label>Bibelstelle<input id="live-bible-reference" autoComplete="off" value={text} maxLength={500} onChange={e=>setText(e.target.value)} placeholder="1 Kor 4, 12ff" aria-describedby="bible-reference-help bible-reference-preview"/></label>
  <div id="bible-reference-preview" className="bible-reference-preview" role="status"><strong>{reference||result.message}</strong>{!free&&result.status==='recognized'&&<small>{result.message}</small>}</div>
  {!free&&result.status==='ambiguous'&&<div className="bible-suggestions" aria-label="Passende Bibelstellen">{result.suggestions.map(s=><button type="button" key={s.book} onClick={()=>setText(s.reference)}>{s.reference}</button>)}</div>}
  <label className="check-label"><input id="bible-reference-free" type="checkbox" checked={free} onChange={e=>setFree(e.target.checked)}/>Freie Angabe unverändert verwenden</label>
  <p id="bible-reference-help">{editing?'Ändert nur diesen Warteschlangen-Eintrag. Eine laufende Einblendung bleibt unverändert. Geänderter Text kann anschließend erneut eingeblendet werden.':'Vormerken schaltet kein Bild um. Die Szenentaste zeigt die nächste ausgewählte Stelle.'} Abkürzungen und kleine Tippfehler werden lokal erkannt. Keine Prüfung des Versinhalts oder der übersetzungsspezifischen Verszählung.</p>
  <button id={editing?'save-bible-reference':'add-bible-reference'} className="primary" disabled={locked||!reference}>{editing?'Änderung speichern':'Zur Warteschlange hinzufügen'}</button>
 </form>;
}
