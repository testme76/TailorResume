#!/usr/bin/env node
import 'dotenv/config';
import { ROOT } from '../pipeline.js';
import { getWorkingPage, openBrowserSession } from './browser/session.js';
import { loadApplyConfig } from './config.js';
import { ApplicationOrchestrator } from './orchestrator.js';
import { loadQueue, parseQueueText } from './queue.js';

function parseArgs(argv) {
  const args = { urls: [], queue: null, profile: null, settings: null, inspect: false, inspectForm: false, submit: false, headless: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') args.urls.push(argv[++index]);
    else if (value === '--queue') args.queue = argv[++index];
    else if (value === '--profile') args.profile = argv[++index];
    else if (value === '--settings') args.settings = argv[++index];
    else if (value === '--inspect') args.inspect = true;
    else if (value === '--inspect-form') {
      args.inspect = true;
      args.inspectForm = true;
    }
    else if (value === '--submit') args.submit = true;
    else if (value === '--headless') args.headless = true;
    else if (/^https?:\/\//i.test(value)) args.urls.push(value);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function collectJobs(args) {
  const direct = parseQueueText(args.urls.join('\n'));
  const queued = args.queue ? loadQueue(args.queue) : [];
  const seen = new Set();
  return [...direct, ...queued].filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = collectJobs(args);
  if (jobs.length === 0) {
    throw new Error('Use --url <job-url> or --queue <file>.');
  }

  let profile = { personal: {}, answers: [] };
  let settings = {
    browser: { channel: 'chrome', headless: args.headless },
    audit: {},
    submit: { enabled: false },
  };
  if (!args.inspect || args.profile || args.settings) {
    const loaded = loadApplyConfig({
      profilePath: args.profile || undefined,
      settingsPath: args.settings || undefined,
    });
    profile = loaded.profile;
    settings = loaded.settings;
    if (args.headless) settings.browser = { ...settings.browser, headless: true };
  }

  const context = await openBrowserSession(settings);
  try {
    const page = await getWorkingPage(context);
    const runner = new ApplicationOrchestrator({
      page, profile, settings, inspectOnly: args.inspect, submit: args.submit,
      inspectForm: args.inspectForm,
    });
    for (const [index, job] of jobs.entries()) {
      console.log(`[${index + 1}/${jobs.length}] ${job.url}`);
      const result = await runner.run(job);
      console.log(`${result.status}: ${result.company || ''} ${result.role || ''}`.trim());
      if (result.error) console.log(`  ${result.error}`);
      if (result.details?.fields) console.log(`  Fields: ${result.details.fields.join(' | ')}`);
      if (result.fields) {
        for (const field of result.fields) {
          const options = field.options.length ? ` [${field.options.join(' / ')}]` : '';
          console.log(`  ${field.required ? '*' : '-'} ${field.question}${options}`);
        }
      }
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(`Apply runner failed: ${error.message}`);
  console.error(`Workspace: ${ROOT}`);
  process.exit(1);
});
