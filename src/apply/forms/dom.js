import { NeedsAttentionError } from '../errors.js';
import { answerValues, findAnswerRule, normalizeText } from './answers.js';
import { resolveRuleValues } from '../policies/salary.js';

export async function dismissCookieDialogs(page) {
  for (const name of [/decline all/i, /reject all/i, /only necessary/i, /accept all/i]) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      return;
    }
  }
}

export async function hasCaptcha(page) {
  if (/captcha/i.test(await page.locator('body').innerText().catch(() => ''))) return true;
  return page.frames().some((frame) => /captcha|challenge/i.test(frame.url()));
}

export function detectAccessRestrictionText(text) {
  const match = String(text || '').match(/access (?:is |has been )?(?:temporarily|temporally) restricted|temporarily blocked|access denied/i);
  return match ? match[0] : null;
}

export async function getAccessRestriction(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  return detectAccessRestrictionText(text);
}

export async function waitForCaptchaResolution(page, {
  timeoutMs = 300_000,
  pollMs = 1000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await hasCaptcha(page)) return true;
    await page.waitForTimeout(pollMs);
  }
  return false;
}

async function fillFirst(page, selectors, value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.fill(String(value));
      return true;
    }
  }
  return false;
}

export async function fillPersonalFields(page, personal) {
  const results = {};
  results.firstName = await fillFirst(page, [
    'input[name="firstname"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]',
  ], personal.firstName);
  results.lastName = await fillFirst(page, [
    'input[name="lastname"]', 'input[name="lastName"]', 'input[autocomplete="family-name"]',
  ], personal.lastName);
  results.email = await fillFirst(page, [
    'input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]',
  ], personal.email);
  results.phone = await fillFirst(page, [
    'input[name="phone"]', 'input[name="phoneNumber"]', 'input[type="tel"]',
  ], personal.phone);
  results.address = await fillFirst(page, [
    'input[name="address"]', 'input[autocomplete="street-address"]',
  ], personal.address);
  results.city = await fillFirst(page, [
    'input[name="city"]', 'input[autocomplete="address-level2"]',
  ], personal.city);
  results.state = await fillFirst(page, [
    'input[name="state"]', 'input[name="region"]', 'input[autocomplete="address-level1"]',
  ], personal.state);
  results.postalCode = await fillFirst(page, [
    'input[name="postcode"]', 'input[name="postalCode"]', 'input[autocomplete="postal-code"]',
  ], personal.postalCode);
  results.country = await fillFirst(page, [
    'input[name="country"]', 'input[autocomplete="country-name"]',
  ], personal.country);
  return results;
}

export async function uploadResume(page, resumePath) {
  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();
  if (count === 0) throw new NeedsAttentionError('No resume upload field was found.');
  await fileInputs.first().setInputFiles(resumePath);
}

async function questionText(locator) {
  return locator.evaluate((element) => {
    const name = element.getAttribute('name');
    const id = element.id;
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (!['radio', 'checkbox'].includes(type) && id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit?.textContent?.trim()) return explicit.textContent.trim();
    }
    let candidate = '';
    let current = element.parentElement;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const text = current.innerText?.trim();
      const sameGroup = name
        ? current.querySelectorAll(`input[name="${CSS.escape(name)}"]`).length
        : 0;
      const allControls = current.querySelectorAll('input, textarea, select').length;
      if (text && text.length <= 600 && sameGroup > 1 && allControls === sameGroup) {
        if (text.length > candidate.length) candidate = text;
        continue;
      }
      if (candidate && allControls > sameGroup) return candidate;
      if (text && text.length <= 600 && depth >= 2 && !candidate) candidate = text;
    }
    if (candidate) return candidate;
    if (id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit?.textContent?.trim()) return explicit.textContent.trim();
    }
    return element.getAttribute('name') || '';
  });
}

async function optionText(locator) {
  return locator.evaluate((element) => {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    const wrappingLabel = element.closest('label');
    return wrappingLabel?.innerText?.trim() || element.value || '';
  });
}

export async function inspectApplicationFields(page) {
  const knownLabels = {
    firstname: 'First name', lastname: 'Last name', email: 'Email', phone: 'Phone',
    address: 'Address', city: 'City', postcode: 'Postal code', country: 'Country',
    cover_letter: 'Cover letter',
  };
  const fields = [];
  const byKey = new Map();
  const inputs = page.locator('input, textarea, select');
  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    if (!await input.isVisible().catch(() => false)) continue;
    const type = (await input.getAttribute('type') ||
      await input.evaluate((element) => element.tagName.toLowerCase())).toLowerCase();
    if (['hidden', 'submit', 'button'].includes(type)) continue;
    const name = await input.getAttribute('name') || await input.getAttribute('id') || '';
    const question = type === 'file' ? 'Resume' : knownLabels[name] || await questionText(input);
    const key = ['radio', 'checkbox'].includes(type)
      ? `${type}:${normalizeText(question)}`
      : `${name}:${type}`;
    let field = byKey.get(key);
    if (!field) {
      field = {
        name,
        type,
        required: await input.getAttribute('required') !== null ||
          await input.getAttribute('aria-required') === 'true',
        question: question.replace(/\s+/g, ' ').trim(),
        options: [],
      };
      byKey.set(key, field);
      fields.push(field);
    }
    if (['radio', 'checkbox'].includes(type)) {
      const option = (await optionText(input)).replace(/\s+/g, ' ').trim();
      if (option && !field.options.includes(option)) field.options.push(option);
    }
  }
  return fields;
}

async function chooseOption(page, input, expectedValues) {
  const name = await input.getAttribute('name');
  if (!name) return false;
  const options = page.locator(`input[name="${name.replaceAll('"', '\\"')}"]`);
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    const text = normalizeText(await optionText(option));
    const matched = expectedValues.some((value) => text.includes(normalizeText(value)));
    if (matched) {
      await option.check();
      return true;
    }
  }
  return false;
}

export async function fillConfiguredAnswers(page, rules, { onlyCustomNames = false, job } = {}) {
  const unresolved = [];
  const handledGroups = new Set();
  const inputs = page.locator('input, textarea, select');

  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    if (!await input.isVisible().catch(() => false)) continue;
    const type = (await input.getAttribute('type') || '').toLowerCase();
    if (['file', 'hidden', 'submit', 'button'].includes(type)) continue;
    const name = await input.getAttribute('name') || '';
    if (onlyCustomNames && !/^CA_/i.test(name)) continue;
    if (['firstname', 'lastname', 'email', 'phone', 'address', 'city', 'postcode', 'country'].includes(name)) {
      continue;
    }
    if (['radio', 'checkbox'].includes(type) && handledGroups.has(name)) continue;
    if (['radio', 'checkbox'].includes(type)) handledGroups.add(name);

    const question = await questionText(input);
    let rule = findAnswerRule(rules, question);
    if (!rule && type === 'checkbox') {
      rule = findAnswerRule(rules, `${question} ${await optionText(input)}`);
    }
    const required = await input.getAttribute('required') !== null ||
      await input.getAttribute('aria-required') === 'true';
    if (!rule) {
      if (required && type !== 'checkbox') unresolved.push(question);
      continue;
    }

    const values = rule.valueFrom ? resolveRuleValues(rule, { job }) : answerValues(rule);
    if (values.length === 0) {
      if (required) unresolved.push(question);
      continue;
    }
    if (['radio', 'checkbox'].includes(type)) {
      if (!await chooseOption(page, input, values)) unresolved.push(question);
    } else if (await input.evaluate((element) => element.tagName === 'SELECT')) {
      let selected = false;
      for (const value of values) {
        selected = await input.selectOption({ label: value }).then(() => true).catch(() => false);
        if (selected) break;
      }
      if (!selected) unresolved.push(question);
    } else {
      await input.fill(values[0] || '');
    }
  }
  return [...new Set(unresolved.map((value) => value.replace(/\s+/g, ' ').trim()))];
}

export async function listInvalidRequiredFields(page) {
  return page.locator('input:invalid, textarea:invalid, select:invalid').evaluateAll((elements) =>
    elements.filter((element) => element.required && element.type !== 'checkbox').map((element) => {
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
      return (label?.textContent || element.getAttribute('name') || element.id || element.tagName).trim();
    })
  );
}
