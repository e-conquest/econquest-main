"""Isolated gdeltPyR archive decoder; stdin ZIP, stdout lossless string rows."""

import contextlib
import csv
import io
import json
import sys
import zipfile
from importlib.metadata import distribution
from types import SimpleNamespace
from unittest.mock import patch

MAX_COMPRESSED = 8 * 1024 * 1024
MAX_EXPANDED = 32 * 1024 * 1024
MAX_ROWS = 50000


def decode(content):
    if len(content) > MAX_COMPRESSED:
        raise ValueError("GDELT compressed archive exceeds limit")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        members = archive.infolist()
        if (len(members) != 1 or members[0].is_dir() or members[0].flag_bits & 1 or
            members[0].file_size > MAX_EXPANDED or members[0].compress_size > MAX_COMPRESSED):
            raise ValueError("GDELT archive layout/expanded byte limit invalid")
        text = archive.read(members[0]).decode("utf-8-sig")
    if "\x00" in text:
        raise ValueError("GDELT NUL in source TSV")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE, strict=True))
    if len(rows) > MAX_ROWS or any(len(row) != 61 for row in rows):
        raise ValueError("GDELT malformed TSV or archive row limit exceeded")
    if not rows:
        return []
    import pandas as pd
    package = distribution("gdelt")
    bundled = {}
    for file in package.files or []:
        if str(file).endswith(("/cameoCodes.json", "/events2.csv")):
            bundled[str(file).rsplit("/", 1)[-1]] = package.locate_file(file).read_bytes()
    if set(bundled) != {"cameoCodes.json", "events2.csv"}:
        raise ValueError("GDELT bundled package metadata unavailable")

    def local_import_metadata(url, **kwargs):
        if url != "https://raw.githubusercontent.com/linwoodc3/gdeltPyR/master/utils/schema_csvs/cameoCodes.json":
            raise ValueError("GDELT unexpected import-time network request")
        return SimpleNamespace(content=bundled["cameoCodes.json"])

    # Package imports may download metadata; intercept locally inside this key-free subprocess only.
    with patch("requests.get", local_import_metadata), contextlib.redirect_stdout(io.StringIO()):
        import gdelt.parallel as library

    def local_archive(url, **kwargs):
        if url != "https://data.gdeltproject.org/gdeltv2/verified.export.CSV.zip":
            raise ValueError("GDELT library request outside verified local archive")
        return SimpleNamespace(status_code=200, content=content)

    def strict_read_csv(buffer, **kwargs):
        return pd.read_csv(buffer, compression="zip", sep="\t", header=None, dtype=str,
                           keep_default_na=False, na_filter=False, on_bad_lines="error", quoting=csv.QUOTE_NONE)

    library.requests = SimpleNamespace(get=local_archive)
    library.pd = SimpleNamespace(read_csv=strict_read_csv)
    frame = library._mp_worker("https://data.gdeltproject.org/gdeltv2/verified.export.CSV.zip", table="events")
    if frame is None or frame.values.tolist() != rows:
        raise ValueError("GDELT library omitted or transformed source cells")
    return frame.values.tolist()


if __name__ == "__main__":
    try:
        rows = decode(sys.stdin.buffer.read(MAX_COMPRESSED + 1))
        print(json.dumps({"rows": rows}, ensure_ascii=True, allow_nan=False))
    except Exception as exc:
        print(json.dumps({"error": f"GDELT strict package decoding failed ({type(exc).__name__})"}))
        sys.exit(1)
