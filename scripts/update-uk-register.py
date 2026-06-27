#!/usr/bin/env python3
"""Download the latest official CSV and rebuild the extension's offline index."""
from __future__ import annotations

import argparse
import gzip
import json
import re
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

PUBLICATION_URL = "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"
CSV_PATTERN = re.compile(r'https://assets\.publishing\.service\.gov\.uk/[^"\s]+\.csv')
DATE_PATTERN = re.compile(r"(20\d{2}-\d{2}-\d{2})")


def write_deterministic_gzip(source_path: Path, target_path: Path) -> None:
    with source_path.open("rb") as source, target_path.open("wb") as raw_target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_target, compresslevel=9, mtime=0) as target:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Override the register date used in filenames and metadata")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    data_dir.mkdir(exist_ok=True)

    request = urllib.request.Request(PUBLICATION_URL, headers={"User-Agent": "Visa-Sponsorship-Checker maintainer"})
    html = urllib.request.urlopen(request, timeout=30).read().decode("utf-8")
    matches = CSV_PATTERN.findall(html)
    if not matches:
        raise RuntimeError("Could not find the official CSV URL on GOV.UK")

    csv_url = matches[0]
    filename = Path(urlparse(csv_url).path).name
    date_match = DATE_PATTERN.search(filename)
    register_date = args.date or (date_match.group(1) if date_match else date.today().isoformat())

    for old_file in data_dir.glob("uk-sponsors-*.csv.gz"):
        old_file.unlink()

    csv_path = data_dir / f"uk-sponsors-{register_date}.csv"
    gzip_path = csv_path.with_suffix(".csv.gz")
    index_path = data_dir / "uk-sponsors.index.json"
    index_gzip_path = data_dir / "uk-sponsors.index.json.gz"
    urllib.request.urlretrieve(csv_url, csv_path)

    subprocess.run([
        sys.executable, str(root / "scripts" / "build-sponsor-index.py"),
        "--csv", str(csv_path),
        "--output", str(index_path),
        "--metadata", str(data_dir / "metadata.json"),
        "--register-date", register_date
    ], check=True)

    write_deterministic_gzip(csv_path, gzip_path)
    csv_path.unlink()

    for old_part in data_dir.glob("uk-sponsors.index.json.gz.part*"):
        old_part.unlink()
    write_deterministic_gzip(index_path, index_gzip_path)
    index_path.unlink()

    part_count = 0
    with index_gzip_path.open("rb") as source:
        while chunk := source.read(50_000):
            (data_dir / f"uk-sponsors.index.json.gz.part{part_count:02d}").write_bytes(chunk)
            part_count += 1
    index_gzip_path.unlink()

    metadata_path = data_dir / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["indexPartCount"] = part_count
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {gzip_path.name} and {part_count} runtime index parts")


if __name__ == "__main__":
    main()
