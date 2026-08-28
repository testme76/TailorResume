import { NeedsAttentionError } from '../errors.js';
import {
  dismissCookieDialogs,
  fillConfiguredAnswers,
  fillPersonalFields,
  hasCaptcha,
  listInvalidRequiredFields,
  uploadResume,
} from '../forms/dom.js';
import { extractJsonLdJob, extractVisibleJob } from './common.js';

export const workableAdapter = {
  id: 'workable',
  canHandle(url) {
    return /^https:\/\/jobs\.workable\.com\//i.test(url);
  },
  async extractJob(page) {
    return await extractJsonLdJob(page) || extractVisibleJob(page, 'at ');
  },
  async openApplication(page) {
    await dismissCookieDialogs(page);
    const button = page.getByRole('button', { name: /^apply now$/i }).first();
    if (!await button.isVisible().catch(() => false)) {
      throw new NeedsAttentionError('Workable Apply now button was not found.');
    }
    await button.click();
    await page.getByRole('heading', { name: /personal information/i }).waitFor({ state: 'visible' });
  },
  async fillApplication(page, { profile, resumePath }) {
    if (await hasCaptcha(page)) throw new NeedsAttentionError('Workable presented a CAPTCHA.');
    await fillPersonalFields(page, profile.personal);
    await uploadResume(page, resumePath);
    return fillConfiguredAnswers(page, profile.answers || []);
  },
  async validate(page, unresolved = []) {
    const invalid = await listInvalidRequiredFields(page);
    return [...new Set([...unresolved, ...invalid])];
  },
  async submit(page) {
    await page.getByRole('button', { name: /submit application/i }).last().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    const text = await page.locator('body').innerText();
    if (!/application (was )?(submitted|received)|thank you/i.test(text)) {
      throw new NeedsAttentionError('Workable did not show a recognizable submission confirmation.');
    }
  },
};
