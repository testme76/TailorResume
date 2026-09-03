const NOISE_FRAME_URL = /(?:platform\.twitter\.com\/widgets|facebook\.com\/plugins|linkedin\.com\/embed|doubleclick\.net|googletagmanager\.com)/i;
const SCRIPT_PREFIX = /^(?:!function\s*\(|\(function\s*\(|webpackJsonp|var\s+webpack)/i;
const JOB_SECTIONS = /responsibilit|qualification|requirements|about (?:the )?(?:job|role)|what you(?:'|’)ll do|job description|education and experience|role and responsibilities/gi;

export function isNoiseFrame(frame) {
  const text = String(frame?.selected || frame?.body || '').trim();
  if (NOISE_FRAME_URL.test(String(frame?.url || ''))) return true;
  if (text.length > 1000 && SCRIPT_PREFIX.test(text.slice(0, 200))) return true;
  return false;
}

export function frameScore(frame) {
  if (isNoiseFrame(frame)) return Number.NEGATIVE_INFINITY;
  const selected = String(frame?.selected || '');
  const text = selected.length >= 40 ? selected : String(frame?.body || '');
  const sectionHits = (text.match(JOB_SECTIONS) || []).length;
  const headingBonus = frame?.heading && frame.heading.length <= 200 ? 6000 : 0;
  const titleBonus = /(?:career|job|engineer|developer|analyst|manager|designer)/i.test(frame?.title || '')
    ? 2500
    : 0;
  return (selected.length >= 40 ? 100000 : 0)
    + Math.min(text.length, 20000)
    + sectionHits * 2500
    + headingBonus
    + titleBonus;
}

export function bestFrame(results) {
  return results
    .map((result) => result.result)
    .filter((result) => result?.body?.length >= 40 || result?.selected?.length >= 40)
    .filter((result) => !isNoiseFrame(result))
    .sort((left, right) => frameScore(right) - frameScore(left))[0];
}
