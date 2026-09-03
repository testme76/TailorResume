import { normalizeText } from '../forms/answers.js';

export function findSecurityClearanceRequirement(jobDescription) {
  const lines = String(jobDescription || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    if (!line || !/\b(clearance|public trust|ts sci)\b/.test(line)) continue;
    if (/\b(no|none|not)\b.{0,30}\b(clearance|public trust)\b/.test(line) ||
        /\b(clearance|public trust)\b.{0,30}\b(none|no|not required|unnecessary)\b/.test(line)) {
      continue;
    }
    if (/\b(active|current|existing|required|requirement|must|possess|hold|obtain|eligible|secret|top secret|ts sci|public trust)\b/.test(line)) {
      return rawLine.trim();
    }
  }
  return null;
}

export function findUsCitizenshipRequirement(jobDescription) {
  const lines = String(jobDescription || '').split(/\r?\n/);
  const normalizedLines = lines.map((line) => normalizeText(line));
  for (const [index, rawLine] of lines.entries()) {
    const line = normalizeText(rawLine);
    if (!line || !/\b(u s|united states|us)\b.{0,25}\bcitizen(ship)?\b/.test(line)) continue;

    const context = normalizedLines
      .slice(Math.max(0, index - 2), index + 3)
      .filter(Boolean)
      .join(' ');
    const resident = String.raw`(?:(?:lawful\s+)?permanent\s+residents?|green\s+card(?:\s+holders?)?)`;
    const residentExcluded = new RegExp(
      String.raw`(?:\b${resident}\b.{0,45}\b(?:not|ineligible|excluded|cannot|can't|must not)\b|` +
      String.raw`\b(?:not|no)\b.{0,35}\b${resident}\b)`
    ).test(context);
    const inclusiveCitizenResidentList = new RegExp(
      String.raw`(?:\bcitizen(?:ship|s)?\b.{0,35}\b${resident}\b|` +
      String.raw`\b${resident}\b.{0,35}\bcitizen(?:ship|s)?\b)`
    ).test(context);
    const usPersonDefinition = new RegExp(
      String.raw`\bu s persons?\b.{0,220}\b(?:include|includes|including|means|defined|citizen)\b.{0,220}\b${resident}\b`
    ).test(context);

    if (!residentExcluded && (inclusiveCitizenResidentList || usPersonDefinition)) {
      continue;
    }
    if (/\b(no|not)\b.{0,20}\bcitizen(ship)?\b.{0,20}\brequired\b/.test(line) ||
        /\bcitizen(ship)?\b.{0,25}\b(not required|unnecessary)\b/.test(line)) {
      continue;
    }
    if (/\b(required|requirement|must|only|eligible|limited|restricted)\b/.test(line)) {
      return rawLine.trim();
    }
  }
  return null;
}
