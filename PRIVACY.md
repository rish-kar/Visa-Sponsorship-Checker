# Privacy Policy — Visa Sponsorship Checker

**Last updated: 28 June 2026**

Visa Sponsorship Checker ("the Extension") is a browser extension that highlights UK licensed sponsors and Netherlands recognised sponsors directly on LinkedIn Jobs pages. This policy explains exactly what the Extension does and does not do with your data.

> **The Extension does not collect, store, or transmit any personal data. All company-name checking happens locally, inside your browser.**

## 1. Information we collect

The Extension does **not** collect, transmit, sell, or share any personal information, browsing history, or job-search activity. Specifically:

- No personal or identifying information is gathered.
- No analytics, advertising, tracking pixels, or telemetry of any kind.
- No remote code is downloaded or executed.

## 2. How the Extension works (local processing)

When you view a LinkedIn Jobs page, the Extension reads the employer/company names shown on that page and compares them — entirely within your browser — against bundled copies of official government sponsor registers. It then adds a coloured marker ("Licensed" / "Recognised sponsor" or "Not found") next to each company. The company names, job titles, and locations it reads never leave your device and are never sent to us or to any third party.

## 3. Local storage

The Extension uses your browser's local extension storage (`chrome.storage.local`) to save only:

- Your enabled / disabled preference.
- Your selected country (United Kingdom or Netherlands).
- A cached copy of the public sponsor-register data, so checks work offline and quickly.

None of this is personal data. It is stored on your device and is removed automatically when you uninstall the Extension.

## 4. Network activity

The Extension makes a single type of outbound request: approximately once a week it checks this project's public GitHub file host for an updated copy of the sponsor registers and downloads the data files if a newer version is available. These requests download **public government register data only**. They do **not** include your company names, job details, browsing activity, or any personal data — only static file paths are requested. No other network connections are made.

## 5. Permissions and why they are needed

| Permission | Why the Extension needs it |
| :--- | :--- |
| `storage` | Saves your on/off preference, selected country, and cached register data locally. |
| `activeTab` | Lets the popup re-check the LinkedIn Jobs tab you are viewing when you click the extension icon. |
| `scripting` | Injects the on-page checker into LinkedIn Jobs pages. |
| `alarms` | Schedules the weekly check for updated register data. |
| Access to `linkedin.com/jobs` | Reads employer names on LinkedIn Jobs pages and adds the visual markers. |
| Access to `raw.githubusercontent.com` (this project only) | Downloads updated public sponsor-register data. |

## 6. Data sharing and sale

We do not sell, rent, trade, or share any data with third parties. There is no user data to share, because the Extension collects none. The Extension's use of information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## 7. Data sources

Sponsor data is sourced from official public registers:

- **United Kingdom:** UK Visas and Immigration — Register of licensed sponsors: workers.
- **Netherlands:** Immigration and Naturalisation Service (IND) — Public register Work.

Updated register files are distributed through this project's public GitHub repository.

## 8. Children's privacy

The Extension is a general-purpose professional tool, is not directed at children, and collects no data from anyone.

## 9. Changes to this policy

If this policy changes, the updated version will be published with a revised "Last updated" date.

## 10. Contact

Questions about this policy or the Extension can be raised on the project's issue tracker: <https://github.com/rish-kar/Visa-Sponsorship-Checker/issues>.

---

*Visa Sponsorship Checker is an independent project and is not affiliated with LinkedIn, UK Visas and Immigration, or the Netherlands IND.*
