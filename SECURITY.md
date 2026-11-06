# Security policy

## Supported versions

Security fixes currently target the latest `main` branch while Latticefolk is pre-1.0.

## Reporting a vulnerability

Please do not publish exploitable vulnerabilities as a public issue. Report security vulnerabilities privately to ranzevor@gmail.com.

## Credential model

Decision-provider credentials are server-side secrets. They belong only in `.env` or the deployment platform's secret store. Browser code must never receive provider API keys.

If a credential is accidentally committed, revoke it immediately and remove it from Git history before treating the incident as resolved.
