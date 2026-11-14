#!/usr/bin/env python3
"""Reproducible build-time acquisition. Installed apps never download Bible text or fonts.
Sources are checksum-locked; a publisher update requires an explicit reviewed lock change.
VPL chapter/verse numbering is retained verbatim (not silently converted to a German canon).
"""
import argparse,hashlib,json,pathlib,re,shutil,urllib.request,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source',type=pathlib.Path,default=ROOT/'.content-cache');args=parser.parse_args()
args.source.mkdir(parents=True,exist_ok=True)
OUT=ROOT/'.generated';(OUT/'data/bibles').mkdir(parents=True,exist_ok=True);(OUT/'fonts').mkdir(parents=True,exist_ok=True);(OUT/'licenses').mkdir(parents=True,exist_ok=True)
manifest=json.loads((ROOT/'scripts/content-sources.json').read_text())
for source in manifest:
    file=args.source/source['name']
    if not file.exists():
        request=urllib.request.Request(source['source'],headers={'User-Agent':'Broadcast-CC-offline-content/1.0'})
        with urllib.request.urlopen(request,timeout=90) as response: payload=response.read(25000000)
        if len(payload)!=source['bytes'] or hashlib.sha256(payload).hexdigest()!=source['sha256']:raise RuntimeError('Source changed: '+source['name'])
        file.write_bytes(payload)
    if hashlib.sha256(file.read_bytes()).hexdigest()!=source['sha256']:raise RuntimeError('Checksum mismatch: '+source['name'])
    if file.suffix=='.ttf':shutil.copyfile(file,OUT/'fonts'/file.name)
    elif file.suffix in ('.html','.txt'):shutil.copyfile(file,OUT/'licenses'/file.name)
BOOKS='GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SOL ISA JER LAM EZE DAN HOS JOE AMO OBA JON MIC NAH HAB ZEP HAG ZEC MAL MAT MAR LUK JOH ACT ROM 1CO 2CO GAL EPH PHI COL 1TH 2TH 1TI 2TI TIT PHM HEB JAM 1PE 2PE 1JO 2JO 3JO JUD REV'.split()
COUNTS=[50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22]
ATTRIBUTIONS={
 'schlachter':'Schlachter 1951 · © Genfer Bibelgesellschaft · CC BY 4.0 · Quelle: eBible.org/deu1951 · eBible-Verszählung',
 'luther1912':'Luther 1912 · gemeinfrei · Quelle: eBible.org/deu1912 · eBible-Verszählung',
 'elberfelder1905':'Elberfelder 1905 · gemeinfrei · Quelle: eBible.org/deuelo · eBible-Verszählung'}
counts={}
for name,attribution in ATTRIBUTIONS.items():
    books=[{'chapters':[{'verses':[]} for _ in range(n)]} for n in COUNTS]
    with zipfile.ZipFile(args.source/(name+'.zip')) as archive:
        file=next(n for n in archive.namelist() if n.endswith('_vpl.txt'))
        text=archive.read(file).decode('utf-8-sig')
    total=0
    for line in text.splitlines():
        match=re.fullmatch(r'([A-Z0-9]{3}) (\d+):(\d+) (.*)',line)
        if not match:raise RuntimeError('Unrecognized source line')
        book,chapter,verse,body=match.groups();chapter=int(chapter);verse=int(verse)
        if book not in BOOKS or verse<1:raise RuntimeError('Unknown book or verse')
        verses=books[BOOKS.index(book)]['chapters'][chapter-1]['verses']
        if verses and verses[-1]['n']>=verse:raise RuntimeError('Duplicate or out-of-order verse')
        verses.append({'n':verse,'text':body,**({'omitted':True} if not body else {})});total+=1
    if sum(len(b['chapters']) for b in books)!=1189 or total<31000 or any(not c['verses'] for b in books for c in b['chapters']):raise RuntimeError('Incomplete Bible corpus')
    data={'translation':name,'attribution':attribution,'source':next(s['source'] for s in manifest if s['name']==name+'.zip'),'versification':'eBible VPL; Joel 3 Kapitel, Maleachi 4 Kapitel. Nummerierung und Wortlaut unverändert übernommen.','books':books}
    (OUT/'data/bibles'/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    counts[name]={'books':66,'chapters':1189,'verses':total}
    print(name,counts[name])
(OUT/'data/corpus-manifest.json').write_text(json.dumps(counts,indent=2)+'\n')
shutil.copyfile(ROOT/'scripts/content-sources.json',OUT/'licenses/source-manifest.json')
(OUT/'licenses/README.txt').write_text('Bibeltexte: Wortlaut und Verszählung der eBible-VPL-Dateien unverändert; nur maschinenlesbare JSON-Struktur erzeugt. Keine redaktionelle Korrektur. Joel hat hier 3 Kapitel und Maleachi 4; bei abweichender Druckausgabe die Stellenangabe prüfen.\nSchlachter 1951: Franz Eugen Schlachter / Genfer Bibelgesellschaft, Copyright 1951, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Luther 1912 und Elberfelder 1905: Public Domain gemäß den beigefügten Quellenangaben.\nInter und Literata: SIL Open Font License 1.1; vollständige Lizenzdateien beigefügt.\n',encoding='utf8')
