# Visa Sponsorship Checker

A privacy-first Chrome extension that highlights UK licensed sponsors directly on LinkedIn Jobs.

## What it does

- Adds a soft green marker when a LinkedIn employer matches the official sponsor register.
- Adds a soft red marker when the employer is not found.
- Shows the matched legal organisation name, match method and Skilled Worker-route availability.
- Handles common brand/legal-name differences using normalization, trading-name extraction, strong fuzzy matching and a reviewed alias map.
- Works entirely offline after installation; the UK register is bundled in the repository.
- Includes an enable/disable switch and country selector prepared for future expansion.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository folder.
5. Open a LinkedIn Jobs search or job-detail page.

## Matching model

The extension checks employers in this order:

1. Normalized exact legal-name match.
2. Trading-name match (`t/a` / `trading as`).
3. Reviewed brand-to-legal-entity aliases.
4. High-threshold token and edit-distance matching with ambiguity rejection.

A positive result means the organisation appears in the bundled Home Office register. It does **not** guarantee that a particular vacancy will be sponsored. The badge states separately whether the organisation has a Skilled Worker route in the register.

## Sponsor data

- Source: UK Visas and Immigration, **Register of licensed sponsors: workers**.
- Bundled register date: **26 June 2026**.
- Compressed raw source: `data/uk-sponsors-2026-06-26.csv.gz`.
- Runtime index: compressed parts matching `data/uk-sponsors.index.json.gz.part*`.
- Current size: 142,071 register rows covering 126,700 organisations.

The extension fetches only its own bundled files; it makes no runtime API calls. To refresh the checked-in data later:

```bash
python scripts/update-uk-register.py
```

A GitHub Actions workflow runs on weekdays and commits register changes automatically.

## Test

```bash
npm test
python -m json.tool manifest.json > /dev/null
```

## Permissions

- `storage`: saves enabled state and selected country.
- `activeTab`: lets the popup request a recheck of the current LinkedIn Jobs tab.
- LinkedIn Jobs host access only: reads employer names and injects visual markers.

See [PRIVACY.md](PRIVACY.md).
