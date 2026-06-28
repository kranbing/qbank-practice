import fs from 'node:fs';

const file = new URL('../questions.json', import.meta.url);
const questions = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(questions.map(question => [question.id, question]));

function moveTail(sourceId, targetId, marker) {
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  const match = marker.exec(source.stem);
  if (!match) {
    if (source.page && target.page) return;
    throw new Error(`${sourceId} 未找到拆分标记`);
  }
  target.stem = source.stem.slice(match.index + match[0].length).trim();
  source.stem = source.stem.slice(0, match.index).trim();
}

function keepThroughFirstPage(id) {
  const question = byId.get(id);
  const match = /[Pp]\s*\d+(?:\s*[-－—~～]\s*\d+)?\s*[】\])}]?/.exec(question.stem);
  if (!match) {
    if (question.page) return;
    throw new Error(`${id} 未找到首个页码`);
  }
  question.stem = question.stem.slice(0, match.index + match[0].length).trim();
}

// 修复 OCR 将下一题粘连到上一题的记录。
keepThroughFirstPage('判断-47');
keepThroughFirstPage('判断-53');
moveTail('判断-57', '判断-58', /\n\s*58\s*[,，]\s*/);
keepThroughFirstPage('判断-70');
keepThroughFirstPage('判断-89');
moveTail('判断-97', '判断-98', /\n\s*98\s*[,，]\s*/);
moveTail('判断-100', '判断-102', /\n\s*102\s*/);
moveTail('判断-100', '判断-101', /\n\s*101\s*[.．]\s*/);
moveTail('判断-104', '判断-105', /\n\s*105\s*/);

const question109 = byId.get('判断-109');
const question109FirstPage = /[Pp]\s*215\s*[】\])}]?/.exec(question109.stem);
if (question109FirstPage) {
  byId.get('判断-110').stem = question109.stem.slice(question109FirstPage.index + question109FirstPage[0].length).trim();
  question109.stem = question109.stem.slice(0, question109FirstPage.index + question109FirstPage[0].length).trim();
} else if (!question109.page || !byId.get('判断-110').page) {
  throw new Error('判断-109 未找到拆分页码');
}

const question130 = byId.get('判断-130');
const marker131 = /\n\s*131\s*[.．]\s*/.exec(question130.stem);
const marker132 = /\n\s*132\s*/.exec(question130.stem);
if (marker131 && marker132) {
  byId.get('判断-131').stem = question130.stem.slice(marker131.index + marker131[0].length, marker132.index).trim();
  question130.stem = question130.stem.slice(0, marker131.index).trim();
} else if (!question130.page || !byId.get('判断-131').page) {
  throw new Error('判断-130 未找到拆分标记');
}

moveTail('判断-138', '判断-140', /\n\s*140\s*[,，]\s*/);
moveTail('判断-138', '判断-139', /\n\s*139\s*[,，]\s*/);
moveTail('判断-142', '判断-143', /\n\s*143\s*[,，]\s*/);
moveTail('判断-146', '判断-147', /\n\s*147\s*[.．]\s*/);
moveTail('判断-150', '判断-151', /\n\s*151\s*[,，]\s*/);
moveTail('判断-152', '判断-153', /\n\s*153\s*[,，]\s*/);
moveTail('判断-155', '判断-156', /\n\s*156\s*[,，]\s*/);
moveTail('判断-161', '判断-162', /\n\s*1562\s*[,，]\s*/);
moveTail('判断-165', '判断-166', /\n\s*156\s*[,，]\s*/);
keepThroughFirstPage('判断-173');

// 单选 261 的题干误落入上一题 D 选项。
const question260OptionD = byId.get('单选-260').options.find(option => option.label === 'D');
const misplacedStem = /\n\s*(（[\s\S]+)$/.exec(question260OptionD.text);
if (misplacedStem) {
  byId.get('单选-261').stem = misplacedStem[1].trim();
  question260OptionD.text = question260OptionD.text.slice(0, misplacedStem.index).trim();
} else if (!byId.get('单选-261').page) {
  throw new Error('单选-260 未找到误置题干');
}

const pageOverrides = {
  '单选-271': { page: '266', source: 'inferred' },
  '单选-278': { page: '270', source: 'inferred' },
  '单选-357': { page: '338', source: 'inferred' },
  '判断-49': { page: '84', source: 'inferred' },
  '判断-61': { page: '113', source: 'inferred' },
  '判断-65': { page: '121', source: 'recovered' },
  '判断-84': { page: '164', source: 'recovered' },
  '判断-91': { page: '183', source: 'recovered' },
  '判断-93': { page: '186', source: 'inferred' },
  '判断-159': { page: '313', source: 'recovered' },
  '判断-170': { page: '315-335', source: 'inferred-range' },
  '判断-171': { page: '337-362', source: 'inferred-range' }
};

const explicitPagePattern = /[【\[({{]*\s*([PpF])\s*(\d+(?:\s*[-－—~～]\s*\d+)?)\s*[】\])}}]*/g;
const bareTrailingPagePattern = /(\d+(?:\s*[-－—~～]\s*\d+)?)\s*[】\])}]\s*$/;

function normalizePage(value) {
  return String(value).replace(/\s+/g, '').replace(/[－—~～]/g, '-');
}

for (const question of questions) {
  let page = question.page ? normalizePage(question.page) : '';
  let pageSource = question.page_source || '';
  const explicitMatches = [...question.stem.matchAll(explicitPagePattern)];

  if (!page && explicitMatches.length) {
    page = normalizePage(explicitMatches[0][2]);
    pageSource = explicitMatches[0][1].toUpperCase() === 'P' ? 'extracted' : 'recovered';
  }

  question.stem = question.stem.replace(explicitPagePattern, '').trim();

  const bareMatch = bareTrailingPagePattern.exec(question.stem);
  if (!page && bareMatch) {
    page = normalizePage(bareMatch[1]);
    pageSource = 'recovered';
  }
  if (bareMatch) question.stem = question.stem.slice(0, bareMatch.index).trim();

  if (pageOverrides[question.id]) {
    page = pageOverrides[question.id].page;
    pageSource = pageOverrides[question.id].source;
    question.stem = question.stem
      .replace(/(?:Pad|LPG)\s*[】\])}]?\s*$/i, '')
      .replace(/\b(?:1839|3713)\s*[】\])}]?\s*$/, '')
      .trim();
  }

  if (!page) throw new Error(`${question.id} 没有页码`);
  if (!/^\d+(?:-\d+)?$/.test(page)) throw new Error(`${question.id} 页码格式错误：${page}`);

  question.page = page;
  question.page_source = pageSource || 'extracted';
}

fs.writeFileSync(file, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
console.log(`已清洗 ${questions.length} 道题，页码覆盖 ${questions.filter(question => question.page).length} 道。`);
