"""Independent source inventory and Anki 25.9 render samples. Inputs are never modified.
Usage: python corpus-oracle.py <cache-directory> [id ...]
Requires anki==25.9, zstandard==0.25.0. Outputs stay in the ignored corpus cache.
"""
import hashlib
import json
import re
import sqlite3
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path
import zstandard
from anki.collection import Collection
from anki.import_export_pb2 import MediaEntries, ImportAnkiPackageRequest, ImportAnkiPackageOptions

directory = Path(sys.argv[1])
paths = [directory / f'{id}.apkg' for id in sys.argv[2:]] or sorted(directory.glob('*.apkg'))
for path in paths:
    try:
        with zipfile.ZipFile(path) as archive:
            name = next(n for n in ['collection.anki21b', 'collection.21b', 'collection.anki21', 'collection.anki2'] if n in archive.namelist())
            raw = archive.read(name)
            if name.endswith('21b'):
                raw = zstandard.ZstdDecompressor().decompress(raw, max_output_size=512*1024*1024)
            media_raw = archive.read('media') if 'media' in archive.namelist() else b'{}'
            if name.endswith('21b'):
                media_entries = MediaEntries.FromString(zstandard.ZstdDecompressor().decompress(media_raw,max_output_size=50*1024*1024))
                media_map = {str(e.legacy_zip_filename if e.HasField('legacy_zip_filename') else i):e.name for i,e in enumerate(media_entries.entries)}
            else:
                media_map = json.loads(media_raw)
        with tempfile.TemporaryDirectory() as temporary:
            collection = Path(temporary) / 'collection.anki2'
            collection.write_bytes(raw)
            db = sqlite3.connect(collection)
            schema = db.execute('select ver from col').fetchone()[0]
            cards = db.execute('select c.id,c.nid,c.did,c.ord,n.guid,n.mid from cards c join notes n on n.id=c.nid order by c.id').fetchall()
            report = {'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'collection':name,'schema':schema,'notes':db.execute('select count(*) from notes').fetchone()[0],'cards':db.execute('select count(*) from cards').fetchone()[0],'byNotetype':dict(Counter(str(c[5]) for c in cards))}
            db.close()
            col = Collection(str(collection))
            with zipfile.ZipFile(path) as media_archive:
                for key,filename in media_map.items():
                    if Path(filename).name != filename or '\\' in filename or filename in ('','.','..'):
                        raise ValueError('Unsafe media filename')
                    data = media_archive.read(key)
                    if name.endswith('21b'):
                        data = zstandard.ZstdDecompressor().decompress(data,max_output_size=50*1024*1024)
                    (Path(col.media.dir()) / filename).write_bytes(data)
            models = col.models.all()
            report['models'] = [{'id':str(m['id']),'name':m['name'],'kind':m['type'],'fields':[f['name'] for f in m['flds']],'templates':[{'ord':t['ord'],'front':t['qfmt'],'back':t['afmt']} for t in m['tmpls']]} for m in models]
            report['decks'] = [{'id':str(d['id']),'name':d['name']} for d in col.decks.all()]
            chosen = []
            groups = Counter()
            for card in cards:
                group = (card[5],card[3])
                if groups[group] < 2:
                    chosen.append(card)
                    groups[group] += 1
            note_fields = dict(col.db.all('select id,flds from notes'))
            patterns = {'mathjax':r'\\[\[(]', 'latex':r'\[(?:latex|\$)', 'cloze':r'\{\{c\d+::', 'ruby':r'<ruby|\[[ぁ-ゖァ-ヺ]+\]', 'table':r'<table', 'code':r'<pre|<code', 'sound':r'\[sound:', 'image':r'<img', 'rtl':r'[\u0590-\u08ff]', 'script':r'<script'}
            features = {nid:[name for name, pattern in patterns.items() if re.search(pattern, value)] for nid,value in note_fields.items()}
            covered = set()
            for card in cards:
                for feature in features.get(card[1],[]):
                    if feature not in covered:
                        if card not in chosen: chosen.append(card)
                        covered.add(feature)
            random_sample = sorted(cards,key=lambda c:hashlib.sha256(str(c[0]).encode()).digest())[:8]
            chosen = (chosen + [c for c in random_sample if c not in chosen])[:40]
            samples = []
            for card_id,nid,did,ordinal,guid,mid in chosen:
                card = col.get_card(card_id)
                front, back = card.question(), card.answer()
                rendered_features = [kind for kind, pattern in patterns.items() if re.search(pattern, front+back)]
                if re.search(r'<img[^>]+\.svg',front+back): rendered_features.append('svg-image')
                if re.search(r'<img[^>]+\.(?:png|jpg|jpeg|gif|webp)',front+back): rendered_features.append('raster-image')
                if '[[type:' in front: rendered_features.append('type-answer')
                if '[anki:play:' in front+back: rendered_features.append('sound')
                samples.append({'id':str(card_id),'key':f'{guid}:{ordinal}','mid':str(mid),'ordinal':ordinal,'features':features.get(nid,[]),'renderFeatures':rendered_features,'fields':dict(col.get_note(nid).items()),'front':front,'back':back})
            report['samples'] = samples
            col.close()
            if len({(card[4],card[3]) for card in cards}) != len(cards):
                target = Collection(str(Path(temporary) / 'native-import.anki2'))
                target.import_anki_package(ImportAnkiPackageRequest(package_path=str(path.resolve()),options=ImportAnkiPackageOptions(with_scheduling=True,with_deck_configs=True,merge_notetypes=True)))
                report['nativeImportCards'] = target.db.scalar('select count(*) from cards')
                target.close()
        (directory / f'{path.stem}.oracle.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'id':path.stem,'schema':schema,'cards':report['cards'],'samples':len(samples)},ensure_ascii=False),flush=True)
    except Exception as error:
        print(json.dumps({'id':path.stem,'error':str(error)}),flush=True)
