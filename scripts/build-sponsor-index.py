#!/usr/bin/env python3
"""Build the runtime sponsor index from the checked-in Home Office CSV."""
from __future__ import annotations

import argparse
import csv
import gzip
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

ALIASES = {
    "Google": "Google (UK) Limited",
    "Microsoft": "Microsoft Limited",
    "Amazon": "Amazon UK Services Ltd",
    "Amazon Web Services": "Amazon UK Services Ltd",
    "AWS": "Amazon UK Services Ltd",
    "Meta": "Facebook UK",
    "Facebook": "Facebook UK",
    "Deloitte": "Deloitte LLP",
    "PwC": "PricewaterhouseCoopers LLP",
    "PricewaterhouseCoopers": "PricewaterhouseCoopers LLP",
    "EY": "Ernst & Young",
    "Ernst and Young": "Ernst & Young",
    "KPMG": "KPMG LLP",
    "Accenture": "Accenture (UK) Limited",
    "IBM": "IBM UK Ltd",
    "Apple": "Apple Europe Limited",
    "TikTok": "TikTok Information Technologies UK Limited",
    "ByteDance": "TikTok Information Technologies UK Limited",
    "JP Morgan": "JPMorgan Chase Bank, National Association",
    "J.P. Morgan": "JPMorgan Chase Bank, National Association",
    "Goldman Sachs": "Goldman Sachs International",
    "Bloomberg": "Bloomberg LP",
    "Spotify": "Spotify Limited",
    "Netflix": "Netflix Services UK Limited",
    "Uber": "Uber London Limited",
    "Deliveroo": "Roofoods Ltd t/a Deliveroo",
    "Revolut": "Revolut Ltd",
    "Monzo": "Monzo Bank Ltd",
    "Airbnb": "Airbnb UK Limited",
    "OpenAI": "OpenAI UK Ltd",
    "Anthropic": "Anthropic Limited",
    "Palantir": "Palantir Technologies UK Limited",
    "Salesforce": "Salesforce UK Limited",
    "Oracle": "Oracle Corporation UK Limited",
    "Cisco": "Cisco International Limited",
    "Adobe": "Adobe Systems Europe Limited",
    "Red Hat": "Red Hat UK Ltd",
    "GitHub": "GITHUB SOFTWARE UK LTD",
    "LinkedIn": "Linkedin Technology UK Limited",
    "Twitter": "Twitter UK Ltd",
    "X": "Twitter UK Ltd",
    "Viridien": "CGG Services (UK) Ltd",
    "CGG": "CGG Services (UK) Ltd",
    "Worldpay": "WorldPay (UK) Ltd",
    "Kainos": "Kainos Software Ltd",
    "Snyk": "Snyk Limited",
    "Experian": "EXPERIAN LIMITED",
    "Netcompany": "Netcompany UK Limited",
    "Westcoast": "Westcoast Ltd"
}


def tidy(value: str) -> str:
    return " ".join((value or "").split())


def build(csv_path: Path, output_path: Path, metadata_path: Path, register_date: str) -> None:
    organisations: dict[str, dict[str, object]] = defaultdict(lambda: {"skilled": False})
    row_count = 0
    opener = gzip.open if csv_path.suffix == ".gz" else open
    with opener(csv_path, mode="rt", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        expected = {"Organisation Name", "Town/City", "County", "Type & Rating", "Route"}
        if not expected.issubset(reader.fieldnames or []):
            raise ValueError(f"Unexpected CSV columns: {reader.fieldnames}")
        for row in reader:
            row_count += 1
            name = tidy(row["Organisation Name"])
            if not name:
                continue
            details = organisations[name]
            if tidy(row["Route"]) == "Skilled Worker":
                details["skilled"] = True

    missing_alias_targets = sorted(set(ALIASES.values()) - set(organisations))
    if missing_alias_targets:
        raise ValueError(f"Alias targets absent from register: {missing_alias_targets}")

    records = [[name, 1 if details["skilled"] else 0] for name, details in sorted(organisations.items(), key=lambda item: item[0].casefold())]
    dataset = {
        "schemaVersion": 1,
        "country": "GB",
        "registerUpdated": register_date,
        "records": records,
        "aliases": ALIASES
    }
    output_path.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    metadata = {
        "country": "GB",
        "registerUpdated": register_date,
        "generatedOn": date.today().isoformat(),
        "source": "UK Visas and Immigration — Register of licensed sponsors: workers",
        "sourceUrl": "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers",
        "rowCount": row_count,
        "organisationCount": len(records),
        "skilledWorkerOrganisationCount": sum(record[1] for record in records)
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--register-date", required=True)
    args = parser.parse_args()
    build(args.csv, args.output, args.metadata, args.register_date)
