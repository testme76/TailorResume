import { normalizeText } from '../forms/answers.js';

export function findRequiredSkipQuestion(fields, patterns = []) {
  const normalizedPatterns = patterns.map(normalizeText).filter(Boolean);
  return fields.find((field) => {
    if (!field.required) return false;
    const question = normalizeText(field.question);
    return normalizedPatterns.some((pattern) => question.includes(pattern));
  }) || null;
}

