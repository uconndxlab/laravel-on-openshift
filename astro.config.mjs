// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import { rehypePrefixLinks } from './src/plugins/rehype-prefix-links.mjs';

const base = '/uconn-openshift-laravel';

export default defineConfig({
  site: 'https://bdaley.github.io',
  base,
  markdown: {
    processor: unified({
      rehypePlugins: [[rehypePrefixLinks, base]],
    }),
  },
  integrations: [
    starlight({
      title: 'Laravel Deployment Guide for UConn OpenShift',
      description: 'Deploy Laravel applications on UConn\'s OpenShift cluster',
      logo: {
        src: './src/assets/laravel-mark-rgb-red.svg',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/bdaley/uconn-openshift-laravel' },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Quickstart', slug: 'quickstart' },
        {
          label: 'Deployment Templates',
          items: [
            { label: 'Overview', slug: 'templates/overview' },
            { label: 'OpenShift Templates', slug: 'templates/openshift-templates' },
            { label: 'Helm', slug: 'templates/helm' },
            { label: 'ArgoCD', slug: 'templates/argocd' },
          ],
        },
        {
          label: 'Deployment Guides',
          items: [
            { label: 'Persistent Storage', slug: 'guides/persistent-storage' },
            { label: 'Production Patterns', slug: 'guides/production-patterns' },
          ],
        },
        {
          label: 'Quay Registry',
          items: [
            { label: 'Getting Started', slug: 'quay/getting-started' },
          ],
        },
        {
          label: 'Building Images',
          items: [
            { label: 'Containerfile', slug: 'images/containerfile' },
          ],
        },
        {
          label: 'CI/CD',
          items: [
            { label: 'Tekton + Bitbucket', slug: 'ci-cd/tekton-bitbucket' },
            { label: 'Automated Deploy', slug: 'ci-cd/automated-deploy' },
          ],
        },
        { label: 'Quickstart (Imperative Reference)', slug: 'quickstart-imperative' },
        { label: 'Troubleshooting', slug: 'troubleshooting' },
        {
          label: 'Archive',
          collapsed: true,
          items: [
            { label: 'Paketo Buildpack', slug: 'archive/images/paketo-buildpack' },
            { label: 'Automated Buildpack Deploy', slug: 'archive/ci-cd/automated-buildpack-deploy' },
          ],
        },
      ],
    }),
  ],
});
