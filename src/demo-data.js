/**
 * Hand-authored, synthetic demonstrations. No report or incident below comes
 * from a real team, production system, or user. These are not benchmark results.
 */
const escapeXml = (value) => String(value).replace(/[<>&"']/g, (char) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[char]));

function junit(name, entries) {
  const cases = entries.map(({ name: testName, suite, type, text }) =>
    `  <testcase classname="${escapeXml(suite)}" name="${escapeXml(testName)}" time="0"><failure type="${escapeXml(type)}" message="${escapeXml(text.split('\n')[0])}">${escapeXml(text)}</failure></testcase>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${escapeXml(name)}" tests="${entries.length}" failures="${entries.length}" errors="0" skipped="0">\n${cases.join('\n')}\n</testsuite>`;
}

const lock = 'npm ERR! code EUSAGE\nnpm ERR! npm ci can only install packages when package.json and package-lock.json are in sync.\nnpm ERR! Missing: cookie@0.7.2 from lock file\nRun npm install to update the lock file before continuing.';
const refused = 'Error: connect ECONNREFUSED 127.0.0.1:5432\nThe PostgreSQL service did not accept a TCP connection.\nat connectDatabase (/workspace/app/src/db.js:41:13)';
const timeout = 'TimeoutError: waiting for the health endpoint exceeded 30000ms\nService startup did not finish before the readiness deadline.\nGET http://127.0.0.1:8080/health';

export const SEED_INCIDENTS = [
  {
    id: 'incident-lockfile',
    title: 'Dependency manifest and lockfile are out of sync',
    symptom: 'npm ci refuses a clean dependency installation because package.json and package-lock.json do not agree. A required dependency is missing from the lock file. npm reports EUSAGE.',
    fix: 'In this synthetic scenario, run npm install with the project\'s expected npm version, review the package-lock.json diff, and commit the updated lockfile alongside package.json. Then retry npm ci. This is a previous resolution to check, not an instruction executed by Groundhog.',
    evidence: 'SYNTHETIC INCIDENT SIM-001, authored for this demonstration. Recorded symptom: "npm ci can only install packages when package.json and package-lock.json are in sync." Fixture resolution note: the manifest was changed without its lockfile. No production incident or verified real-world fix is claimed.',
    createdAt: '2026-10-19T09:00:00.000Z',
  },
  {
    id: 'incident-db-refused',
    title: 'PostgreSQL was not accepting TCP connections',
    symptom: 'Connecting to the PostgreSQL database fails with ECONNREFUSED, connection refused, on port 5432. The database listener is unavailable before a TCP connection can be established.',
    fix: 'In this synthetic scenario, start the PostgreSQL test service and wait for its readiness check before running the database tests. Check the host and port. This does not address password or permission errors after a connection succeeds.',
    evidence: 'SYNTHETIC INCIDENT SIM-002, authored for this demonstration. Recorded symptom: "connect ECONNREFUSED 127.0.0.1:5432". Fixture resolution note: the database service was not running. A password-authentication failure is a deliberately different incident and must not be treated as this fix.',
    createdAt: '2026-10-19T10:00:00.000Z',
  },
  {
    id: 'incident-timeout',
    title: 'Tests began before service readiness',
    symptom: 'The application health endpoint times out during startup. The readiness probe exceeds its deadline because the HTTP service has not finished becoming healthy before tests begin.',
    fix: 'In this synthetic scenario, replace the fixed startup sleep with a bounded health-readiness check before running the tests. Investigate the service logs if readiness never succeeds. Do not blindly increase every timeout or assume every timeout has this cause.',
    evidence: 'SYNTHETIC INCIDENT SIM-003, authored for this demonstration. Recorded symptom: "waiting for the health endpoint exceeded 30000ms". Fixture resolution note: tests started before the service became ready. No evidence here establishes that an arbitrary timeout shares this cause.',
    createdAt: '2026-10-20T08:30:00.000Z',
  },
];

const monday = [
  ...['linux-node22', 'linux-node24', 'windows-node24', 'macos-node24'].map((suite) => ({ name: 'install dependencies', suite, type: 'NpmInstallError', text: lock })),
  ...['integration-users', 'integration-orders', 'integration-inventory'].map((suite) => ({ name: 'connect database', suite, type: 'ConnectionError', text: refused })),
  ...['browser-chromium', 'browser-firefox', 'browser-webkit'].map((suite) => ({ name: 'wait for application readiness', suite, type: 'TimeoutError', text: timeout })),
  { name: 'authenticate reporting database', suite: 'integration-reports', type: 'AuthenticationError', text: 'PostgreSQL error 28P01: password authentication failed for user "reporter".\nThe database connection was established, but the supplied password was rejected.' },
  { name: 'write build artifact', suite: 'build-linux', type: 'OSError', text: 'OSError: [Errno 28] No space left on device\nUnable to write dist/application.tar.gz to the build artifact directory.' },
];

const replay = [
  { name: 'install packages in clean checkout', suite: 'ci-node24', type: 'NpmInstallError', text: 'Clean package installation aborted: the dependency manifest disagrees with the pinned dependency lockfile.\nThe lockfile has no entry for the package requested by package.json. Regenerate the dependency lock before running the frozen install.' },
  { name: 'bootstrap workspace dependencies', suite: 'ci-node22', type: 'NpmInstallError', text: 'npm ci exited with EUSAGE.\npackage-lock.json is stale: dependencies in the project manifest are absent from the lock file.\nThe package installation cannot continue in clean mode.' },
  { name: 'open persistence connection', suite: 'integration-accounts', type: 'ConnectionError', text: 'The PostgreSQL server refused the connection to localhost port 5432.\nNo database listener accepted the TCP connection; the service may not have started.' },
  { name: 'check API is ready before browser tests', suite: 'browser-chromium', type: 'TimeoutError', text: 'The startup health probe ran out of time before the application became ready.\nHTTP readiness polling exceeded the configured deadline.' },
  { name: 'authenticate reporting database', suite: 'integration-reports', type: 'AuthenticationError', text: 'Connection to PostgreSQL succeeded, but login was denied: invalid password for the reporting account.\nSQLSTATE 28P01. This is an authentication error, not a refused TCP connection.' },
  { name: 'publish static assets', suite: 'build-static', type: 'PermissionError', text: 'PermissionError: [Errno 13] Permission denied: dist/assets\nThe output directory is read-only; the build process cannot write the compiled files.' },
];

export const SAMPLE_RUNS = [
  {
    id: 'monday-noisy',
    title: 'Monday · the noisy run',
    description: 'Hand-authored synthetic JUnit: 12 failed jobs, including repeated symptoms and two deliberately unfamiliar failures. No live CI data.',
    xml: junit('Groundhog synthetic demonstration — Monday', monday),
  },
  {
    id: 'thursday-replay',
    title: 'Thursday · same problem, new words',
    description: 'Hand-authored synthetic replay: changed wording, an authentication hard negative, and a new filesystem failure. Similarity is a suggestion, not a diagnosis.',
    xml: junit('Groundhog synthetic demonstration — Thursday', replay),
  },
];
