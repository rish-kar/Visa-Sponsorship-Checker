#!/usr/bin/env python3
"""Download the latest official CSV and rebuild the extension's offline index."""
from __future__ import annotations

import argparse
import gzip
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
    urllib.request.urlretrieve(csv_url, csv_path)

    subprocess.run([
        sys.executable, str(root / "scripts" / "build-sponsor-index.py"),
        "--csv", str(csv_path),
        "--output", str(data_dir / "uk-sponsors.index.json"),
        "--metadata", str(data_dir / "metadata.json"),
        "--register-date", register_date
    ], check=True)

    with csv_path.open("rb") as source, gzip.open(gzip_path, "wb", compresslevel=9) as target:
        while chunk := source.read(1024 * 1024):
            target.write(chunk)
    csv_path.unlink()
    print(f"Updated {gzip_path.name} and runtime index")


if __name__ == "__main__":
    main()
