# Minimart POS v3.2.5 — Data Integrity & Offline Reliability

> Release Candidate. Build, Rules Emulator tests, and device-level offline recovery must pass before Production deployment.

React + TypeScript + Vite + Firebase Firestore based Minimart POS with Owner/Cashier access, Multi-Branch management and Shared Pricing.

## Start here

- [v3.2.5 စတင်အသုံးပြုရန်](docs/setup/V3.2.5-START-HERE-MY.md)
- [v3.2.5 Release Notes](docs/releases/V3.2.5-DATA-INTEGRITY-OFFLINE-RELIABILITY-MY.md)
- [v3.2.5 QA Test Plan](docs/test-plans/V3.2.5-DATA-INTEGRITY-TEST-PLAN-MY.md)
- [v3.2.5 Firestore Rules Update](docs/firebase/V3.2.5-FIRESTORE-RULES-UPDATE-MY.md)
- [Firebase Security Deployment Guide](docs/firebase/V3.2.3-SECURITY-DEPLOYMENT-MY.md)
- [Documentation Index](docs/README.md)

## First-time setup

```bash
npm install
npm --prefix functions install
```

## Daily development

```bash
npm run dev
```

## Before release

Full QA (requires Java JDK for Firestore Emulator):

```bash
npm run qa
```

Quick QA without Firestore Emulator:

```bash
npm run qa:quick
```

Bundle report after a successful build:

```bash
npm run report:bundle
```

## Important

- The app has no public registration UI. Owner/Cashier authorization and the Identity Platform blocking triggers still require correct Firebase project setup and deployment as described in the Firebase guide.
- Do not deploy Firestore Rules or Cloud Functions to Production until the intended Firebase project, owner UID, test results and deployment checklist are verified.
- Lazy-loaded pages are cached by the service worker after first use. A page not previously opened may require internet on its first visit.
- The v3.2.5 service worker cache update does not clear LocalStorage or IndexedDB business data.

## Project folders

- `src/` — React application, page components, Firebase integration and POS store.
- `public/` — PWA icons, manifest and service worker.
- `functions/` — Identity Platform blocking functions (separate install/build).
- `scripts/` — Security preflight, QA runner and bundle reporting.
- `docs/` — Setup, architecture, Firebase, release notes and test plans.
