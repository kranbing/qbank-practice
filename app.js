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

function normalizeState(value = {}) {
  return {
    answered: value.answered && typeof value.answered === 'object' ? value.answered : {},
    wrongs: value.wrongs && typeof value.wrongs === 'object' ? value.wrongs : {},
    favorites: value.favorites && typeof value.favorites === 'object' ? value.favorites : {},
    totalAttempts: Number.isFinite(value.totalAttempts) ? value.totalAttempts : 0,
    correctAttempts: Number.isFinite(value.correctAttempts) ? value.correctAttempts : 0
  };
}

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
  return normalizeState();
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
  if (!Array.isArray(data) || !data.length) throw new Error('题库必须是非空数组');
  const ids = new Set();
  data.forEach((question, index) => {
    if (!question || typeof question.id !== 'string' || !question.id || ids.has(question.id)) {
      throw new Error(`第 ${index + 1} 题的 id 缺失或重复`);
    }
    if (typeof question.stem !== 'string' || !question.stem.trim() || !Array.isArray(question.options) || !question.options.length) {
      throw new Error(`题目 ${question.id} 的题干或选项无效`);
    }
    if (typeof question.answer !== 'string') throw new Error(`题目 ${question.id} 的答案无效`);
    if (typeof question.page !== 'string' || !/^\d+(?:-\d+)?$/.test(question.page)) throw new Error(`题目 ${question.id} 的页码无效`);
    const labels = new Set(question.options.map(option => option.label));
    if (labels.size !== question.options.length || question.options.some(option => typeof option.label !== 'string' || !option.label || typeof option.text !== 'string' || !option.text.trim())) {
      throw new Error(`题目 ${question.id} 存在无效或重复选项`);
    }
    if ([...question.answer].some(label => !labels.has(label)) && !labels.has(question.answer)) {
      throw new Error(`题目 ${question.id} 的答案不在选项中`);
    }
    ids.add(question.id);
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
      ? '浏览器不允许网页直接读取旁边的 questions.json，请按 README 使用本地服务器启动。'
      : `题库加载失败：${error.message}`;
    $('feedback').className = 'feedback bad';
    $('feedback').textContent = '请确认 questions.json 与 index.html 位于同一目录，并通过 HTTP 访问本页面。';
  }
}

function cleanState() {
  ['answered', 'wrongs', 'favorites'].forEach(key => {
    Object.keys(state[key]).forEach(id => {
      if (!questionsById.has(id)) delete state[key][id];
    });
  });
  saveState();
}

function updateSummary() {
  const counts = questions.reduce((result, question) => {
    result[question.type] = (result[question.type] || 0) + 1;
    return result;
  }, {});
  const detail = Object.entries(counts).map(([type, count]) => `${type} ${count}`).join('、');
  $('summary').textContent = `题库共 ${questions.length} 题（${detail}）；每次继续完成所有剩余未做题。`;
}

function normalizeText(value) {
  const radicalReplacements = {
    '⺠': '民', '⻅': '见', '⻆': '角', '⻋': '车', '⻓': '长', '⻔': '门', '⻘': '青',
    '⻛': '风', '⻜': '飞', '⻝': '食', '⻢': '马', '⻣': '骨', '⻬': '齐'
  };
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[⺠⻅⻆⻋⻓⻔⻘⻛⻜⻝⻢⻣⻬]/g, char => radicalReplacements[char]);
}

function getQuestionDisplay(question) {
  let stem = normalizeText(question.stem);
  let extractedPage = '';
  const pagePattern = /[【\[({]?\s*[Pp]\s*(\d+(?:\s*[-－—~～]\s*\d+)?)\s*[】\])}]?/g;
  stem = stem.replace(pagePattern, (match, number) => {
    extractedPage = number.replace(/\s+/g, '').replace(/[－—~～]/g, '-');
    return '';
  });
  stem = stem.replace(/[【\[({]\s*$/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { stem, page: normalizeText(question.page || '') || extractedPage };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function getOptionDisplay(option) {
  const label = normalizeText(option.label).trim();
  const text = normalizeText(option.text).trim();
  return label === text ? escapeHtml(text) : `<b>${escapeHtml(label)}</b>. ${escapeHtml(text)}`;
}

function getWrongQuestionIds() {
  return Object.keys(state.wrongs).filter(id => questionsById.has(id));
}

function getFavoriteQuestionIds() {
  return Object.keys(state.favorites).filter(id => questionsById.has(id));
}

function getRemainingQuestionIds() {
  return questions.filter(question => !state.answered[question.id]).map(question => question.id);
}

function start(nextMode = 'all') {
  mode = nextMode;
  if (mode === 'wrong') order = shuffle(getWrongQuestionIds());
  else if (mode === 'favorite') order = getFavoriteQuestionIds();
  else order = shuffle(getRemainingQuestionIds());
  position = 0;
  render();
}

function resetQuestionUi() {
  answered = false;
  $('feedback').className = 'feedback';
  $('feedback').textContent = '';
  $('options').innerHTML = '';
  $('typeBadge').textContent = '';
  $('chapPill').textContent = '';
  $('nextBtn').textContent = '下一题';
  $('nextBtn').disabled = true;
  $('submitBtn').disabled = true;
  $('favoriteToggle').disabled = true;
}

function render() {
  resetQuestionUi();
  $('returnBtn').hidden = mode === 'all';

  if (!order.length) {
    current = null;
    const messages = {
      all: '所有题目都已完成，做得漂亮！你仍可查看错题或收藏。',
      wrong: '暂无错题，继续保持！',
      favorite: '暂无收藏题目。'
    };
    $('modePill').textContent = mode === 'wrong' ? '错题练习' : mode === 'favorite' ? '我的收藏' : '未做题目';
    $('stem').textContent = messages[mode];
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

  const display = getQuestionDisplay(current);
  $('modePill').textContent = mode === 'wrong' ? '错题练习' : mode === 'favorite' ? '我的收藏' : '未做题目';
  $('typeBadge').textContent = normalizeText(current.type);
  $('chapPill').textContent = `第${current.chapter}章${display.page ? ` · P${display.page}` : ''}`;
  $('stem').textContent = display.stem;
  updateFavoriteButton();

  const inputType = current.type === '多选' ? 'checkbox' : 'radio';
  $('options').innerHTML = current.options.map(option => `
    <label class="opt" data-label="${escapeHtml(option.label)}">
      <input name="ans" type="${inputType}" value="${escapeHtml(option.label)}">
      <div>${getOptionDisplay(option)}</div>
    </label>`).join('');
  document.querySelectorAll('.opt').forEach(option => option.addEventListener('change', updateSelectedStyles));
  $('submitBtn').disabled = false;
  updateStats();
}

function updateSelectedStyles() {
  document.querySelectorAll('.opt').forEach(option => {
    option.classList.toggle('sel', option.querySelector('input').checked);
  });
}

function selectedAnswer() {
  return Array.from(document.querySelectorAll('input[name="ans"]:checked'))
    .map(input => input.value).sort().join('');
}

function answerContains(answer, label) {
  return answer === label || answer.includes(label);
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
  if (correct) delete state.wrongs[current.id];
  else state.wrongs[current.id] = { id: current.id, chosen, at: new Date().toISOString() };
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

function next() {
  if (!order.length) return;

  if (mode === 'wrong' && !getWrongQuestionIds().length) {
    start('all');
    return;
  }
  if (mode === 'favorite') {
    order = order.filter(id => state.favorites[id]);
    if (!order.length) {
      render();
      return;
    }
    const currentIndex = order.indexOf(current?.id);
    position = currentIndex < 0 ? Math.min(position, order.length - 1) : currentIndex + 1;
  } else {
    position += 1;
  }

  if (position < order.length) render();
  else start(mode);
}

function updateFavoriteButton() {
  const isFavorite = Boolean(current && state.favorites[current.id]);
  $('favoriteToggle').disabled = !current;
  $('favoriteToggle').classList.toggle('active', isFavorite);
  $('favoriteToggle').textContent = isFavorite ? '★ 已收藏' : '☆ 收藏';
  $('favoriteToggle').setAttribute('aria-pressed', String(isFavorite));
}

function toggleFavorite(id = current?.id) {
  if (!id || !questionsById.has(id)) return;
  if (state.favorites[id]) delete state.favorites[id];
  else state.favorites[id] = { at: new Date().toISOString() };
  saveState();
  updateFavoriteButton();
  updateStats();
}

function openQuestionList(nextMode) {
  start(nextMode);
  document.querySelector('.main').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateStats() {
  const doneCount = Object.keys(state.answered).length;
  const wrongIds = getWrongQuestionIds();
  const favoriteIds = getFavoriteQuestionIds();
  const percent = questions.length ? doneCount / questions.length * 100 : 0;

  $('done').textContent = doneCount;
  $('acc').textContent = state.totalAttempts ? `${Math.round(state.correctAttempts / state.totalAttempts * 100)}%` : '0%';
  $('wrongCount').textContent = wrongIds.length;
  $('favoriteCount').textContent = favoriteIds.length;
  $('bar').style.width = `${percent}%`;

  if (!wrongIds.length) {
    $('wrongList').textContent = '暂无错题';
    return;
  }

  $('wrongList').innerHTML = wrongIds
    .sort((a, b) => (state.wrongs[b].at || '').localeCompare(state.wrongs[a].at || ''))
    .map(id => {
      const question = questionsById.get(id);
      const wrong = state.wrongs[id];
      const display = getQuestionDisplay(question);
      const isFavorite = Boolean(state.favorites[id]);
      return `<article class="wrongItem">
        <div class="wrongTitle">
          <b>${escapeHtml(normalizeText(question.type))}${escapeHtml(question.source_number)}</b>
          <button class="miniFavorite${isFavorite ? ' active' : ''}" data-favorite-id="${escapeHtml(id)}" aria-label="${isFavorite ? '取消收藏' : '收藏此题'}">${isFavorite ? '★ 已收藏' : '☆ 收藏'}</button>
        </div>
        <div>${escapeHtml(display.stem).slice(0, 90)}${display.stem.length > 90 ? '…' : ''}</div>
        <span class="muted">正确：${escapeHtml(question.answer)}；你的：${escapeHtml(wrong.chosen)}</span>
      </article>`;
    }).join('');
}

function exportWrongs() {
  const rows = getWrongQuestionIds().map(id => {
    const question = questionsById.get(id);
    const wrong = state.wrongs[id];
    const display = getQuestionDisplay(question);
    const favorite = state.favorites[id] ? '已收藏' : '未收藏';
    return `${normalizeText(question.type)}${question.source_number}\t第${question.chapter}章${display.page ? `-P${display.page}` : ''}\t${favorite}\t${display.stem.replace(/\r?\n/g, ' ')}\t正确:${question.answer}\t你的:${wrong.chosen}`;
  }).join('\n');
  downloadFile(rows || '暂无错题', 'text/plain;charset=utf-8', '错题记录.txt');
}

function downloadFile(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportProgress() {
  const payload = { format: 'qbank-practice-progress', version: 1, exportedAt: new Date().toISOString(), state };
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
  $('wrongBtn').addEventListener('click', () => openQuestionList('wrong'));
  $('returnBtn').addEventListener('click', () => start('all'));
  $('favoriteToggle').addEventListener('click', () => toggleFavorite());
  $('favoriteStat').addEventListener('click', () => openQuestionList('favorite'));
  $('wrongList').addEventListener('click', event => {
    const button = event.target.closest('[data-favorite-id]');
    if (button) toggleFavorite(button.dataset.favoriteId);
  });
  $('clearBtn').addEventListener('click', () => {
    if (confirm('确定清空错题记录吗？')) {
      state.wrongs = {};
      saveState();
      if (mode === 'wrong') start('wrong');
      else updateStats();
    }
  });
  $('exportBtn').addEventListener('click', exportWrongs);
  $('exportProgressBtn').addEventListener('click', exportProgress);
  $('importProgressBtn').addEventListener('click', () => $('progressFile').click());
  $('progressFile').addEventListener('change', event => importProgressFile(event.target.files[0]));
}

initialize();
