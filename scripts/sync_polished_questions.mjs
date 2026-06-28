import fs from 'node:fs';

const targetFile = new URL('../questions.json', import.meta.url);
const polishedFile = new URL('../questions_polished_array.json', import.meta.url);
const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
const polished = JSON.parse(fs.readFileSync(polishedFile, 'utf8'));

const pagePattern = /[【\[({]?\s*[Pp]\s*(\d+(?:\s*[-－—~～]\s*\d+)?)\s*[】\])}]?\s*$/;
const normalizePage = value => String(value).replace(/\s+/g, '').replace(/[－—~～]/g, '-');
const targetById = new Map(target.map(question => [question.id, question]));
const polishedById = new Map(polished.map(question => [question.id, question]));

if (targetById.size !== target.length || polishedById.size !== polished.length) {
  throw new Error('题库中存在重复 ID');
}

const missing = target.filter(question => !polishedById.has(question.id)).map(question => question.id);
const extra = polished.filter(question => !targetById.has(question.id)).map(question => question.id);
if (missing.length || extra.length) {
  throw new Error(`题目 ID 不一致；润色版缺少：${missing.join('、') || '无'}；润色版新增：${extra.join('、') || '无'}`);
}

let pageUpdates = 0;
for (const question of target) {
  const source = polishedById.get(question.id);
  for (const key of ['type', 'chapter', 'source_number']) {
    if (question[key] !== source[key]) {
      throw new Error(`${question.id} 的 ${key} 与润色版不一致`);
    }
  }

  const pageMatch = source.stem.match(pagePattern);
  const polishedPage = pageMatch ? normalizePage(pageMatch[1]) : '';
  const stem = pageMatch ? source.stem.slice(0, pageMatch.index).trim() : source.stem.trim();
  if (!stem) throw new Error(`${question.id} 的润色题干为空`);

  if (polishedPage && polishedPage !== question.page) {
    question.page = polishedPage;
    question.page_source = 'polished';
    pageUpdates += 1;
  }
  question.stem = stem;
  question.options = source.options;
  question.answer = source.answer;
}

const repeatedLabelOptions = [];
const duplicateOptions = [];
for (const question of target) {
  if (!Array.isArray(question.options) || question.options.length < 2) {
    throw new Error(`${question.id} 的选项无效`);
  }
  const labels = new Set(question.options.map(option => option.label));
  if (labels.size !== question.options.length) throw new Error(`${question.id} 存在重复选项标签`);
  if (![...question.answer].every(label => labels.has(label)) && !labels.has(question.answer)) {
    throw new Error(`${question.id} 的答案不在选项中：${question.answer}`);
  }

  const texts = new Map();
  for (const option of question.options) {
    const label = option.label.trim();
    const text = option.text.trim();
    if (text === label) repeatedLabelOptions.push(`${question.id}-${label}`);
    if (texts.has(text)) duplicateOptions.push(`${question.id}-${texts.get(text)}/${label}`);
    texts.set(text, label);
  }
}

if (duplicateOptions.length) {
  throw new Error(`存在文本完全相同的选项：${duplicateOptions.join('、')}`);
}

fs.writeFileSync(targetFile, `${JSON.stringify(target, null, 2)}\n`, 'utf8');
console.log(`已同步 ${target.length} 道题；更新页码 ${pageUpdates} 处。`);
console.log(`标签与文本相同的选项 ${repeatedLabelOptions.length} 个（由网页统一去重展示）。`);
