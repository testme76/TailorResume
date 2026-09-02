function monetaryValues(text) {
  const pattern = /(?:USD\s*)?\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kK])?/g;
  const values = [];
  for (const match of text.matchAll(pattern)) {
    let amount = Number(match[1].replaceAll(',', ''));
    if (match[2]) amount *= 1000;
    if (Number.isFinite(amount) && (amount >= 1000 || match[2] || amount >= 10)) {
      values.push(amount);
    }
  }
  return values;
}

export function extractSalaryHighEnd(jobDescription) {
  const lines = String(jobDescription || '').split(/\r?\n/);
  const compensationLines = lines.filter((line) =>
    /salary|compensation|pay range|base pay|wage/i.test(line)
  );
  const candidates = compensationLines.length > 0 ? compensationLines : lines;

  for (const line of candidates) {
    const values = monetaryValues(line);
    if (values.length === 0) continue;
    const amount = Math.max(...values);
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
    if (/\b(hour|hourly|hr)\b/i.test(line)) return `${formatted}/hour`;
    if (/\b(year|yearly|yr|annual|annually)\b/i.test(line)) return `${formatted}/year`;
    return formatted;
  }
  return '';
}

export function resolveRuleValues(rule, { job } = {}) {
  if (rule?.valueFrom === 'job.salaryHighEnd') {
    const value = extractSalaryHighEnd(job?.jd);
    return value ? [value] : [];
  }
  const raw = Array.isArray(rule?.value) ? rule.value : [rule?.value];
  return raw.map((value) => String(value ?? '').trim()).filter(Boolean);
}

