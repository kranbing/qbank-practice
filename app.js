'use strict';

const STORAGE_KEY = 'full-qbank-practice-v3';
const LEGACY_KEY = 'full-qbank-practice-v2';
let questions = [];
let questionsById = new Map();
let state = loadState();
let mode = 'all';
let order = [];
let position = 0;
let current = null;
let answered = false;

const $ = id => document.getElementById(id);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) return normalizeState(saved);

    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    if (legacy) {
      const answeredMap = {};
      Object.keys(legacy.wrongs || {}).forEach(id => {
        answeredMap[id] = { correct: false, chosen: legacy.wrongs[id].chosen || '', attempts: 1 };
      });
      return normalizeState({
        answered: answeredMap,
        wrongs: legacy.wrongs,
        totalAttempts: legacy.done,
        correctAttempts: legacy.correct
      });
    }
  } catch (error) {
    console.warn('练习记录损坏，已使用空记录。', error);
  }
  return normalizeState({});
}

function normalizeState(value) {
  return {
    answered: value.answered && typeof value.answered === 'object' ? value.answered : {},
    wrongs: value.wrongs && typeof value.wrongs === 'object' ? value.wrongs : {},
    totalAttempts: Number.isFinite(value.totalAttempts) ? value.totalAttempts : 0,
    correctAttempts: Number.isFinite(value.correctAttempts) ? value.correctAttempts : 0
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function validateQuestions(data) {
  if (!Array.isArray(data) || data.length === 0) throw new Error('题库必须是非空数组');
  const ids = new Set();
  data.forEach((q, index) => {
    if (!q || typeof q.id !== 'string' || !q.id || ids.has(q.id)) throw new Error(`第 ${index + 1} 题的 id 缺失或重复`);
    if (typeof q.stem !== 'string' || !q.stem.trim() || !Array.isArray(q.options) || !q.options.length) throw new Error(`题目 ${q.id} 的题干或选项无效`);
    if (typeof q.answer !== 'string') throw new Error(`题目 ${q.id} 的答案无效`);
    const labels = new Set(q.options.map(option => option.label));
    if (labels.size !== q.options.length || q.options.some(option => typeof option.label !== 'string' || !option.label || typeof option.text !== 'string' || !option.text.trim())) throw new Error(`题目 ${q.id} 存在无效或重复选项`);
    if ([...q.answer].some(label => !labels.has(label)) && !labels.has(q.answer)) throw new Error(`题目 ${q.id} 的答案不在选项中`);
    ids.add(q.id);
  });
  return data;
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch('./questions.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    questions = validateQuestions(await response.json());
    questionsById = new Map(questions.map(question => [question.id, question]));
    cleanState();
    updateSummary();
    start('all');
  } catch (error) {
    console.error(error);
    $('stem').textContent = location.protocol === 'file:'
      ? '浏览器不允许网页直接读取旁边的 questions.json。请按 README 使用本地服务器启动。'
      : `题库加载失败：${error.message}`;
    $('feedback').className = 'feedback bad';
    $('feedback').textContent = '请确认 questions.json 与 index.html 位于同一目录，并通过 HTTP 访问本页面。';
  }
}

function cleanState() {
  for (const id of Object.keys(state.answered)) if (!questionsById.has(id)) delete state.answered[id];
  for (const id of Object.keys(state.wrongs)) if (!questionsById.has(id)) delete state.wrongs[id];
  saveState();
}

function updateSummary() {
  const counts = questions.reduce((result, question) => {
    result[question.type] = (result[question.type] || 0) + 1;
    return result;
  }, {});
  const detail = Object.entries(counts).map(([type, count]) => `${type} ${count}`).join('、');
  $('summary').textContent = `题库共 ${questions.length} 题（${detail}）；随机顺序，未做题目优先。`;
}

function normalizeText(value) {
  const radicalReplacements = {
    '⺠':'民', '⻅':'见', '⻆':'角', '⻋':'车', '⻓':'长', '⻔':'门', '⻘':'青',
    '⻛':'风', '⻜':'飞', '⻝':'食', '⻢':'马', '⻣':'骨', '⻬':'齐'
  };
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[⺠⻅⻆⻋⻓⻔⻘⻛⻜⻝⻢⻣⻬]/g, char => radicalReplacements[char]);
}

function getQuestionDisplay(question) {
  let stem = normalizeText(question.stem);
  let page = '';
  const pagePattern = /[【\[({{]?\s*[Pp]\s*(\d+(?:\s*[-－—~～]\s*\d+)?)\s*[】\])}}]?/g;
  stem = stem.replace(pagePattern, (match, number) => {
    page = number.replace(/\s+/g, '').replace(/[－—~～]/g, '-');
    return '';
  });
  stem = stem
    .replace(/[【\[({{]\s*$/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { stem, page };
}

function start(nextMode = 'all') {
  mode = nextMode;
  if (mode === 'wrong') {
    order = shuffle(questions.filter(q => state.wrongs[q.id]).map(q => q.id));
  } else {
    const unseen = questions.filter(q => !state.answered[q.id]).map(q => q.id);
    const seen = questions.filter(q => state.answered[q.id]).map(q => q.id);
    order = [...shuffle(unseen), ...shuffle(seen)];
  }
  position = 0;
  render();
}

function render() {
  resetQuestionUi();
  if (!order.length) {
    current = null;
    $('stem').textContent = mode === 'wrong' ? '暂无错题，继续保持！' : '题库中没有可练习的题目。';
    updateStats();
    return;
  }

  current = questionsById.get(order[position]);
  if (!current) {
    order.splice(position, 1);
    if (position >= order.length) position = 0;
    render();
    return;
  }

  const isNew = !state.answered[current.id];
  const display = getQuestionDisplay(current);
  $('modePill').textContent = mode === 'wrong' ? '错题练习' : (isNew ? '未做优先' : '随机复习');
  $('numPill').textContent = `本轮 ${position + 1} / ${order.length}`;
  $('typeBadge').textContent = normalizeText(current.type);
  $('chapPill').textContent = `第${current.chapter}章${display.page ? `-P${display.page}` : ''}`;
  $('stem').textContent = display.stem;
  $('bar').style.width = `${questions.length ? Object.keys(state.answered).length / questions.length * 100 : 0}%`;

  const inputType = current.type === '多选' ? 'checkbox' : 'radio';
  $('options').innerHTML = current.options.map(option => `
    <label class="opt" data-label="${escapeHtml(option.label)}">
      <input name="ans" type="${inputType}" value="${escapeHtml(option.label)}">
      <div><b>${escapeHtml(normalizeText(option.label))}</b>. ${escapeHtml(normalizeText(option.text))}</div>
    </label>`).join('');
  document.querySelectorAll('.opt').forEach(option => {
    option.addEventListener('change', updateSelectedStyles);
  });
  $('submitBtn').disabled = false;
  updateStats();
}

function resetQuestionUi() {
  answered = false;
  $('feedback').className = 'feedback';
  $('feedback').textContent = '';
  $('options').innerHTML = '';
  $('nextBtn').disabled = true;
  $('submitBtn').disabled = true;
}

function updateSelectedStyles() {
  document.querySelectorAll('.opt').forEach(option => {
    option.classList.toggle('sel', option.querySelector('input').checked);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
}

function selectedAnswer() {
  return Array.from(document.querySelectorAll('input[name="ans"]:checked'))
    .map(input => input.value)
    .sort()
    .join('');
}

function submit() {
  if (!current || answered) return;
  const chosen = selectedAnswer();
  if (!chosen) {
    $('feedback').className = 'feedback info';
    $('feedback').textContent = '请先选择答案。';
    return;
  }

  answered = true;
  const expected = [...current.answer].sort().join('');
  const correct = chosen === expected;
  const previous = state.answered[current.id];
  state.totalAttempts += 1;
  if (correct) state.correctAttempts += 1;
  state.answered[current.id] = {
    correct,
    chosen,
    attempts: (previous?.attempts || 0) + 1,
    lastAt: new Date().toISOString()
  };
  if (correct) {
    delete state.wrongs[current.id];
  } else {
    state.wrongs[current.id] = { id: current.id, chosen, at: new Date().toISOString() };
  }
  saveState();

  document.querySelectorAll('.opt').forEach(option => {
    const label = option.dataset.label;
    if (answerContains(current.answer, label)) option.classList.add('correct');
    if (answerContains(chosen, label) && !answerContains(current.answer, label)) option.classList.add('wrong');
    option.querySelector('input').disabled = true;
  });
  $('feedback').className = `feedback ${correct ? 'ok' : 'bad'}`;
  $('feedback').textContent = correct ? '回答正确。' : `回答错误。正确答案：${current.answer}；你的答案：${chosen}`;
  $('submitBtn').disabled = true;
  $('nextBtn').disabled = false;
  updateStats();
}

function answerContains(answer, label) {
  return answer === label || answer.includes(label);
}

function next() {
  if (!order.length) return;
  if (position + 1 < order.length) {
    position += 1;
    render();
  } else {
    start(mode);
  }
}

function updateStats() {
  const doneCount = Object.keys(state.answered).length;
  const wrongIds = Object.keys(state.wrongs).filter(id => questionsById.has(id));
  $('done').textContent = doneCount;
  $('acc').textContent = state.totalAttempts ? `${Math.round(state.correctAttempts / state.totalAttempts * 100)}%` : '0%';
  $('wrongCount').textContent = wrongIds.length;
  $('left').textContent = Math.max(0, questions.length - doneCount);
  $('bar').style.width = `${questions.length ? doneCount / questions.length * 100 : 0}%`;

  if (!wrongIds.length) {
    $('wrongList').textContent = '暂无错题';
    return;
  }
  $('wrongList').innerHTML = wrongIds
    .sort((a, b) => (state.wrongs[b].at || '').localeCompare(state.wrongs[a].at || ''))
    .slice(0, 12)
    .map(id => {
      const question = questionsById.get(id);
      const wrong = state.wrongs[id];
      const display = getQuestionDisplay(question);
      return `<div class="wrongItem"><b>${escapeHtml(normalizeText(question.type))}${escapeHtml(question.source_number)}</b>：${escapeHtml(display.stem).slice(0, 70)}…<br><span class="muted">正确：${escapeHtml(question.answer)}；你的：${escapeHtml(wrong.chosen)}</span></div>`;
    }).join('');
}

function exportWrongs() {
  const rows = Object.keys(state.wrongs).filter(id => questionsById.has(id)).map(id => {
    const question = questionsById.get(id);
    const wrong = state.wrongs[id];
    const display = getQuestionDisplay(question);
    return `${normalizeText(question.type)}${question.source_number}\t第${question.chapter}章${display.page ? `-P${display.page}` : ''}\t${display.stem.replace(/\r?\n/g, ' ')}\t正确:${question.answer}\t你的:${wrong.chosen}`;
  }).join('\n');
  const blob = new Blob([rows || '暂无错题'], { type:'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '错题记录.txt';
  link.click();
  URL.revokeObjectURL(url);
}

function downloadFile(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportProgress() {
  const payload = {
    format: 'qbank-practice-progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    state
  };
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(JSON.stringify(payload, null, 2), 'application/json;charset=utf-8', `题库练习进度-${date}.json`);
}

async function importProgressFile(file) {
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('进度文件不能超过 1 MB');
    const payload = JSON.parse(await file.text());
    if (payload?.format !== 'qbank-practice-progress' || payload?.version !== 1 || !payload.state) {
      throw new Error('这不是本站导出的进度文件');
    }
    const imported = normalizeState(payload.state);
    if (imported.totalAttempts < 0 || imported.correctAttempts < 0 || imported.correctAttempts > imported.totalAttempts) {
      throw new Error('进度统计数据无效');
    }
    if (!confirm('导入后将覆盖当前浏览器中的练习进度，确定继续吗？')) return;
    state = imported;
    cleanState();
    start('all');
    $('feedback').className = 'feedback ok';
    $('feedback').textContent = '练习进度导入成功。';
  } catch (error) {
    $('feedback').className = 'feedback bad';
    $('feedback').textContent = `进度导入失败：${error.message}`;
  } finally {
    $('progressFile').value = '';
  }
}

function bindEvents() {
  $('submitBtn').addEventListener('click', submit);
  $('nextBtn').addEventListener('click', next);
  $('randomBtn').addEventListener('click', () => start('all'));
  $('wrongBtn').addEventListener('click', () => start('wrong'));
  $('clearBtn').addEventListener('click', () => {
    if (confirm('确定清空错题记录吗？')) {
      state.wrongs = {};
      saveState();
      if (mode === 'wrong') start('wrong'); else updateStats();
    }
  });
  $('exportBtn').addEventListener('click', exportWrongs);
  $('exportProgressBtn').addEventListener('click', exportProgress);
  $('importProgressBtn').addEventListener('click', () => $('progressFile').click());
  $('progressFile').addEventListener('change', event => importProgressFile(event.target.files[0]));
}

initialize();
