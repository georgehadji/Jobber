// server/gap.mjs — the "gap" task: zero-LLM, in memory, no files.
import { extractJdSkills, classifySkillGaps } from '../jd-skill-gap.mjs';

export function runGap(cvText, jobText) {
  const skills = extractJdSkills(jobText.replace(/\r\n?/g, '\n'));
  return { task: 'gap', jobSkillCount: skills.length, ...classifySkillGaps(skills, cvText) };
}
