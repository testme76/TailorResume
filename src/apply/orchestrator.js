import { prepareTailor, publishTailor } from '../pipeline.js';
import { ApplicationAudit } from './audit/logger.js';
import { detectAdapter } from './ats/index.js';
import { NeedsAttentionError, SkipApplicationError } from './errors.js';
import { inspectApplicationFields } from './forms/dom.js';
import { findRequiredSkipQuestion } from './policies/questions.js';
import {
  findSecurityClearanceRequirement,
  findUsCitizenshipRequirement,
} from './policies/job.js';

function assertJob(job) {
  if (!job?.company?.trim()) throw new NeedsAttentionError('Could not extract the company name.');
  if (!job?.role?.trim()) throw new NeedsAttentionError('Could not extract the job title.');
  if (!job?.jd?.trim() || job.jd.trim().length < 40) {
    throw new NeedsAttentionError('Could not extract a complete job description.');
  }
  return {
    company: job.company.trim(),
    role: job.role.trim(),
    jd: job.jd.trim(),
  };
}

export class ApplicationOrchestrator {
  constructor({
    page,
    profile,
    settings = {},
    inspectOnly = false,
    inspectForm = false,
    submit = false,
    audit = new ApplicationAudit(settings),
    tailor = prepareTailor,
    publish = publishTailor,
  }) {
    this.page = page;
    this.profile = profile;
    this.settings = settings;
    this.inspectOnly = inspectOnly;
    this.inspectForm = inspectForm;
    this.submit = submit;
    this.audit = audit;
    this.tailor = tailor;
    this.publish = publish;
  }

  async run(jobItem) {
    const sourceUrl = jobItem.url;
    let adapter;
    let job;
    let resume;
    try {
      adapter = detectAdapter(sourceUrl);
      if (!adapter) throw new NeedsAttentionError(`Unsupported ATS: ${new URL(sourceUrl).hostname}`);

      await this.page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(this.settings.browser?.settleMs || 1500);
      job = assertJob(await adapter.extractJob(this.page));

      if (this.profile.skipIfSecurityClearanceRequired === true) {
        const requirement = findSecurityClearanceRequirement(job.jd);
        if (requirement) {
          throw new SkipApplicationError('Job requires a security clearance.', { requirement });
        }
      }
      if (this.profile.skipIfUsCitizenshipRequired === true) {
        const requirement = findUsCitizenshipRequirement(job.jd);
        if (requirement) {
          throw new SkipApplicationError('Job requires U.S. citizenship.', { requirement });
        }
      }

      if (this.inspectOnly) {
        let fields;
        if (this.inspectForm) {
          await adapter.openApplication(this.page, { settings: this.settings });
          fields = await inspectApplicationFields(this.page);
        }
        return this.audit.append({
          status: 'inspected', sourceUrl, ats: adapter.id,
          company: job.company, role: job.role, jdLength: job.jd.length, fields,
        });
      }

      await adapter.openApplication(this.page, { settings: this.settings });
      const applicationFields = await inspectApplicationFields(this.page);
      const skipField = findRequiredSkipQuestion(
        applicationFields,
        this.profile.skipIfRequiredQuestions || []
      );
      if (skipField) {
        throw new SkipApplicationError('Application requires a question configured for skipping.', {
          field: skipField.question,
        });
      }

      const prepared = await this.tailor(job);
      resume = await this.publish(prepared);
      const unresolved = await adapter.fillApplication(this.page, {
        profile: this.profile,
        resumePath: resume.pdfPath,
        job,
      });
      const problems = await adapter.validate(this.page, unresolved);
      if (problems.length > 0) {
        throw new NeedsAttentionError('Required fields could not be completed.', { fields: problems });
      }

      if (!this.submit) {
        const screenshotPath = await this.audit.screenshot(this.page, `${job.company}_${job.role}_ready`);
        return this.audit.append({
          status: 'ready', sourceUrl, ats: adapter.id, company: job.company,
          role: job.role, resumePath: resume.pdfPath, screenshotPath,
        });
      }

      if (this.settings.submit?.enabled !== true) {
        throw new NeedsAttentionError('Submission is disabled in apply-settings.json.');
      }
      await adapter.submit(this.page);
      const screenshotPath = await this.audit.screenshot(this.page, `${job.company}_${job.role}_submitted`);
      return this.audit.append({
        status: 'submitted', sourceUrl, ats: adapter.id, company: job.company,
        role: job.role, resumePath: resume.pdfPath, screenshotPath,
      });
    } catch (error) {
      const outcomeLabel = error instanceof SkipApplicationError ? 'skipped' : 'needs_attention';
      const screenshotPath = await this.audit.screenshot(
        this.page,
        `${job?.company || adapter?.id || 'unknown'}_${outcomeLabel}`
      );
      const status = error instanceof SkipApplicationError
        ? 'skipped'
        : error instanceof NeedsAttentionError ? 'needs_attention' : 'failed';
      return this.audit.append({
        status,
        sourceUrl,
        ats: adapter?.id,
        company: job?.company,
        role: job?.role,
        resumePath: resume?.pdfPath,
        screenshotPath,
        error: error.message,
        details: error.details,
      });
    }
  }
}
