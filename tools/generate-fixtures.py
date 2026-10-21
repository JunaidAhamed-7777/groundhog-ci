#!/usr/bin/env python3
"""Capture real exceptions from deliberately broken, local-only fixture tasks.

These are controlled fault-injection runs, NOT production logs. The resulting
JUnit XML and provenance manifest are separate from the hand-authored retrieval
corpus. No network beyond local socket pairs / loopback is used.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import socket
import sqlite3
import tempfile
import time
import traceback
import xml.etree.ElementTree as ET


def missing_file(root: Path, variant: int) -> None:
    (root / f"configuration-{variant}.json").read_text()


def invalid_json(root: Path, variant: int) -> None:
    json.loads(['{"enabled": }', '{"items": [1,]}', '{"name": "unfinished}'][variant % 3])


def database_unique(root: Path, variant: int) -> None:
    with sqlite3.connect(':memory:') as database:
        database.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)')
        email = f'fixture-{variant}@example.invalid'
        database.execute('INSERT INTO users (email) VALUES (?)', (email,))
        database.execute('INSERT INTO users (email) VALUES (?)', (email,))


def connection_refused(root: Path, variant: int) -> None:
    # Reserve a loopback port without listening. The connection must fail;
    # keeping the socket bound prevents another process claiming that port.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reserved:
        reserved.bind(('127.0.0.1', 0))
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
            client.settimeout(0.2)
            client.connect(reserved.getsockname())


def read_timeout(root: Path, variant: int) -> None:
    reader, writer = socket.socketpair()
    try:
        reader.settimeout(0.01)
        reader.recv(1)  # The connected peer intentionally sends no bytes.
    finally:
        reader.close()
        writer.close()


def invalid_encoding(root: Path, variant: int) -> None:
    [b'\xffhello', b'hello\xfe', b'\x80world'][variant % 3].decode('utf-8')


FAULTS = [
    ('missing-file', missing_file, FileNotFoundError),
    ('invalid-json', invalid_json, json.JSONDecodeError),
    ('unique-constraint', database_unique, sqlite3.IntegrityError),
    ('connection-refused', connection_refused, ConnectionRefusedError),
    ('socket-read-timeout', read_timeout, TimeoutError),
    ('invalid-encoding', invalid_encoding, UnicodeDecodeError),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('tests/fixtures/generated'))
    parser.add_argument('--variants', type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.variants <= 100:
        parser.error('--variants must be between 1 and 100')
    args.output.mkdir(parents=True, exist_ok=True)
    created = dt.datetime.now(dt.timezone.utc).isoformat()
    suite = ET.Element('testsuite', name='Controlled local fault-injection fixtures', timestamp=created)
    manifest = {
        'schemaVersion': 1,
        'provenance': 'Actual captured Python exceptions from deliberate local fault injection; not production CI data.',
        'generatedAt': created,
        'generator': 'tools/generate-fixtures.py',
        'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'cases': [],
    }
    with tempfile.TemporaryDirectory(prefix='groundhog-fixture-') as temporary:
        root = Path(temporary)
        for fault_index, (label, operation, expected_exception) in enumerate(FAULTS):
            for variant in range(args.variants):
                case_id = f'capture-{fault_index + 1:02d}-{variant + 1:02d}'
                started = time.perf_counter()
                caught = None
                captured_traceback = ''
                try:
                    operation(root, variant)
                except expected_exception as error:
                    caught = error
                    captured_traceback = traceback.format_exc()
                if caught is None:
                    raise RuntimeError(f'Fixture {case_id} did not produce its expected exception; refusing to invent a failure.')
                elapsed = time.perf_counter() - started
                case = ET.SubElement(suite, 'testcase', name=case_id, classname='controlled_fixture', time=f'{elapsed:.6f}')
                failure = ET.SubElement(case, 'failure', type=type(caught).__name__, message=str(caught))
                failure.text = captured_traceback
                manifest['cases'].append({
                    'id': case_id,
                    'goldFaultFamily': label,
                    'variant': variant,
                    'exceptionType': type(caught).__name__,
                    'captured': True,
                    'elapsedSeconds': elapsed,
                })
    count = len(manifest['cases'])
    suite.set('tests', str(count))
    suite.set('failures', str(count))
    suite.set('errors', '0')
    ET.indent(suite, space='  ')
    target = args.output / 'captured.xml'
    ET.ElementTree(suite).write(target, encoding='utf-8', xml_declaration=True)
    manifest['reportSha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Captured {count} actual exceptions into {target}; provenance saved to manifest.json.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
