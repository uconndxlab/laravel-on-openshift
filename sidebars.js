// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'quickstart',
    {
      type: 'category',
      label: 'Deployment Templates',
      items: ['templates/overview', 'templates/openshift-templates', 'templates/helm', 'templates/argocd'],
    },
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
      items: ['images/paketo-buildpack'],
    },
    {
      type: 'category',
      label: 'CI/CD',
      items: ['ci-cd/tekton-bitbucket', 'ci-cd/automated-buildpack-deploy'],
    },
    'quickstart-imperative',
    'troubleshooting',
  ],
};

export default sidebars;
