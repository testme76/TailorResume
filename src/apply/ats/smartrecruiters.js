import { NeedsAttentionError } from '../errors.js';
import {
  dismissCookieDialogs,
  fillConfiguredAnswers,
  fillPersonalFields,
  getAccessRestriction,
  hasCaptcha,
  listInvalidRequiredFields,
  uploadResume,
  waitForCaptchaResolution,
} from '../forms/dom.js';
import { extractJsonLdJob, extractOpenGraphJob, extractVisibleJob } from './common.js';

export const smartRecruitersAdapter = {
  id: 'smartrecruiters',
  canHandle(url) {
    return /^https:\/\/jobs\.smartrecruiters\.com\//i.test(url);
  },
  async extractJob(page) {
    return await extractJsonLdJob(page) || await extractOpenGraphJob(page) || extractVisibleJob(page);
  },
  async openApplication(page, { settings = {} } = {}) {
    await dismissCookieDialogs(page);
    const link = page.getByRole('link', { name: /i['’]?m interested/i }).first();
    if (!await link.isVisible().catch(() => false)) {
      throw new NeedsAttentionError('SmartRecruiters application link was not found.');
    }
    await page.goto(await link.getAttribute('href'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    if (await hasCaptcha(page)) {
      if (settings.browser?.headless === true) {
        throw new NeedsAttentionError('SmartRecruiters presented a CAPTCHA in headless mode.', {
          captcha: true,
        });
      }
      const timeoutMs = settings.browser?.captchaWaitMs || 300_000;
      console.log(`  CAPTCHA detected. Complete it in Chrome within ${Math.round(timeoutMs / 60_000)} minutes; the runner will continue automatically.`);
      const resolved = await waitForCaptchaResolution(page, { timeoutMs });
      if (!resolved) {
        throw new NeedsAttentionError('SmartRecruiters CAPTCHA was not completed before timeout.', {
          captcha: true,
        });
      }
      await page.waitForTimeout(1500);
    }
    const restriction = await getAccessRestriction(page);
    if (restriction) {
      throw new NeedsAttentionError(
        'SmartRecruiters temporarily restricted this browser or network. Stop retrying and apply manually later.',
        { accessRestricted: true, message: restriction }
      );
    }
  },
  async fillApplication(page, { profile, resumePath, job }) {
    await fillPersonalFields(page, profile.personal);
    await uploadResume(page, resumePath);
    return fillConfiguredAnswers(page, profile.answers || [], { job });
  },
  async validate(page, unresolved = []) {
    const invalid = await listInvalidRequiredFields(page);
    return [...new Set([...unresolved, ...invalid])];
  },
  async submit(page) {
    const submit = page.getByRole('button', { name: /submit|apply/i }).last();
    if (!await submit.isVisible().catch(() => false)) {
      throw new NeedsAttentionError('SmartRecruiters submit button was not found.');
    }
    await submit.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    const text = await page.locator('body').innerText();
    if (!/application (was )?(submitted|received)|thank you/i.test(text)) {
      throw new NeedsAttentionError('SmartRecruiters did not show a recognizable confirmation.');
    }
  },
};
