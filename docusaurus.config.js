// @ts-check

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'UConn OpenShift Laravel',
  tagline: 'Deploy Laravel applications on UConn\'s OpenShift cluster',
  favicon: 'img/favicon.ico',

  url: 'https://bdaley.github.io',
  baseUrl: '/uconn-openshift-laravel/',

  organizationName: 'bdaley',
  projectName: 'uconn-openshift-laravel',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/uconn/uconn-openshift-laravel/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({

      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'UConn OpenShift Laravel',
        logo: {
          alt: 'UConn Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/uconn/uconn-openshift-laravel',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Quickstart',
                to: '/docs/quickstart',
              },
            ],
          },
          {
            title: 'Resources',
            items: [
              {
                label: 'Quay Registry',
                to: '/docs/quay/getting-started',
              },
              {
                label: 'CI/CD with Tekton',
                to: '/docs/ci-cd/tekton-bitbucket',
              },
            ],
          },
          {
            title: 'Support',
            items: [
              {
                label: 'Troubleshooting',
                to: '/docs/troubleshooting',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/uconn/uconn-openshift-laravel',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} University of Connecticut. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
