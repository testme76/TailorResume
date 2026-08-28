import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { ROOT } from '../../pipeline.js';

export async function openBrowserSession(settings = {}) {
  const profileDirectory = path.resolve(
    ROOT,
    settings.browser?.profileDirectory || './tmp/apply-browser-profile'
  );
  fs.mkdirSync(profileDirectory, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: settings.browser?.channel || 'chrome',
    headless: settings.browser?.headless ?? false,
    viewport: settings.browser?.viewport || { width: 1440, height: 1000 },
    locale: settings.browser?.locale || 'en-US',
    slowMo: settings.browser?.slowMo || 0,
  });
  context.setDefaultTimeout(settings.browser?.timeoutMs || 15_000);
  context.setDefaultNavigationTimeout(settings.browser?.navigationTimeoutMs || 60_000);
  return context;
}

export async function getWorkingPage(context) {
  const pages = context.pages();
  return pages[0] || context.newPage();
}

