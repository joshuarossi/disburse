#!/usr/bin/env python3
"""Compare Convex snapshot round trips without logging record values or secrets.

Reads archives in place; never extracts, imports or changes a deployment.
Exit nonzero on corruption, missing/changed records, duplicate IDs, or file loss.
"""
import argparse
import hashlib
import json
from pathlib import PurePosixPath
import sys
import zipfile

MAX_EXPANDED = 512 * 1024 * 1024


def snapshot(path):
    tables, files = {}, {}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if sum(item.file_size for item in entries) > MAX_EXPANDED:
            raise ValueError('Snapshot exceeds the 512 MiB verification limit')
        names = [entry.filename for entry in entries]
        if len(set(names)) != len(names):
            raise ValueError('Duplicate archive entries')
        for entry in entries:
            name = entry.filename
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                raise ValueError('Invalid archive path')
            if entry.is_dir():
                continue
            data = archive.read(entry)  # CRC is verified by zipfile.
            if name.endswith('/documents.jsonl'):
                table = name.split('/')[0]
                if table == '_tables':  # Deployment-local table metadata.
                    continue
                docs = {}
                for line in data.splitlines():
                    if not line.strip():
                        continue
                    doc = json.loads(line)
                    identifier = doc.get('_id')
                    if not identifier or identifier in docs:
                        raise ValueError(f'Invalid or duplicate record identity in {table}')
                    canonical = json.dumps(doc, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
                    docs[identifier] = hashlib.sha256(canonical.encode()).hexdigest()
                tables[table] = docs
            elif name.startswith('_storage/'):
                files[name] = hashlib.sha256(data).hexdigest()
            elif name != 'README.md' and not name.endswith('/generated_schema.jsonl'):
                raise ValueError('Unexpected snapshot archive entry')
    if not tables:
        raise ValueError('No snapshot tables found')
    return tables, files


def compare(source, restored):
    original_tables, original_files = snapshot(source)
    restored_tables, restored_files = snapshot(restored)
    # Convex may omit empty tables; record-preserving equivalence is sufficient.
    changed = [table for table in original_tables.keys() | restored_tables.keys()
               if original_tables.get(table, {}) != restored_tables.get(table, {})]
    if changed:
        raise ValueError('Record values or identities differ in: ' + ', '.join(sorted(changed)))
    if original_files != restored_files:
        raise ValueError('Stored files are missing or their bytes differ')
    return {'result': 'verified', 'records': sum(map(len, original_tables.values())),
            'nonemptyTables': sum(bool(docs) for docs in original_tables.values()),
            'storedFiles': len(original_files),
            'scope': 'Exact IDs, creation times, record values and stored-file bytes; no chain or scheduler rollback.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('restored')
    args = parser.parse_args()
    try:
        print(json.dumps(compare(args.source, args.restored)))
    except (ValueError, zipfile.BadZipFile, OSError, KeyError, json.JSONDecodeError) as error:
        print('Snapshot verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
