# UConn OpenShift Laravel Docs

## What this is

A **Docusaurus 3** site documenting how to deploy Laravel apps on UConn's OpenShift cluster.

## Essential commands

```bash
npm run start        # dev server at localhost:3000, hot-reloads
npm run build        # static output to build/
npm run serve        # preview the built site locally
npm run clear        # wipe .docusaurus/ and build/ caches
```

Use `npm run clear` before `npm run build` if the build behaves unexpectedly.

## Repo structure

| Path | Purpose |
|---|---|
| `docs/` | Main documentation content (MDX) |
| `src/css/custom.css` | Custom theme CSS (UConn navy palette) |
| `src/pages/index.js` | Landing page |
| `static/img/` | Site images and assets |

## Config quirks

- `package-lock.json` exists but README says `yarn` — use **npm**, not yarn.
- `onBrokenLinks: 'throw'` — the build will fail on any broken link. Run `npm run build` to catch them.
- Blog section was removed (`blog: false` in config).

## Infrastructure

- **Kubernetes MCP server** is configured in `opencode.json` for interacting with the cluster.
- This site is static — no server-side rendering beyond Docusaurus build.
