import fetch from 'node-fetch';
import { format } from 'date-fns';
import { FormData } from 'formdata-node';

/**
 * Throws if the required environment variable is not set.
 * @param {string} name - The environment variable name.
 * @returns {string} The environment variable value.
 */
function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return process.env[name];
}

const DA_TOKEN = requireEnv('DA_TOKEN');
const HELIX_TOKEN = requireEnv('HELIX_TOKEN');
const AEM_PAGE_PATH = requireEnv('AEM_PAGE_PATH');
const ORG_ID = requireEnv('ORG_ID');
const REPO = requireEnv('REPO');
const HLX_ORG = requireEnv('HLX_ORG');
const HLX_SITE = requireEnv('HLX_SITE');
const SITE_ROOT = 'blog';
const PUBLISH_ROOT = `/${ORG_ID}/${REPO}/${SITE_ROOT}/`;

const DA_URL = 'https://admin.da.live';
const HELIX_URL = 'https://admin.hlx.page';
const VALID_PREFIXES = ['/drafts/'];

/**
 * Logs messages with a consistent prefix.
 * @param {'info'|'error'} level
 * @param {string} msg
 */
function log(level, msg) {
  const prefix = '[publisher]';
  if (level === 'error') {
    console.error(`${prefix} ERROR: ${msg}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

/**
 * Removes the first matching prefix from the path.
 * @param {string} path
 * @param {string[]} prefixes
 * @returns {string}
 */
function stripPrefix(path, prefixes) {
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      return path.slice(prefix.length);
    }
  }
  return path;
}

/**
 * Replaces the .md extension with .html
 * @param {string} path
 * @returns {string}
 */
function mdToHtml(path) {
  return path.endsWith('.md') ? path.slice(0, -3) + '.html' : path;
}

/**
 * Main entry point
 */
async function main() {
  // log('info', `DEBUG_EVENT_PAYLOAD: ${process.env.DEBUG_EVENT_PAYLOAD}`); // uncomment to debug event payload (see what gh sends)
  log('info', `AEM_PAGE_PATH: ${AEM_PAGE_PATH}`);
  log('info', `HLX_ORG: ${HLX_ORG}`);
  log('info', `HLX_SITE: ${HLX_SITE}`);

  const hasValidPrefix =
    AEM_PAGE_PATH && VALID_PREFIXES.some(prefix => AEM_PAGE_PATH.startsWith(prefix));

  if (hasValidPrefix && AEM_PAGE_PATH.endsWith('.md')) {
    log('info', 'AEM_PAGE_PATH starts with a valid prefix and ends with .md');

    // step 1: unpublish page from helix live
    await unpublishPage(AEM_PAGE_PATH, 'live');

    // step 2: unpublish page from preview
    await unpublishPage(AEM_PAGE_PATH, 'preview');

    // step 3: move da page to date structure
    const dirPath = await movePageToDateStructure(AEM_PAGE_PATH);
    log('info', `new path: ${dirPath}`);

    // step 4: publish page to preview
    await publishPage(dirPath, 'preview');

    // step 5: publish page to helix live
    await publishPage(dirPath, 'live');

  } else {
    log('info', 'AEM_PAGE_PATH does not match the required pattern');
    return;
  }
}

/**
 * Unpublishes a page from helix.
 * @param {string} pagePath
 * @param {string} environment
 */
async function unpublishPage(pagePath, environment) {
  log('info', `Unpublishing page from helix ${environment}: ${pagePath}`);

  try {
    const response = await fetch(`${HELIX_URL}/${environment}/${ORG_ID}/${REPO}/main/${pagePath}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${HELIX_TOKEN}`,
        'Accept': 'application/json',
      },
    });
    if (response.status === 204) {
      log('info', 'Unpublish successful: No Content (204)');
    } else if (response.ok) {
      log('info', 'Unpublish response: ' + (await response.text()));
    } else {
      log('error', `Unpublish failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (err) {
    log('error', `Error unpublishing: ${err}`);
    process.exit(1);
  }
}

/**
 * Publishes a page to helix.
 * @param {string} pagePath
 * @param {string} environment
 */
async function publishPage(pagePath, environment) {
  log('info', `Publishing page to helix ${environment}: ${pagePath}`);

  try {
    const response = await fetch(`${HELIX_URL}/${environment}/${ORG_ID}/${REPO}/main/${pagePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HELIX_TOKEN}`,
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      log('info', `Publish to ${environment} successful`);
    } else {
      log('error', `Publish failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (err) {
    log('error', `Error publishing: ${err}`);
    process.exit(1);
  }
}

/**
 * Moves a page to a date-based directory structure.
 * @param {string} pagePath
 * @returns {Promise<string>} The new path
 */
async function movePageToDateStructure(pagePath) {
  // Use date-fns for formatting
  const datePath = format(new Date(), 'yyyy/MM/dd');

  // Prepare the destination path (prefix stripped, .md replaced with .html)
  let destinationPath = stripPrefix(pagePath, VALID_PREFIXES);
  destinationPath = mdToHtml(destinationPath);
  const dirPath = `${PUBLISH_ROOT}${datePath}/${destinationPath}`;
  log('info', `Target: ${dirPath}`);

  // Prepare the source path for the fetch URL (retain prefix, but .md -> .html)
  let sourcePath = mdToHtml(pagePath);

  // Prepare multipart/form-data body
  const form = new FormData();
  form.set('destination', dirPath);

  try {
    const response = await fetch(`${DA_URL}/move/${ORG_ID}/${REPO}/${sourcePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DA_TOKEN}`,
        'Accept': 'application/json',
        ...form.headers, // Add multipart headers
      },
      body: form,
    });
    if (response.status === 204) {
      log('info', 'move successful');
      return `/${SITE_ROOT}/${datePath}/${destinationPath}`;
    } else if (response.ok) {
      // log('info', 'Response JSON: ' + JSON.stringify(await response.json()));
      return `/${SITE_ROOT}/${datePath}/${destinationPath}`;
    } else {
      log('error', `Move failed with status ${response.status}`);
      process.exit(1);
    }
  } catch (err) {
    log('error', `Error moving page: ${err}`);
    process.exit(1);
  }
}

main();