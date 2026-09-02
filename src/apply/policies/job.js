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
  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    if (!line || !/\b(u s|united states|us)\b.{0,25}\bcitizen(ship)?\b/.test(line)) continue;
    if (/\bcitizen(ship)?\b.{0,25}\b(or|and or)\b.{0,35}\b(permanent resident|green card|lawful permanent resident)\b/.test(line) ||
        /\b(permanent resident|green card|lawful permanent resident)\b.{0,35}\b(or|and or)\b.{0,25}\bcitizen(ship)?\b/.test(line)) {
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
