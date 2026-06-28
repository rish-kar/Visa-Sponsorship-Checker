#!/usr/bin/env python3
"""Download the latest official IND work register and rebuild the offline NL index."""
from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

REGISTER_URL = "https://ind.nl/en/public-register-recognised-sponsors/public-register-work"
DATE_PATTERN = re.compile(r"The overview was last updated on\s+(\d{1,2}\s+\w+\s+20\d{2})", re.I)
META_DATE_PATTERN = re.compile(r'<meta name="dcterms\.modified" content="(20\d{2}-\d{2}-\d{2})"', re.I)
MONTHS = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12"
}


def tidy(value: str) -> str:
    return " ".join(html.unescape(value or "").split())


def parse_written_date(value: str) -> str:
    day, month, year = value.split()
    return f"{year}-{MONTHS[month.lower()]}-{int(day):02d}"


def extract_register_date(page: str, override: str | None) -> str:
    if override:
        return override
    date_match = DATE_PATTERN.search(page)
    if date_match:
        return parse_written_date(date_match.group(1))
    meta_match = META_DATE_PATTERN.search(page)
    if meta_match:
        return meta_match.group(1)
    return date.today().isoformat()


class SponsorTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[str, str]] = []
        self._in_row = False
        self._in_name = False
        self._in_kvk = False
        self._name_parts: list[str] = []
        self._kvk_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            self._in_row = True
            self._name_parts = []
            self._kvk_parts = []
            return
        if not self._in_row:
            return
        if tag == "th" and attributes.get("scope") == "row":
            self._in_name = True
        elif tag == "td":
            self._in_kvk = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "th":
            self._in_name = False
            return
        if tag == "td":
            self._in_kvk = False
            return
        if tag == "tr" and self._in_row:
            name = tidy("".join(self._name_parts))
            kvk = tidy("".join(self._kvk_parts))
            if name and re.fullmatch(r"\d{8}", kvk):
                self.rows.append((name, kvk))
            self._in_row = False

    def handle_data(self, data: str) -> None:
        if self._in_name:
            self._name_parts.append(data)
        elif self._in_kvk:
            self._kvk_parts.append(data)


def write_deterministic_gzip(source_path: Path, target_path: Path) -> None:
    with source_path.open("rb") as source, target_path.open("wb") as raw_target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_target, compresslevel=9, mtime=0) as target:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Override the register date used in metadata")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    data_dir.mkdir(exist_ok=True)

    request = urllib.request.Request(REGISTER_URL, headers={"User-Agent": "Visa-Sponsorship-Checker maintainer"})
    page = urllib.request.urlopen(request, timeout=45).read().decode("utf-8")
    register_date = extract_register_date(page, args.date)

    parser = SponsorTableParser()
    parser.feed(page)
    organisations = sorted({name for name, _kvk in parser.rows}, key=str.casefold)
    if len(organisations) < 1000:
        raise RuntimeError(f"Unexpectedly few IND recognised sponsors: {len(organisations)}")

    dataset = {
        "schemaVersion": 1,
        "country": "NL",
        "registerUpdated": register_date,
        "records": [[name, 1] for name in organisations],
        "aliases": {}
    }

    index_path = data_dir / "nl-sponsors.index.json"
    index_gzip_path = data_dir / "nl-sponsors.index.json.gz"
    index_path.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for old_part in data_dir.glob("nl-sponsors.index.json.gz.part*"):
        old_part.unlink()
    write_deterministic_gzip(index_path, index_gzip_path)
    index_path.unlink()

    part_count = 0
    with index_gzip_path.open("rb") as source:
        while chunk := source.read(50_000):
            (data_dir / f"nl-sponsors.index.json.gz.part{part_count:02d}").write_bytes(chunk)
            part_count += 1
    index_gzip_path.unlink()

    metadata = {
        "country": "NL",
        "registerUpdated": register_date,
        "generatedOn": register_date,
        "source": "Immigration and Naturalisation Service (IND) - Public register Work",
        "sourceUrl": REGISTER_URL,
        "organisationCount": len(organisations),
        "recognisedSponsorOrganisationCount": len(organisations),
        "indexPartCount": part_count
    }
    (data_dir / "nl-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Updated Netherlands recognised-sponsor index with {len(organisations)} organisations and {part_count} parts")


if __name__ == "__main__":
    main()
