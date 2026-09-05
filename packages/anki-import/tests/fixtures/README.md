# APKG interoperability fixtures

- `official-anki21.apkg` and `official-21b.apkg`: exported with the official Python/Rust Anki package `anki==25.9` (Anki 25.09), using `Collection.export_anki_package`, legacy on/off respectively.
- `official-updated.apkg`: same collection, with a renamed deck, moved card, removed note and new deck/card. GUIDs and deck IDs are shared with the other generated fixtures.
- `official-anki2.apkg`: original `pylib/tests/support/media.apkg` from [Anki commit 539054c34dccf8b89ca7ea9c9c40ecaf172de759](https://github.com/ankitects/anki/tree/539054c34dccf8b89ca7ea9c9c40ecaf172de759), distributed under Anki's GNU AGPL v3-or-later license. This is a genuine schema-11 `collection.anki2` package, not a renamed newer package.

Regenerate with Python 3.12, `pip install anki==25.9 zstandard==0.25.0`, then `python packages/anki-import/tests/generate-apkg-fixtures.py`. Regenerate the complete set together: generated GUIDs/IDs are assigned by Anki. The checked-in files are fixed test inputs. No personal collection data is included.

Generated cases cover Basic, reversed, optional reversed, typed answers, multiple Cloze ordinals, a conditional custom template, PNG and WAV media, and four chronological ratings per card. The latest package contains schema 18, protobuf metadata/configuration and zstd-compressed collection/media. The tests check decoded content, media and persisted scheduling, not just the filename.
