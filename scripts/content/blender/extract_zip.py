"""Blender: --background --factory-startup --python-exit-code 1
--python scripts/content/blender/extract_zip.py -- <archive.zip> <folder>

Unpack a downloaded archive into its own folder with Blender's bundled
Python, which the character build needs anyway, so no system unzip is
required. A member that would land outside the folder is refused, and
nothing inside the archive runs.
"""
import os
import shutil
import sys
import zipfile

archive, folder = sys.argv[sys.argv.index("--") + 1:]
root = os.path.realpath(folder)
with zipfile.ZipFile(archive) as bundle:
    for member in bundle.infolist():
        target = os.path.realpath(os.path.join(root, member.filename))
        if os.path.commonpath([root, target]) != root:
            raise SystemExit(f"ERROR {member.filename} would land outside {folder}")
        if member.is_dir():
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with bundle.open(member) as source, open(target, "wb") as sink:
            shutil.copyfileobj(source, sink, 1 << 20)
