You are auditing API usage in this frontend project for Tickit’s backend Firestore-to-SQL migration.

Your job is to produce a Markdown report. Do not modify app logic.

## Goal

Find every backend API used by this project and export:

`docs/backend-api-inventory/{project-slug}-api-inventory.md`

Only include API calls. The frontend has migrated away from Firebase callables and direct Firestore usage, so focus on HTTP API routes and methods.

## What Counts As An API

Include calls made through:
- axios/fetch/custom HTTP clients
- generated API clients
- service/repository files
- React Query/SWR hooks or equivalent
- Redux/Thunk/Saga actions or equivalent
- mobile networking layers
- upload/download helpers
- SSE/event-stream clients if present

For each API, identify:
- HTTP method
- route/path
- base client/base URL if known
- source files and function names
- feature/screen/workflow using it
- request params/query/body shape if inferable
- response fields actually used by the UI if inferable
- auth headers/token mechanism if visible
- status: `Active`, `Probably active`, `Needs developer confirmation`, or `Deprecated/unreachable candidate`

## Deprecated / Unreachable Detection

Trace API calls from routes, screens, navigation, feature flags, exports, and imports.

If an API appears only in disconnected code, unused screens, old services, commented code, dead wrappers, or unreferenced modules:
- Do not delete it from the report.
- Mark it `Needs developer confirmation`.
- Add a clear question in the final section:
  `Is {API method + route} still used by {feature/file}? It appears {reason}.`

## Output Format

# API Inventory: {Project Name}

## Summary
- Project:
- Developer:
- Audit date:
- Total APIs found:
- Active / probably active:
- Needs developer confirmation:
- Deprecated/unreachable candidates:

## API Inventory

| Feature | Method | Route | Status | Source refs | Request shape | Response fields used | Notes |
|---|---|---|---|---|---|---|---|

## Feature Details

For each feature/workflow, list:
- APIs used
- screens/routes that trigger them
- relevant source files
- important sequencing, e.g. create session -> create payment -> confirm receipt

## Needs Developer Confirmation

List each uncertain API as a checkbox:
- [ ] `{METHOD} {ROUTE}` — question and reason.

## Deprecated / Unreachable Candidates

List APIs that appear unused or disconnected:
- `{METHOD} {ROUTE}` — source files and reason.

## Backend Migration Notes

Add anything useful for backend implementation:
- response fields the frontend depends on
- fields with strict naming assumptions
- endpoints called frequently or performance-sensitive
- endpoints used offline or in scanner/seating/payment critical paths
- APIs where frontend expects legacy Firestore-shaped nested objects