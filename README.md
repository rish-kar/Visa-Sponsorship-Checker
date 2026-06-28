# Visa Sponsorship Checker

A privacy-first Chrome extension that highlights UK licensed sponsors and Netherlands recognised sponsors directly on LinkedIn Jobs.

## What it does

- Adds a soft green marker when a LinkedIn employer matches the official sponsor register.
- Adds a soft red marker when the employer is not found.
- Shows the matched legal organisation name, match method and Skilled Worker-route availability.
- Handles common brand/legal-name differences using normalization, trading-name extraction, strong fuzzy matching and a reviewed alias map.
- Ships with bundled sponsor registers and can refresh updated data into local browser storage weekly.
- Includes an enable/disable switch and UK/Netherlands country selector.

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

A positive result means the organisation appears in the selected country's bundled or locally cached register. It does **not** guarantee that a particular vacancy will be sponsored. UK badges state separately whether the organisation has a Skilled Worker route in the register.

## Sponsor data

- UK source: UK Visas and Immigration, **Register of licensed sponsors: workers**.
- Netherlands source: Immigration and Naturalisation Service (IND), **Public register Work**.
- Bundled UK runtime index: compressed parts matching `data/uk-sponsors.index.json.gz.part*`.
- Bundled Netherlands runtime index: compressed parts matching `data/nl-sponsors.index.json.gz.part*`.

The extension uses bundled data as a fallback. Once a week, its background worker checks the hosted repository data and stores updated register files locally in Chrome storage when available.

To refresh the checked-in data manually:

```bash
python scripts/update-uk-register.py
python scripts/update-nl-register.py
```

A GitHub Actions workflow runs every Sunday and commits register changes automatically.

## Test

```bash
npm test
npm run validate
python -m json.tool manifest.json > /dev/null
```

## Permissions

- `storage`: saves enabled state and selected country.
- `activeTab`: lets the popup request a recheck of the current LinkedIn Jobs tab.
- `alarms`: schedules weekly register refreshes.
- LinkedIn Jobs host access: reads employer names and injects visual markers.
- GitHub raw host access: downloads updated bundled-register JSON parts into local storage.

See [PRIVACY.md](PRIVACY.md).
