"""Run with Python containing anki==25.9 and zstandard. Uses the official exporter."""
import base64
import tempfile
import urllib.request
from pathlib import Path
from anki.collection import Collection
from anki.import_export_pb2 import ExportAnkiPackageOptions

out = Path(__file__).parent / 'fixtures'
out.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as temporary:
    col = Collection(str(Path(temporary) / 'collection.anki2'))
    deck_a = col.decks.id('APKG英語')
    deck_b = col.decks.id('APKG日本史')
    col.media.write_data('pixel.png', base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='))
    col.media.write_data('tone.wav', b'RIFF' + (36).to_bytes(4,'little') + b'WAVEfmt ' + (16).to_bytes(4,'little') + bytes.fromhex('01000100401f0000803e000002001000') + b'data' + bytes(4))
    for name, front, back, deck in [
        ('Basic', 'apple<img src="pixel.png">[sound:tone.wav]', 'りんご', deck_a),
        ('Basic (and reversed card)', '東京', 'Tokyo', deck_a),
        ('Basic (optional reversed card)', '大阪', 'Osaka', deck_a),
        ('Basic (type in the answer)', '日本の首都', '東京', deck_a),
        ('Cloze', '{{c1::鎌倉幕府}}は{{c1::1192年}}に成立、{{c2::日本史}}', '補足', deck_b),
    ]:
        model = col.models.by_name(name)
        note = col.new_note(model)
        note.fields[0], note.fields[1] = front, back
        if len(note.fields) > 2: note.fields[2] = 'yes'
        note.tags = ['fixture']
        col.add_note(note, deck)
    custom = col.models.copy(col.models.by_name('Basic'))
    custom['name'] = 'Custom'
    custom['tmpls'][0]['qfmt'] = '{{#Front}}<div class="custom">{{Front}}</div>{{/Front}}'
    custom['tmpls'][0]['afmt'] = '{{FrontSide}}<hr>{{hint:Back}}'
    custom['css'] = '.card { color: rgb(12, 34, 56); } .custom { font-weight: bold; }'
    col.models.save(custom)
    note = col.new_note(custom)
    note.fields = ['独自カード', '解答']
    col.add_note(note, deck_b)
    for card_id in col.find_cards(''):
        for index, ease in enumerate([1, 2, 3, 4]):
            stamp = 1700000000000 + card_id % 100000 * 10 + index * 86400000
            col.db.execute('insert into revlog values (?,?,?,?,?,?,?,?,?)', stamp, card_id, -1, ease, 1, 1, 2500, 1000, [0,0,1,2][index])
    for legacy, filename in [(True, 'official-anki21.apkg'), (False, 'official-21b.apkg')]:
        col.export_anki_package(out_path=str(out / filename), options=ExportAnkiPackageOptions(with_scheduling=True,with_media=True,with_deck_configs=True,legacy=legacy), limit=None)
    # Preserve the genuine anki2 package published by Anki's upstream tests.
    urllib.request.urlretrieve('https://raw.githubusercontent.com/ankitects/anki/539054c34dccf8b89ca7ea9c9c40ecaf172de759/pylib/tests/support/media.apkg', out / 'official-anki2.apkg')
    col.decks.rename(deck_a, 'APKG語彙')
    moving = col.find_cards('note:"Basic (type in the answer)"')
    col.set_deck(moving, deck_b)
    col.remove_notes(col.find_notes('note:"Basic (and reversed card)"'))
    added = col.new_note(col.models.by_name('Basic'))
    added.fields = ['追加問題', '追加解答']
    col.add_note(added, col.decks.id('追加deck'))
    col.export_anki_package(out_path=str(out / 'official-updated.apkg'), options=ExportAnkiPackageOptions(with_scheduling=True,with_media=True,legacy=False), limit=None)
    col.close()
