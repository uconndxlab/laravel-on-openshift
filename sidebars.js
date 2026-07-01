// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'quickstart',
    {
      type: 'category',
      label: 'Deployment Guides',
      items: ['guides/persistent-storage', 'guides/production-patterns'],
    },
    {
      type: 'category',
      label: 'Quay Registry',
      items: ['quay/getting-started'],
    },
    {
      type: 'category',
      label: 'Building Images',
      items: ['images/heroku-buildpack'],
    },
    {
      type: 'category',
      label: 'CI/CD',
      items: ['ci-cd/tekton-bitbucket', 'ci-cd/automated-buildpack-deploy'],
    },
    'troubleshooting',
  ],
};

export default sidebars;
