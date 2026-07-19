// Global App State
const state = {
  currentView: 'dashboard',
  currentTopicId: null,
  topics: [],
  vocabularies: [],
  stats: { total_topics: 0, total_words: 0, total_examples: 0 },
  
  // Dictionary search state
  dictionaryResult: null,
  
  // Practice state
  studyWords: [],
  studyIndex: 0,
  studyFlipped: false,
  practiceTopicId: null,
  practiceTopicName: ''
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  updateStats();
  navigateTo('dashboard');
});

// ============================================
// NAVIGATION & ROUTING
// ============================================
function navigateTo(viewName, params = {}) {
  // Hide all sections
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));

  // Remove active class from menu items
  document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));

  // Activate chosen section
  const section = document.getElementById(`${viewName}-view`);
  if (section) section.classList.add('active');

  // Update nav visual — topic-details highlights notebook
  const navMap = { 'topic-details': 'notebook' };
  const navKey = navMap[viewName] || viewName;
  const navItem = document.getElementById(`nav-${navKey}`);
  if (navItem) navItem.classList.add('active');

  state.currentView = viewName;

  // View-specific init
  if (viewName === 'dashboard') {
    loadDashboard();
  } else if (viewName === 'dictionary') {
    initDictionaryView(params.prefillWord);
  } else if (viewName === 'notebook') {
    loadNotebook();
  } else if (viewName === 'topic-details') {
    if (params.topicId) {
      state.currentTopicId = params.topicId;
      loadTopicDetails(params.topicId);
    }
  } else if (viewName === 'practice') {
    initPracticeView();
  }

  // Close any open modals
  document.querySelectorAll('md-dialog').forEach(m => { m.open = false; });
}

// Stats loading helper
async function updateStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      state.stats = data;
    }
  } catch (error) {
    console.error('Lỗi khi lấy thông số thống kê:', error);
  }
}

// ============================================
// 1. DASHBOARD VIEW
// ============================================
async function loadDashboard() {
  // Update stat numbers
  const totalWordsEl = document.getElementById('dash-total-words');
  const totalExamplesEl = document.getElementById('dash-total-examples');
  const totalXpEl = document.getElementById('dash-total-xp');
  const featuredEl = document.getElementById('dash-featured-words');

  try {
    await updateStats();
    if (totalWordsEl) totalWordsEl.textContent = state.stats.total_words || 0;
    if (totalExamplesEl) totalExamplesEl.textContent = state.stats.total_examples || 0;
    if (totalXpEl) totalXpEl.textContent = state.stats.xp || 0;

    // Load featured words (latest 5)
    const topicsRes = await fetch('/api/topics');
    if (topicsRes.ok) {
      state.topics = await topicsRes.json();
    }

    // Gather some recent words to feature
    let recentWords = [];
    for (const t of state.topics.slice(0, 3)) {
      try {
        const res = await fetch(`/api/topics/${t.id}/vocabularies`);
        if (res.ok) {
          const data = await res.json();
          recentWords = recentWords.concat(data.vocabularies.slice(0, 3));
        }
      } catch (e) { /* skip */ }
    }

    if (featuredEl) {
      if (recentWords.length > 0) {
        featuredEl.innerHTML = `
          <ul class="featured-word-list">
            ${recentWords.slice(0, 5).map(w => `<li>• ${escapeHtml(w.word)}</li>`).join('')}
          </ul>
        `;
      } else {
        featuredEl.innerHTML = `<span class="stat-unit">Chưa có từ vựng</span>`;
      }
    }
  } catch (error) {
    console.error('Dashboard load error:', error);
  }
}

// ============================================
// 2. DICTIONARY VIEW
// ============================================
function initDictionaryView(prefillWord = '') {
  const searchInput = document.getElementById('dict-search-input');
  const resultArea = document.getElementById('search-result-area');
  const errorArea = document.getElementById('search-error');

  resultArea.style.display = 'none';
  errorArea.style.display = 'none';

  if (prefillWord) {
    searchInput.value = prefillWord;
    searchDictionary();
  } else {
    searchInput.value = '';
    setTimeout(() => searchInput.focus(), 100);
  }
}

function handleSearchKeydown(event) {
  if (event.key === 'Enter') searchDictionary();
}

async function searchDictionary() {
  const searchInput = document.getElementById('dict-search-input');
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return;

  const loading = document.getElementById('search-loading');
  const resultArea = document.getElementById('search-result-area');
  const errorArea = document.getElementById('search-error');

  loading.style.display = 'block';
  resultArea.style.display = 'none';
  errorArea.style.display = 'none';

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${query}`);
    loading.style.display = 'none';

    if (response.status === 404) {
      document.getElementById('search-error-title').textContent = `Không tìm thấy từ "${query}"`;
      document.getElementById('search-error-desc').textContent = 'Từ điển lớn không có thông tin về từ này. Vui lòng kiểm tra lại chính tả.';
      errorArea.style.display = 'flex';
      return;
    }

    if (!response.ok) throw new Error('Lỗi kết nối tới máy chủ từ điển');

    const data = await response.json();
    renderDictionaryResults(data);
  } catch (error) {
    loading.style.display = 'none';
    document.getElementById('search-error-title').textContent = 'Lỗi hệ thống';
    document.getElementById('search-error-desc').textContent = `Không thể tra từ điển lúc này: ${error.message}`;
    errorArea.style.display = 'flex';
  }
}

function renderDictionaryResults(apiData) {
  const resultArea = document.getElementById('search-result-area');
  resultArea.innerHTML = '';
  resultArea.style.display = 'block';

  const entry = apiData[0];
  const word = entry.word;

  // Extract phonetic & audio
  let phonetic = entry.phonetic || '';
  let audioUrl = '';

  if (entry.phonetics && entry.phonetics.length > 0) {
    const withAudio = entry.phonetics.find(p => p.audio && p.audio !== '');
    if (withAudio) {
      audioUrl = withAudio.audio;
      if (!phonetic && withAudio.text) phonetic = withAudio.text;
    }
    if (!phonetic) {
      const withText = entry.phonetics.find(p => p.text && p.text !== '');
      if (withText) phonetic = withText.text;
    }
  }

  // Store result globally
  state.dictionaryResult = {
    word, phonetic, audio_url: audioUrl, definitions: []
  };

  let defIndex = 0;
  entry.meanings.forEach(meaning => {
    meaning.definitions.forEach(def => {
      state.dictionaryResult.definitions.push({
        index: defIndex,
        part_of_speech: meaning.partOfSpeech,
        definition: def.definition,
        example: def.example || null
      });
      defIndex++;
    });
  });

  // Ensure topics are loaded for save dialog
  if (state.topics.length === 0) {
    fetch('/api/topics').then(r => r.json()).then(t => { state.topics = t; }).catch(() => {});
  }

  // Build Word Header
  const audioBtn = audioUrl
    ? `<button class="dict-audio-btn" onclick="playAudio('${audioUrl}')" title="Nghe phát âm">
         <span class="material-symbols-outlined" style="font-size: 28px;">volume_up</span>
       </button>`
    : '';

  // Build Definition Cards (horizontal grid per wireframe)
  let defCardsHtml = '';
  entry.meanings.forEach(meaning => {
    meaning.definitions.forEach(def => {
      const idx = state.dictionaryResult.definitions.findIndex(
        d => d.part_of_speech === meaning.partOfSpeech && d.definition === def.definition
      );
      const exampleHtml = def.example ? `<p class="def-card-example" style="font-size:0.85rem; color:var(--primary-tint-90); margin:8px 0; font-style:italic; line-height:1.4;">e.g. ${escapeHtml(def.example)}</p>` : '';
      defCardsHtml += `
        <div class="def-card">
          <h4 class="def-card-pos">{${escapeHtml(meaning.partOfSpeech)}}</h4>
          <p class="def-card-meaning">${escapeHtml(def.definition)}</p>
          <div class="def-card-meaning-vi" id="def-vi-${idx}" style="font-size:0.85rem; color:var(--primary-tint-80); margin:6px 0; font-style:italic; opacity:0.95; display:flex; align-items:center; gap:6px;">
            <span class="spinner-small"></span> Đang dịch...
          </div>
          ${exampleHtml}
          <button class="def-card-save" onclick="openSaveDefDialog(${idx})">Save</button>
        </div>
      `;
    });
  });

  // Build Vietnamese meaning placeholder
  const viBlock = `
    <div class="vi-meaning-block">
      <h4 class="vi-meaning-title">Nghĩa trong tiếng Việt</h4>
      <p class="vi-meaning-text" id="dict-vi-meaning"><em>Đang tải...</em></p>
    </div>
  `;

  resultArea.innerHTML = `
    <div class="dict-word-header">
      <div style="display: flex; align-items: flex-start; justify-content: space-between;">
        <div>
          <h1 class="dict-word-title">${escapeHtml(word)}</h1>
          <div class="dict-word-meta">
            <span class="dict-phonetic">${escapeHtml(phonetic)}</span>
          </div>
        </div>
        ${audioBtn}
      </div>
    </div>

    ${viBlock}

    <div class="def-cards-grid">
      ${defCardsHtml}
    </div>
  `;

  // Attempt to fetch Vietnamese meaning from MyMemory translate API
  fetchVietnameseMeaning(word);

  // Trigger stagger background translation for definitions
  entry.meanings.forEach(meaning => {
    meaning.definitions.forEach(def => {
      const idx = state.dictionaryResult.definitions.findIndex(
        d => d.part_of_speech === meaning.partOfSpeech && d.definition === def.definition
      );
      if (idx !== -1) {
        setTimeout(() => {
          translateDefinition(def.definition, `def-vi-${idx}`);
        }, idx * 150);
      }
    });
  });
}

async function translateDefinition(text, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`);
    if (res.ok) {
      const data = await res.json();
      if (data.responseData && data.responseData.translatedText) {
        el.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; margin-right:4px;">translate</span>${escapeHtml(data.responseData.translatedText)}`;
        return;
      }
    }
    el.textContent = '(Không thể dịch tự động)';
  } catch (e) {
    el.textContent = '(Lỗi dịch)';
  }
}


async function fetchVietnameseMeaning(word) {
  const el = document.getElementById('dict-vi-meaning');
  if (!el) return;

  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|vi`);
    if (res.ok) {
      const data = await res.json();
      if (data.responseData && data.responseData.translatedText) {
        el.textContent = data.responseData.translatedText;
        return;
      }
    }
    el.textContent = '(Không thể dịch tự động. Bạn có thể tự nhập nghĩa tiếng Việt.)';
  } catch (e) {
    el.textContent = '(Không thể kết nối dịch vụ dịch.)';
  }
}

function openSaveDefDialog(defIndex) {
  const def = state.dictionaryResult.definitions[defIndex];
  if (!def) return;

  // Build topic options HTML
  let topicOptionsHtml = '';
  state.topics.forEach(t => {
    topicOptionsHtml += `<md-select-option value="${t.id}"><div slot="headline">${escapeHtml(t.name)}</div></md-select-option>`;
  });

  if (state.topics.length === 0) {
    topicOptionsHtml = '<md-select-option value="" disabled selected><div slot="headline">Hãy tạo chủ đề ở Notebook trước</div></md-select-option>';
  }

  // Create a simple inline save section at top of result area
  const existing = document.getElementById('save-def-inline');
  if (existing) existing.remove();

  const saveDiv = document.createElement('div');
  saveDiv.id = 'save-def-inline';
  saveDiv.style.cssText = 'background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--radius-md); padding: 20px; margin-bottom: 20px; animation: fadeIn 0.25s ease;';
  saveDiv.innerHTML = `
    <h3 style="font-family: var(--font-display); margin: 0 0 8px;">Lưu "${escapeHtml(state.dictionaryResult.word)}" — ${escapeHtml(def.part_of_speech)}</h3>
    <p style="font-size: 0.9rem; color: var(--md-sys-color-on-surface-variant); margin: 0 0 16px;">${escapeHtml(def.definition)}</p>
    <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
      <md-outlined-select id="save-topic-select" label="Chọn chủ đề *" style="flex:1; min-width: 200px;">
        ${topicOptionsHtml}
      </md-outlined-select>
      <md-filled-button onclick="handleSaveDefinition(${defIndex})" ${state.topics.length === 0 ? 'disabled' : ''}>
        <span slot="icon" class="material-symbols-outlined">save</span>
        Lưu vào Notebook
      </md-filled-button>
      <md-text-button onclick="document.getElementById('save-def-inline').remove()">Hủy</md-text-button>
    </div>
  `;

  const resultArea = document.getElementById('search-result-area');
  resultArea.insertBefore(saveDiv, resultArea.firstChild);
  saveDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleSaveDefinition(defIndex) {
  const def = state.dictionaryResult.definitions[defIndex];
  const topicSelect = document.getElementById('save-topic-select');

  const topicId = topicSelect?.value;
  if (!topicId) {
    alert('Vui lòng chọn một chủ đề. Tạo chủ đề mới ở Notebook nếu chưa có.');
    return;
  }

  const payload = {
    topic_id: parseInt(topicId),
    word: state.dictionaryResult.word,
    phonetic: state.dictionaryResult.phonetic,
    audio_url: state.dictionaryResult.audio_url,
    definition: def.definition,
    part_of_speech: def.part_of_speech,
    user_example: def.example || null
  };

  try {
    const res = await fetch('/api/vocabularies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi khi lưu từ vựng');

    alert(`Đã thêm từ "${payload.word}" vào Notebook thành công!`);

    // Remove save panel
    const saveDiv = document.getElementById('save-def-inline');
    if (saveDiv) saveDiv.remove();

    updateStats();
  } catch (error) {
    alert(error.message);
  }
}

// ============================================
// 3. NOTEBOOK VIEW
// ============================================
async function loadNotebook() {
  const gridContainer = document.getElementById('notebook-grid-container');
  gridContainer.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch('/api/topics');
    if (!res.ok) throw new Error('Không thể tải danh sách chủ đề');

    state.topics = await res.json();
    gridContainer.innerHTML = '';

    if (state.topics.length === 0) {
      gridContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <span class="empty-icon">folder_open</span>
          <h3>Chưa có chủ đề nào</h3>
          <p>Hãy tạo chủ đề học tiếng Anh đầu tiên của bạn để bắt đầu lưu trữ từ vựng nhé!</p>
          <md-filled-button onclick="openModal('add-topic-modal')">Tạo ngay</md-filled-button>
        </div>
      `;
      return;
    }

    state.topics.forEach(topic => {
      const topicCard = document.createElement('div');
      topicCard.className = 'topic-card';
      topicCard.onclick = () => navigateTo('topic-details', { topicId: topic.id });

      topicCard.innerHTML = `
        <div class="topic-card-header">
          <span class="topic-badge">Topic</span>
          <span class="word-count-badge">
            <span class="material-symbols-outlined">menu_book</span>
            ${topic.word_count} từ
          </span>
        </div>
        <div class="topic-card-body">
          <h3>${escapeHtml(topic.name)}</h3>
          <p>${escapeHtml(topic.description || 'Chưa có mô tả cho chủ đề này.')}</p>
        </div>
      `;
      gridContainer.appendChild(topicCard);
    });
  } catch (error) {
    gridContainer.innerHTML = `<p style="color: var(--md-sys-color-error); text-align: center;">Lỗi: ${error.message}</p>`;
  }
}

async function handleCreateTopic(event) {
  event.preventDefault();
  const nameInput = document.getElementById('topic-name');
  const descInput = document.getElementById('topic-desc');

  const name = nameInput.value.trim();
  const description = descInput.value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi khi tạo chủ đề');

    nameInput.value = '';
    descInput.value = '';
    closeModal('add-topic-modal');

    loadNotebook();
    updateStats();
  } catch (error) {
    alert(error.message);
  }
}

// ============================================
// 3b. TOPIC DETAILS VIEW
// ============================================
async function loadTopicDetails(topicId) {
  const bannerContainer = document.getElementById('topic-banner-content');
  const vocabContainer = document.getElementById('vocab-grid-container');
  const shortcutBtn = document.getElementById('btn-add-word-shortcut');

  vocabContainer.innerHTML = '<div class="spinner"></div>';
  shortcutBtn.onclick = () => navigateTo('dictionary');

  try {
    const res = await fetch(`/api/topics/${topicId}/vocabularies`);
    if (!res.ok) throw new Error('Không thể tải chi tiết chủ đề');

    const data = await res.json();
    const topic = data.topic;
    state.vocabularies = data.vocabularies;

    const wordsWithExample = state.vocabularies.filter(v => v.user_example && v.user_example.trim() !== '').length;

    // Banner
    bannerContainer.innerHTML = `
      <h2>${escapeHtml(topic.name)}</h2>
      <p>${escapeHtml(topic.description || 'Chưa có mô tả cho chủ đề này.')}</p>
      <div style="margin-top: 8px; font-size: 0.85rem; opacity: 0.85;">
        Tổng: <strong>${state.vocabularies.length}</strong> từ &nbsp;|&nbsp; Ví dụ: <strong>${wordsWithExample}/${state.vocabularies.length}</strong>
      </div>
    `;

    // Vocab cards
    vocabContainer.innerHTML = '';
    if (state.vocabularies.length === 0) {
      vocabContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <span class="empty-icon">add</span>
          <h3>Chưa có từ vựng nào trong chủ đề</h3>
          <p>Tìm kiếm từ mới từ từ điển lớn và lưu nó vào chủ đề này!</p>
          <md-filled-button onclick="navigateTo('dictionary')">Tìm kiếm từ vựng</md-filled-button>
        </div>
      `;
      return;
    }

    state.vocabularies.forEach(vocab => {
      const vocabCard = document.createElement('div');
      vocabCard.className = 'vocab-card';

      const audioBtnHtml = vocab.audio_url
        ? `<md-icon-button onclick="playAudio('${vocab.audio_url}')" title="Phát âm">
             <span class="material-symbols-outlined">volume_up</span>
           </md-icon-button>`
        : '';

      let exampleHtml = '';
      if (vocab.user_example) {
        exampleHtml = `
          <div class="vocab-example-section">
            <div class="vocab-example-label">
              Ví dụ của bạn:
              <md-icon-button onclick="openEditExampleModal(${vocab.id}, '${escapeJsString(vocab.word)}', '${escapeJsString(vocab.user_example)}')" title="Sửa ví dụ" style="--md-icon-button-container-width: 28px; --md-icon-button-container-height: 28px;">
                <span class="material-symbols-outlined" style="font-size: 16px;">edit</span>
              </md-icon-button>
            </div>
            <p class="vocab-example-text">${highlightWordInSentence(vocab.word, escapeHtml(vocab.user_example))}</p>
          </div>
        `;
      } else {
        exampleHtml = `
          <div class="vocab-example-section" style="cursor: pointer;" onclick="openEditExampleModal(${vocab.id}, '${escapeJsString(vocab.word)}', '')">
            <p style="font-size: 0.85rem; color: var(--md-sys-color-primary);">+ Thêm câu ví dụ của bạn</p>
          </div>
        `;
      }

      vocabCard.innerHTML = `
        <div class="vocab-word-header">
          <span class="vocab-word-title">${escapeHtml(vocab.word)}</span>
          ${vocab.part_of_speech ? `<span class="vocab-pos-badge">${escapeHtml(vocab.part_of_speech)}</span>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:4px;">
          <span class="vocab-phonetic">${escapeHtml(vocab.phonetic || '')}</span>
          ${audioBtnHtml}
        </div>
        <p class="vocab-definition">${escapeHtml(vocab.definition)}</p>
        ${exampleHtml}
        <div class="vocab-actions">
          <md-icon-button onclick="deleteVocabulary(${vocab.id})" title="Xóa từ vựng">
            <span class="material-symbols-outlined">delete</span>
          </md-icon-button>
        </div>
      `;
      vocabContainer.appendChild(vocabCard);
    });
  } catch (error) {
    vocabContainer.innerHTML = `<p style="color: var(--md-sys-color-error); text-align: center;">Lỗi: ${error.message}</p>`;
  }
}

async function deleteVocabulary(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa từ vựng này không?')) return;

  try {
    const res = await fetch(`/api/vocabularies/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Không thể xóa từ vựng');
    loadTopicDetails(state.currentTopicId);
    updateStats();
  } catch (error) {
    alert(error.message);
  }
}

// ============================================
// 4. PRACTICE VIEW
// ============================================
async function initPracticeView() {
  const container = document.getElementById('practice-container');
  
  if (state.practiceTopicId === null) {
    container.innerHTML = '<div class="spinner"></div>';
    try {
      const topicsRes = await fetch('/api/topics');
      if (!topicsRes.ok) throw new Error('Không thể tải dữ liệu chủ đề');
      const topics = await topicsRes.json();
      
      let html = `
        <div class="practice-selector-container" style="animation: fadeIn 0.25s ease;">
          <h3 style="font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; margin: 0 0 8px 0; color: var(--md-sys-color-primary);">Chọn chủ đề để ôn tập</h3>
          <p style="font-size: 0.9rem; color: var(--md-sys-color-on-surface-variant); margin: 0 0 24px 0;">Ôn tập từ vựng tập trung theo từng chủ đề giúp nâng cao hiệu quả học tập và ghi nhớ lâu hơn.</p>
          
          <div class="practice-topics-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;">
            <div class="practice-topic-card" onclick="selectPracticeTopic('all', 'Tất cả chủ đề')" style="background-color: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--radius-md); padding: 20px; cursor: pointer; display: flex; flex-direction: column; gap: 8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="topic-badge" style="background-color: var(--md-sys-color-primary); color: #fff;">Học hỗn hợp</span>
              </div>
              <h3 style="font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; margin: 4px 0 0 0;">Tất cả chủ đề</h3>
              <p style="font-size: 0.85rem; margin: 0; line-height: 1.4; flex: 1; opacity: 0.9;">Ôn tập tất cả từ vựng đang có của bạn từ tất cả các chủ đề trộn lẫn.</p>
            </div>
      `;
      
      topics.forEach(t => {
        html += `
            <div class="practice-topic-card" onclick="selectPracticeTopic(${t.id}, '${escapeJsString(t.name)}')" style="background-color: var(--md-sys-color-surface-container-lowest); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--radius-md); padding: 20px; cursor: pointer; display: flex; flex-direction: column; gap: 8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="topic-badge">Chủ đề</span>
                <span class="word-count-badge" style="font-size:0.8rem; color: var(--md-sys-color-on-surface-variant);"><span class="material-symbols-outlined" style="font-size: 16px; vertical-align:middle; margin-right:4px;">menu_book</span>${t.word_count} từ</span>
              </div>
              <h3 style="font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; margin: 4px 0 0 0; color: var(--md-sys-color-on-surface);">${escapeHtml(t.name)}</h3>
              <p style="font-size: 0.85rem; color: var(--md-sys-color-on-surface-variant); margin: 0; line-height: 1.4; flex: 1;">${escapeHtml(t.description || 'Chưa có mô tả cho chủ đề này.')}</p>
            </div>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
      
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = `<p style="color: var(--md-sys-color-error); text-align: center;">Lỗi khi tải chủ đề ôn tập: ${error.message}</p>`;
    }
    return;
  }

  container.innerHTML = '<div class="spinner"></div>';
  try {
    let allVocab = [];
    if (state.practiceTopicId === 'all') {
      const topicsRes = await fetch('/api/topics');
      if (!topicsRes.ok) throw new Error('Không thể tải dữ liệu chủ đề');
      const topics = await topicsRes.json();
      for (const t of topics) {
        const res = await fetch(`/api/topics/${t.id}/vocabularies`);
        if (res.ok) {
          const data = await res.json();
          allVocab = allVocab.concat(data.vocabularies);
        }
      }
    } else {
      const res = await fetch(`/api/topics/${state.practiceTopicId}/vocabularies`);
      if (!res.ok) throw new Error('Không thể tải từ vựng của chủ đề này');
      const data = await res.json();
      allVocab = data.vocabularies;
    }

    state.studyWords = shuffleArray(allVocab);
    state.studyIndex = 0;
    state.studyFlipped = false;

    renderPracticeCard();
  } catch (error) {
    container.innerHTML = `
      <p style="color: var(--md-sys-color-error); text-align: center;">Lỗi khi tải từ ôn tập: ${error.message}</p>
      <div style="text-align: center; margin-top: 16px;">
        <md-filled-button onclick="resetPracticeTopicSelection()">Chọn chủ đề khác</md-filled-button>
      </div>
    `;
  }
}

function renderPracticeCard() {
  const container = document.getElementById('practice-container');

  if (state.studyWords.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">school</span>
        <h3>Chưa có từ vựng nào để ôn tập</h3>
        <p>Thêm từ vựng mới và ví dụ minh họa của bạn trước để có thể tiến hành luyện tập chủ đề này.</p>
        <div style="display: flex; gap: 12px; margin-top: 12px; justify-content: center;">
          <md-filled-button onclick="navigateTo('dictionary')">Đi tra từ mới</md-filled-button>
          <md-outlined-button onclick="resetPracticeTopicSelection()">Quay lại chọn chủ đề</md-outlined-button>
        </div>
      </div>
    `;
    return;
  }

  const v = state.studyWords[state.studyIndex];

  const refExample = v.user_example
    ? highlightWordInSentence(v.word, escapeHtml(v.user_example))
    : '<i>(Chưa có câu ví dụ mẫu từ từ điển)</i>';

  container.innerHTML = `
    <div class="study-card-wrapper">
      <div class="study-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:0.85rem; color:var(--md-sys-color-on-surface-variant);">
          <span style="display:flex; align-items:center; gap:4px; font-weight:500;">
            <span class="material-symbols-outlined" style="font-size:16px;">folder</span>
            Chủ đề: ${escapeHtml(state.practiceTopicName)}
          </span>
          <span>Từ số ${state.studyIndex + 1} / ${state.studyWords.length}</span>
        </div>
        
        <div class="study-card-front" style="padding-bottom: 8px;">
          <div class="practice-word-display" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div>
              <span style="font-size: 1.8rem; font-weight: 700; font-family: var(--font-display); color: var(--md-sys-color-primary);">${escapeHtml(v.word)}</span>
              ${v.part_of_speech ? `<span class="vocab-pos-badge" style="margin-left: 8px; vertical-align: middle;">${escapeHtml(v.part_of_speech)}</span>` : ''}
            </div>
            ${v.audio_url ? `
              <md-icon-button onclick="playAudio('${v.audio_url}')" title="Nghe phát âm">
                <span class="material-symbols-outlined">volume_up</span>
              </md-icon-button>
            ` : ''}
          </div>
          
          <p class="definition-text" style="margin: 8px 0; font-size: 1.05rem;"><strong>Định nghĩa:</strong> "${escapeHtml(v.definition)}"</p>
          <p class="example-hint" style="margin: 12px 0 8px; font-size: 0.9rem; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-low); padding: 12px; border-radius: var(--radius-sm); border-left: 4px solid var(--md-sys-color-primary);">
            <strong>Ví dụ mẫu:</strong> ${refExample}
          </p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
          <md-outlined-text-field id="practice-sentence-input" type="textarea" rows="3" label="Viết câu ví dụ mới của bạn *" 
            placeholder="Nhập một câu tiếng Anh bất kỳ có chứa từ '${escapeHtml(v.word)}'..."
            oninput="validatePracticeSentence()">
          </md-outlined-text-field>
          <div id="practice-sentence-validation" class="validation-notice" style="display: none;"></div>
        </div>

        <div class="study-card-actions" id="practice-actions-row">
          <md-outlined-button onclick="skipPracticeWord()">
            <span slot="icon" class="material-symbols-outlined">skip_next</span>
            Bỏ qua / Không thuộc
          </md-outlined-button>
          <md-filled-button onclick="submitPracticeSentence()">
            <span slot="icon" class="material-symbols-outlined">assignment_turned_in</span>
            Kiểm tra &amp; Nâng điểm
          </md-filled-button>
        </div>

        <div id="practice-feedback" class="study-card-back" style="margin-top: 16px; display: none;">
          <div id="feedback-message" style="margin-bottom: 16px;"></div>
          <div class="study-card-actions">
            <md-filled-button onclick="nextPracticeWord()">
              Từ tiếp theo
              <span slot="icon" class="material-symbols-outlined">arrow_forward</span>
            </md-filled-button>
          </div>
        </div>
      </div>

      <div style="text-align: center; margin-top: 16px; display: flex; justify-content: center; gap: 12px;">
        <md-outlined-button onclick="initPracticeView()">
          <span slot="icon" class="material-symbols-outlined">shuffle</span>
          Trộn lại thẻ
        </md-outlined-button>
        <md-outlined-button onclick="resetPracticeTopicSelection()">
          <span slot="icon" class="material-symbols-outlined">arrow_back</span>
          Chọn chủ đề khác
        </md-outlined-button>
      </div>
    </div>
  `;

  setTimeout(() => {
    const input = document.getElementById('practice-sentence-input');
    if (input) input.focus();
  }, 100);
}

function selectPracticeTopic(topicId, topicName) {
  state.practiceTopicId = topicId;
  state.practiceTopicName = topicName;
  initPracticeView();
}

function resetPracticeTopicSelection() {
  state.practiceTopicId = null;
  state.practiceTopicName = '';
  state.studyWords = [];
  state.studyIndex = 0;
  initPracticeView();
}

function validatePracticeSentence() {
  const textarea = document.getElementById('practice-sentence-input');
  const validationDiv = document.getElementById('practice-sentence-validation');
  if (!textarea || !validationDiv) return;

  const v = state.studyWords[state.studyIndex];
  const sentence = textarea.value;

  if (!sentence.trim()) {
    validationDiv.style.display = 'none';
    return;
  }

  const isValid = checkWordInSentence(v.word, sentence);
  const isSameAsRef = v.user_example && sentence.trim().toLowerCase() === v.user_example.trim().toLowerCase();

  validationDiv.style.display = 'flex';

  if (isSameAsRef) {
    validationDiv.className = 'validation-notice invalid';
    validationDiv.innerHTML = `
      <span class="icon">warning</span>
      <span>⚠️ Câu này trùng với câu ví dụ mẫu. Hãy viết một câu mới của riêng bạn!</span>
    `;
  } else if (isValid) {
    validationDiv.className = 'validation-notice valid';
    validationDiv.innerHTML = `
      <span class="icon">check_circle</span>
      <span>✓ Hợp lệ! Từ vựng "${escapeHtml(v.word)}" đã xuất hiện trong câu của bạn.</span>
    `;
  } else {
    validationDiv.className = 'validation-notice invalid';
    validationDiv.innerHTML = `
      <span class="icon">info</span>
      <span>💡 Hãy đảm bảo câu có chứa từ học "${escapeHtml(v.word)}" (hoặc các dạng chia thì/số nhiều).</span>
    `;
  }
}

async function submitPracticeSentence() {
  const textarea = document.getElementById('practice-sentence-input');
  const validationDiv = document.getElementById('practice-sentence-validation');
  const feedbackDiv = document.getElementById('practice-feedback');
  const feedbackMsg = document.getElementById('feedback-message');
  const actionsRow = document.getElementById('practice-actions-row');

  if (!textarea || !feedbackDiv || !feedbackMsg || !actionsRow) return;

  const v = state.studyWords[state.studyIndex];
  const sentence = textarea.value.trim();

  if (!sentence) {
    alert('Vui lòng nhập câu ví dụ của bạn!');
    return;
  }

  const isValid = checkWordInSentence(v.word, sentence);
  const isSameAsRef = v.user_example && sentence.toLowerCase() === v.user_example.trim().toLowerCase();

  if (isSameAsRef) {
    alert('Câu của bạn không được trùng với câu ví dụ mẫu. Hãy viết một câu của riêng bạn!');
    return;
  }

  if (!isValid) {
    alert(`Câu của bạn chưa chứa từ vựng "${v.word}" (hoặc các dạng biến thể). Vui lòng kiểm tra lại.`);
    return;
  }

  // Disable inputs and actions
  textarea.disabled = true;
  actionsRow.style.display = 'none';
  if (validationDiv) validationDiv.style.display = 'none';

  try {
    // 1. Save new sentence as user_example in database
    const saveRes = await fetch(`/api/vocabularies/${v.id}/example`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_example: sentence })
    });

    if (!saveRes.ok) throw new Error('Không thể lưu câu ví dụ mới vào Notebook');

    // Update locally stored copy
    v.user_example = sentence;

    // 2. Submit SRS rating with quality = 5 (successful composition)
    const srsRes = await fetch('/api/srs/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: v.word, quality: 5 })
    });
    
    if (!srsRes.ok) throw new Error('Không thể cập nhật tiến trình SRS');

    feedbackMsg.innerHTML = `
      <div style="background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); padding: 16px; border-radius: var(--radius-md); border-left: 4px solid var(--md-sys-color-primary);">
        <h4 style="margin:0 0 6px 0; font-family:var(--font-display); font-size:1.1rem; display:flex; align-items:center; gap:8px;">
          <span class="material-symbols-outlined" style="font-size:24px;">stars</span>
          Thành công! +20 XP
        </h4>
        <p style="margin:0; font-size:0.95rem;">Định mức ôn tập đã được tự động dãn cách thông qua thuật toán SM-2. Câu ví dụ của bạn đã được cập nhật vào Notebook.</p>
      </div>
    `;
    feedbackDiv.style.display = 'block';

    updateStats();
  } catch (error) {
    alert(error.message);
    textarea.disabled = false;
    actionsRow.style.display = 'flex';
  }
}

async function skipPracticeWord() {
  const textarea = document.getElementById('practice-sentence-input');
  const validationDiv = document.getElementById('practice-sentence-validation');
  const feedbackDiv = document.getElementById('practice-feedback');
  const feedbackMsg = document.getElementById('feedback-message');
  const actionsRow = document.getElementById('practice-actions-row');

  if (!textarea || !feedbackDiv || !feedbackMsg || !actionsRow) return;

  const v = state.studyWords[state.studyIndex];

  textarea.disabled = true;
  actionsRow.style.display = 'none';
  if (validationDiv) validationDiv.style.display = 'none';

  try {
    // Submit SRS rating with quality = 1 (forgotten/skipped)
    await fetch('/api/srs/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: v.word, quality: 1 })
    });

    feedbackMsg.innerHTML = `
      <div style="background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); padding: 16px; border-radius: var(--radius-md); border-left: 4px solid var(--md-sys-color-error);">
        <h4 style="margin:0 0 6px 0; font-family:var(--font-display); font-size:1.1rem; display:flex; align-items:center; gap:8px;">
          <span class="material-symbols-outlined" style="font-size:24px;">info</span>
          Đã bỏ qua từ vựng
        </h4>
        <p style="margin:0; font-size:0.95rem;">Từ vựng này sẽ được lên lịch ôn tập lại sớm nhất có thể để củng cố trí nhớ.</p>
      </div>
    `;
    feedbackDiv.style.display = 'block';
  } catch (error) {
    console.error('Failed to submit skipped SRS review:', error);
    textarea.disabled = false;
    actionsRow.style.display = 'flex';
  }
}

function nextPracticeWord() {
  state.studyIndex = (state.studyIndex + 1) % state.studyWords.length;
  renderPracticeCard();
}

// ============================================
// HELPERS & MODALS
// ============================================

function openModal(modalId) {
  const dialog = document.getElementById(modalId);
  if (dialog) dialog.open = true;
}

function closeModal(modalId) {
  const dialog = document.getElementById(modalId);
  if (dialog) dialog.open = false;
}

function openEditExampleModal(vocabId, word, currentExample) {
  document.getElementById('edit-example-vocab-id').value = vocabId;
  document.getElementById('edit-example-vocab-word').value = word;
  document.getElementById('edit-example-word-display').textContent = word;

  const textfield = document.getElementById('edit-example-input');
  textfield.value = currentExample;

  validateExampleSentence('edit-example-input', 'edit-example-vocab-word', 'edit-example-validation');
  openModal('edit-example-modal');

  setTimeout(() => textfield.focus(), 100);
}

async function handleSaveExample(event) {
  event.preventDefault();

  const vocabId = document.getElementById('edit-example-vocab-id').value;
  const exampleInput = document.getElementById('edit-example-input');
  const user_example = exampleInput.value.trim();

  try {
    const res = await fetch(`/api/vocabularies/${vocabId}/example`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_example })
    });

    if (!res.ok) throw new Error('Không thể cập nhật câu ví dụ');

    closeModal('edit-example-modal');
    loadTopicDetails(state.currentTopicId);
    updateStats();
  } catch (error) {
    alert(error.message);
  }
}

function playAudio(url) {
  if (!url) return;
  let audioUrl = url;
  if (url.startsWith('//')) audioUrl = 'https:' + url;
  const audio = new Audio(audioUrl);
  audio.play().catch(err => {
    console.error('Không thể phát file âm thanh:', err);
    alert('Không thể phát âm thanh của từ này.');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function shuffleArray(array) {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

// ============================================
// SENTENCE VALIDATION AND MASKING
// ============================================

const irregularVerbs = {
  'be': ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  'have': ['had', 'has', 'having'],
  'do': ['did', 'done', 'does', 'doing'],
  'go': ['went', 'gone', 'goes', 'going'],
  'say': ['said', 'says', 'saying'],
  'make': ['made', 'makes', 'making'],
  'get': ['got', 'gotten', 'gets', 'getting'],
  'take': ['took', 'taken', 'takes', 'taking'],
  'come': ['came', 'come', 'comes', 'coming'],
  'see': ['saw', 'seen', 'sees', 'seeing'],
  'know': ['knew', 'known', 'knows', 'knowing'],
  'give': ['gave', 'given', 'gives', 'giving'],
  'find': ['found', 'finds', 'finding'],
  'think': ['thought', 'thinks', 'thinking'],
  'tell': ['told', 'tells', 'telling'],
  'become': ['became', 'becomes', 'becoming'],
  'show': ['showed', 'shown', 'shows', 'showing'],
  'leave': ['left', 'leaves', 'leaving'],
  'feel': ['felt', 'feels', 'feeling'],
  'put': ['put', 'puts', 'putting'],
  'bring': ['brought', 'brings', 'bringing'],
  'begin': ['began', 'begun', 'begins', 'beginning'],
  'keep': ['kept', 'keeps', 'keeping'],
  'hold': ['held', 'holds', 'holding'],
  'write': ['wrote', 'written', 'writes', 'writing'],
  'stand': ['stood', 'stands', 'standing'],
  'hear': ['heard', 'hears', 'hearing'],
  'let': ['let', 'lets', 'letting'],
  'mean': ['meant', 'means', 'meaning'],
  'set': ['set', 'sets', 'setting'],
  'meet': ['met', 'meets', 'meeting'],
  'run': ['ran', 'run', 'runs', 'running'],
  'pay': ['paid', 'pays', 'paying'],
  'sit': ['sat', 'sits', 'sitting'],
  'speak': ['spoke', 'spoken', 'speaks', 'speaking'],
  'lie': ['lay', 'lain', 'lies', 'lying'],
  'lead': ['led', 'leads', 'leading'],
  'read': ['read', 'reads', 'reading'],
  'grow': ['grew', 'grown', 'grows', 'growing'],
  'lose': ['lost', 'loses', 'losing'],
  'fall': ['fell', 'fallen', 'falls', 'falling'],
  'send': ['sent', 'sends', 'sending'],
  'build': ['built', 'builds', 'building'],
  'understand': ['understood', 'understands', 'understanding'],
  'draw': ['drew', 'drawn', 'draws', 'drawing'],
  'break': ['broke', 'broken', 'breaks', 'breaking'],
  'spend': ['spent', 'spends', 'spending'],
  'cut': ['cut', 'cuts', 'cutting'],
  'rise': ['rose', 'risen', 'rises', 'rising'],
  'drive': ['drove', 'driven', 'drives', 'driving'],
  'buy': ['bought', 'buys', 'buying'],
  'wear': ['wore', 'worn', 'wears', 'wearing'],
  'choose': ['chose', 'chosen', 'chooses', 'choosing'],
  'fly': ['flew', 'flown', 'flies', 'flying'],
  'sing': ['sang', 'sung', 'sings', 'singing'],
  'drink': ['drank', 'drunk', 'drinks', 'drinking'],
  'swim': ['swam', 'swum', 'swims', 'swimming'],
  'eat': ['ate', 'eaten', 'eats', 'eating'],
  'forget': ['forgot', 'forgotten', 'forgets', 'forgetting'],
  'steal': ['stole', 'stolen', 'steals', 'stealing'],
  'sell': ['sold', 'sells', 'selling'],
  'fight': ['fought', 'fights', 'fighting'],
  'teach': ['taught', 'teaches', 'teaching'],
  'catch': ['caught', 'catches', 'catching'],
  'sleep': ['slept', 'sleeps', 'sleeping'],
  'slide': ['slid', 'slides', 'sliding'],
  'hide': ['hid', 'hidden', 'hides', 'hiding'],
  'ride': ['rode', 'ridden', 'rides', 'riding'],
  'shake': ['shook', 'shaken', 'shakes', 'shaking'],
  'shrink': ['shrank', 'shrunk', 'shrinks', 'shrinking'],
  'feed': ['fed', 'feeds', 'feeding'],
  'dig': ['dug', 'digs', 'digging'],
  'blow': ['blew', 'blown', 'blows', 'blowing'],
  'shoot': ['shot', 'shoots', 'shooting'],
  'spin': ['spun', 'spins', 'spinning'],
  'freeze': ['froze', 'frozen', 'freezes', 'freezing'],
  'strike': ['struck', 'strikes', 'striking'],
  'sink': ['sank', 'sunk', 'sinks', 'sinking'],
  'tear': ['tore', 'torn', 'tears', 'tearing'],
  'throw': ['threw', 'thrown', 'throws', 'throwing'],
  'wake': ['woke', 'woken', 'wakes', 'waking'],
  'win': ['won', 'wins', 'winning'],
  'wind': ['wound', 'winds', 'winding'],
  'spring': ['sprang', 'sprung', 'springs', 'springing']
};

function getWordPatterns(word) {
  if (!word) return [];
  const cleanWord = word.trim().toLowerCase();
  const patterns = [cleanWord];

  // Regular inflections
  if (cleanWord.endsWith('y')) {
    const root = cleanWord.slice(0, -1);
    patterns.push(root + 'ies', root + 'ied', cleanWord + 'ing');
  } else if (cleanWord.endsWith('e')) {
    const root = cleanWord.slice(0, -1);
    patterns.push(cleanWord + 's', root + 'ing', root + 'ed', root + 'd');
  } else {
    patterns.push(cleanWord + 's', cleanWord + 'es', cleanWord + 'ed', cleanWord + 'ing', cleanWord + 'd');
  }

  // Add irregular forms
  const irregulars = irregularVerbs[cleanWord];
  if (irregulars) {
    patterns.push(...irregulars);
  }

  // Sort by length descending to match longer strings first in regex alternation
  patterns.sort((a, b) => b.length - a.length);

  return [...new Set(patterns)];
}

function checkWordInSentence(word, sentence) {
  if (!sentence || !word) return false;
  const patterns = getWordPatterns(word);
  const escaped = patterns.map(p => p.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
  return regex.test(sentence);
}

function validateExampleSentence(inputId, wordSourceId, validationDivId) {
  const textarea = document.getElementById(inputId);
  const wordSource = document.getElementById(wordSourceId);
  const validationDiv = document.getElementById(validationDivId);

  if (!textarea || !wordSource || !validationDiv) return;

  const sentence = textarea.value;
  const word = wordSource.value || wordSource.textContent;

  if (!sentence.trim()) {
    validationDiv.style.display = 'none';
    return;
  }

  const isValid = checkWordInSentence(word, sentence);
  validationDiv.style.display = 'flex';

  if (isValid) {
    validationDiv.className = 'validation-notice valid';
    validationDiv.innerHTML = `
      <span class="icon">check_circle</span>
      <span>✓ Hợp lệ! Từ vựng "${escapeHtml(word)}" đã xuất hiện trong câu ví dụ.</span>
    `;
  } else {
    validationDiv.className = 'validation-notice invalid';
    validationDiv.innerHTML = `
      <span class="icon">info</span>
      <span>💡 Nhắc nhở: Có vẻ câu chưa chứa từ "${escapeHtml(word)}". Đảm bảo câu có chứa từ học (hoặc biến thể).</span>
    `;
  }
}

function highlightWordInSentence(word, sentence) {
  if (!sentence || !word) return sentence || '';
  const patterns = getWordPatterns(word);
  const escaped = patterns.map(p => p.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  try {
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
    return sentence.replace(regex, (match) => `<mark>${match}</mark>`);
  } catch (e) {
    return sentence;
  }
}

function maskWordInSentence(word, sentence) {
  if (!sentence || !word) return '';
  const patterns = getWordPatterns(word);
  const escaped = patterns.map(p => p.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  try {
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
    return sentence.replace(regex, (match) => {
      return `<strong style="letter-spacing: 2px; border-bottom: 2px dashed var(--md-sys-color-primary);">${'_'.repeat(match.length)}</strong>`;
    });
  } catch (e) {
    return '______';
  }
}
