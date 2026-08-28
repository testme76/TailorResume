export function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function findAnswerRule(rules, question) {
  const normalizedQuestion = normalizeText(question);
  return rules.find((rule) => {
    const match = normalizeText(rule.match);
    return match && normalizedQuestion.includes(match);
  }) || null;
}

export function answerValues(rule) {
  if (!rule) return [];
  return (Array.isArray(rule.value) ? rule.value : [rule.value])
    .map((value) => String(value).trim())
    .filter(Boolean);
}

