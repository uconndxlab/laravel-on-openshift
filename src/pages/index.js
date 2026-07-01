import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/quickstart">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/quickstart">
            Quickstart
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Documentation for deploying Laravel applications on UConn's OpenShift Container Platform">
      <HomepageHeader />
      <main className={styles.features}>
        <div className="container">
          <div className="row">
            <div className="col col--4">
              <h3>Quay Registry</h3>
              <p>Store and manage container images in UConn's private registry at <code>quay.apps.uconn.edu</code>.</p>
              <Link to="/docs/quay/getting-started">Learn more →</Link>
            </div>
            <div className="col col--4">
              <h3>CI/CD Pipelines</h3>
              <p>Automate builds and deployments with Tekton Pipelines-as-Code and Bitbucket.</p>
              <Link to="/docs/ci-cd/tekton-bitbucket">Learn more →</Link>
            </div>
            <div className="col col--4">
              <h3>Laravel on OpenShift</h3>
              <p>Deploy Laravel applications with environment config, secrets, and OpenShift-native tooling.</p>
              <Link to="/docs/quickstart">View quickstart →</Link>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
