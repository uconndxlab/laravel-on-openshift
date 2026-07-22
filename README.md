# Laravel Deployment Guide for UConn OpenShift

A documentation site for deploying Laravel applications on UConn's OpenShift cluster, built with [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/).

**Published site:** [https://uconndxlab.github.io/laravel-on-openshift/](https://uconndxlab.github.io/laravel-on-openshift/)

## Getting Started

```bash
git clone <repo-url>
cd uconn-openshift-laravel
npm install
npm run start
```

This starts a local development server at `localhost:4321`. Most changes are reflected live without having to restart the server.

## Editing Documentation

All content lives in `src/content/docs/` as Markdown (`.md`) or MDX (`.mdx`). The sidebar structure is configured in `astro.config.mjs` under `starlight.sidebar`. To add a new page:

1. Create a `.md` file in the appropriate subdirectory under `src/content/docs/`
2. Add a corresponding entry in the `sidebar` array in `astro.config.mjs`

Images go in `public/img/` or `src/assets/`.

## Building & Previewing

```bash
npm run build      # static output to dist/
npm run preview    # preview the built site locally
```

Run `npm run build` before pushing — it catches broken internal links.

## Repository Structure

| Path | Purpose |
|---|---|
| `src/content/docs/` | Documentation pages (MD/MDX) |
| `src/styles/custom.css` | Custom UConn-themed CSS |
| `src/assets/` | SVG logos and images |
| `public/img/` | Site images |
| `astro.config.mjs` | Astro + Starlight configuration |

## Deployment

Pushes to `main` are automatically built and deployed to GitHub Pages via GitHub Actions. The site is configured with `base: '/laravel-on-openshift'`.

## Requirements

- Node.js >= 20

## Contributing

PRs are welcome. For major changes, please open an issue first to discuss.
