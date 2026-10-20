# Security

## Data boundary

The panel uses the plugin's Host route for all official-state reads and writes. It does not read Harness credential files, API keys, cookies, account tokens, or model chain-of-thought. Runtime profiles, credentials, captured databases, and local evidence are intentionally excluded from this repository.

## Reporting

Open a GitHub issue with reproduction steps that do not contain credentials or private workspace data. For a sensitive report, use the repository owner's private contact channel instead of a public issue.

