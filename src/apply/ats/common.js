export async function extractJsonLdJob(page) {
  const records = await page.locator('script[type="application/ld+json"]').allTextContents();
  for (const text of records) {
    try {
      const parsed = JSON.parse(text);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const job = values.find((value) => value?.['@type'] === 'JobPosting');
      if (!job) continue;
      const jd = await page.evaluate((html) => {
        const container = document.createElement('div');
        container.innerHTML = html || '';
        return container.innerText.trim();
      }, job.description);
      return {
        company: job.hiringOrganization?.name || '',
        role: job.title || '',
        jd,
      };
    } catch {
      // Ignore unrelated or malformed JSON-LD records.
    }
  }
  return null;
}

export async function extractVisibleJob(page, companyPrefix = '') {
  const role = (await page.locator('h1:visible').first().innerText()).trim();
  const body = (await page.locator('body').innerText()).trim();
  let company = '';
  const subheading = await page.locator('h2').first().innerText().catch(() => '');
  if (subheading) company = subheading.replace(new RegExp(`^${companyPrefix}`, 'i'), '').trim();
  return { company, role, jd: body };
}

export async function extractOpenGraphJob(page) {
  const role = await page.locator('meta[property="og:title"]').getAttribute('content') || '';
  const company = await page.locator('meta[property="og:site_name"]').getAttribute('content') || '';
  const jd = await page.locator('body').innerText();
  if (!role.trim() || !company.trim()) return null;
  return { role: role.trim(), company: company.trim(), jd: jd.trim() };
}
