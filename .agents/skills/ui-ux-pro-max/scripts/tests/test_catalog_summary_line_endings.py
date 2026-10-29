"""Validate the shipped catalog snapshots independently of checkout line endings."""

import hashlib
import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / 'data'


class CatalogSummaryLineEndingsTest(unittest.TestCase):
    def test_shipped_snapshot_hashes_match_lf_and_crlf_checkouts(self):
        summary = json.loads((DATA / 'catalog-summary.json').read_text(encoding='utf-8'))
        for name, snapshot in summary['snapshots'].items():
            with self.subTest(name=name):
                source = (DATA / name).read_bytes().replace(b'\r\n', b'\n')
                self.assertEqual(hashlib.sha256(source).hexdigest(), snapshot['sha256'])
                crlf_checkout = source.replace(b'\n', b'\r\n')
                self.assertEqual(
                    hashlib.sha256(crlf_checkout.replace(b'\r\n', b'\n')).hexdigest(),
                    snapshot['sha256'],
                )


if __name__ == '__main__':
    unittest.main()
