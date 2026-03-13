const deepseekInput = document.getElementById('deepseek-key');
const openaiInput = document.getElementById('openai-key');
const openaiModelInput = document.getElementById('openai-model');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status');

// 自定义模型相关
const customModelList = document.getElementById('custom-model-list');
const customModelEmpty = document.getElementById('custom-model-empty');
const customModelForm = document.getElementById('custom-model-form');
const cmNameInput = document.getElementById('cm-name');
const cmUrlInput = document.getElementById('cm-url');
const cmModelInput = document.getElementById('cm-model');
const cmKeyInput = document.getElementById('cm-key');
const cmSaveBtn = document.getElementById('cm-save-btn');
const cmCancelBtn = document.getElementById('cm-cancel-btn');
const cmAddBtn = document.getElementById('cm-add-btn');

let customModels = [];
let editingModelId = null; // 当前正在编辑的模型 id，null 表示新增模式

// 加载现有配置
chrome.storage.local.get(['deepseekKey', 'openaiKey', 'openaiModel', 'customModels'], (result) => {
  if (result.deepseekKey) deepseekInput.value = result.deepseekKey;
  if (result.openaiKey) openaiInput.value = result.openaiKey;
  if (result.openaiModel) openaiModelInput.value = result.openaiModel;
  customModels = result.customModels || [];
  renderCustomModelList();
});

// 保存配置
saveBtn.addEventListener('click', () => {
  // 强制移除所有非 ASCII 字符（如中文空格、隐藏换行符等）
  const deepseekKey = deepseekInput.value.replace(/[^\x20-\x7E]/g, '').trim();
  const openaiKey = openaiInput.value.replace(/[^\x20-\x7E]/g, '').trim();
  const openaiModel = openaiModelInput.value.replace(/[^\x20-\x7E]/g, '').trim() || 'gpt-5-nano';

  // 同步更新输入框显示清洗后的结果
  deepseekInput.value = deepseekKey;
  openaiInput.value = openaiKey;
  openaiModelInput.value = openaiModel;

  // 显式保存到 local storage
  chrome.storage.local.set({
    deepseekKey: deepseekKey,
    openaiKey: openaiKey,
    openaiModel: openaiModel
  }, () => {
    console.log('Settings saved');
    showStatus('✅ 设置已成功保存！侧边栏已同步。', '#059669');
  });
});

function showStatus(text, color) {
  statusMsg.textContent = text;
  statusMsg.style.color = color || '#059669';
  setTimeout(() => { statusMsg.textContent = ''; }, 3000);
}

// ===== 自定义模型管理 =====

function renderCustomModelList() {
  customModelList.innerHTML = '';
  if (customModels.length === 0) {
    customModelEmpty.classList.remove('hidden');
    return;
  }
  customModelEmpty.classList.add('hidden');
  customModels.forEach((model) => {
    const item = document.createElement('div');
    item.className = 'model-item';
    item.innerHTML = `
      <div class="model-item-info">
        <span class="model-item-name">${escapeHtml(model.name)}</span>
        <span class="model-item-detail">${escapeHtml(model.modelName)}</span>
      </div>
      <div class="model-item-actions">
        <button class="icon-btn edit-btn" data-id="${model.id}" title="编辑">✏️</button>
        <button class="icon-btn delete-btn" data-id="${model.id}" title="删除">🗑️</button>
      </div>
    `;
    customModelList.appendChild(item);
  });

  // 绑定编辑/删除事件
  customModelList.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => startEditModel(btn.dataset.id));
  });
  customModelList.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteModel(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 打开添加表单
cmAddBtn.addEventListener('click', () => {
  editingModelId = null;
  cmNameInput.value = '';
  cmUrlInput.value = '';
  cmModelInput.value = '';
  cmKeyInput.value = '';
  customModelForm.classList.remove('hidden');
  cmAddBtn.classList.add('hidden');
  cmNameInput.focus();
});

// 取消
cmCancelBtn.addEventListener('click', () => {
  customModelForm.classList.add('hidden');
  cmAddBtn.classList.remove('hidden');
  editingModelId = null;
});

// 保存自定义模型
cmSaveBtn.addEventListener('click', () => {
  const name = cmNameInput.value.trim();
  const apiUrl = cmUrlInput.value.trim();
  const modelName = cmModelInput.value.trim();
  const apiKey = cmKeyInput.value.trim();

  if (!name || !apiUrl || !modelName || !apiKey) {
    showStatus('⚠️ 请填写所有字段', '#ef4444');
    return;
  }

  if (editingModelId) {
    // 编辑模式
    const idx = customModels.findIndex((m) => m.id === editingModelId);
    if (idx !== -1) {
      customModels[idx] = { ...customModels[idx], name, apiUrl, modelName, apiKey };
    }
  } else {
    // 新增模式
    customModels.push({
      id: 'custom_' + Date.now(),
      name, apiUrl, modelName, apiKey
    });
  }

  saveCustomModels(() => {
    customModelForm.classList.add('hidden');
    cmAddBtn.classList.remove('hidden');
    editingModelId = null;
    renderCustomModelList();
    showStatus('✅ 自定义模型已保存', '#059669');
  });
});

function startEditModel(id) {
  const model = customModels.find((m) => m.id === id);
  if (!model) return;
  editingModelId = id;
  cmNameInput.value = model.name;
  cmUrlInput.value = model.apiUrl;
  cmModelInput.value = model.modelName;
  cmKeyInput.value = model.apiKey;
  customModelForm.classList.remove('hidden');
  cmAddBtn.classList.add('hidden');
  cmNameInput.focus();
}

function deleteModel(id) {
  if (!confirm('确定要删除此自定义模型吗？')) return;
  customModels = customModels.filter((m) => m.id !== id);
  // 如果当前选中的模型被删除，重置为 deepseek
  chrome.storage.local.get('currentModel', (result) => {
    const updates = { customModels };
    if (result.currentModel === id) {
      updates.currentModel = 'deepseek';
    }
    chrome.storage.local.set(updates, () => {
      renderCustomModelList();
      showStatus('🗑️ 模型已删除', '#059669');
    });
  });
}

function saveCustomModels(callback) {
  chrome.storage.local.set({ customModels }, callback);
}
