# UConn OpenShift Laravel Docs

## What this is

An **Astro + Starlight** site documenting how to deploy Laravel apps on UConn's OpenShift cluster.

## Essential commands

```bash
npm run start        # dev server, hot-reloads (localhost:4321)
npm run build        # static output to dist/
npm run preview      # preview the built site locally
```

## Repo structure

| Path | Purpose |
|---|---|
| `src/content/docs/` | Main documentation content (MD/MDX) |
| `src/styles/custom.css` | Custom theme CSS (UConn navy palette) |
| `src/content/docs/index.mdx` | Landing page (splash layout) |
| `public/img/` | Site images and assets |
| `astro.config.mjs` | Astro + Starlight configuration |

## Config quirks

- `base: '/uconn-openshift-laravel'` — set for GitHub Pages deployment under a sub-path
- `onBrokenLinks` is not a Starlight feature; use `astro build` to catch internal 404s
- Sidebar is configured in `astro.config.mjs` under `starlight.sidebar`

## Infrastructure

- **Kubernetes MCP server** is configured in `opencode.json` for interacting with the cluster.
- This site is static — no server-side rendering beyond Astro build.
