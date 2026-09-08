import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
spec = importlib.util.spec_from_file_location('verify_snapshot', Path(__file__).with_name('verify-snapshot.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotVerificationTest(unittest.TestCase):
    def archive(self, path, *, amount='1', file=b'pdf', duplicate=False, unsafe=False):
        with zipfile.ZipFile(path, 'w') as z:
            doc={'_id':'payment1','_creationTime':12,'amount':amount,'approved':True}
            line=json.dumps(doc)+'\n'
            z.writestr('disbursements/documents.jsonl',line * (2 if duplicate else 1))
            z.writestr('_storage/file1',file)
            if unsafe: z.writestr('../outside',b'bad')

    def test_exact_roundtrip_and_changed_record_or_file(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.zip';other=Path(directory)/'other.zip'
            self.archive(source);self.archive(other)
            self.assertEqual(module.compare(source,other)['records'],1)
            for options in [{'amount':'2'},{'file':b'changed'},{'duplicate':True},{'unsafe':True}]:
                self.archive(other,**options)
                with self.assertRaises(ValueError): module.compare(source,other)

    def test_corrupt_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.zip';source.write_bytes(b'incomplete snapshot')
            with self.assertRaises(zipfile.BadZipFile): module.snapshot(source)

if __name__=='__main__':unittest.main()
