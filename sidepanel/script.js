const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const settingsBtn = document.getElementById('settings-btn');
const modelSelect = document.getElementById('model-select');
const initialMessage = document.getElementById('initial-message');

const imageInput = document.getElementById('image-input');
const previewArea = document.getElementById('preview-area');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image');

let currentImageBase64 = null;
let config = {
  deepseekKey: '',
  openaiKey: '',
  currentModel: 'deepseek',
  openaiModel: 'gpt-5-nano'
};

// 配置 marked
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  langPrefix: 'hljs language-',
  breaks: true,
  gfm: true
});

// 核心初始化函数
async function init() {
  const result = await chrome.storage.local.get(['deepseekKey', 'openaiKey', 'currentModel', 'openaiModel']);
  config.deepseekKey = result.deepseekKey || '';
  config.openaiKey = result.openaiKey || '';
  config.currentModel = result.currentModel || 'deepseek';
  config.openaiModel = result.openaiModel || 'gpt-5-nano';
  modelSelect.value = config.currentModel;
  updateUIBasedOnConfig();
}

// 根据配置更新 UI 状态
function updateUIBasedOnConfig() {
  const activeKey = config.currentModel === 'deepseek' ? config.deepseekKey : config.openaiKey;
  if (!activeKey) {
    initialMessage.innerHTML = '⚠️ 未检测到 API Key。正在为您打开配置页面...';
    initialMessage.style.color = '#ef4444';
    setTimeout(() => {
      chrome.runtime.openOptionsPage();
    }, 1500);
  } else {
    initialMessage.textContent = `你好！当前模型：${config.currentModel.toUpperCase()}。已就绪，请提问。`;
    initialMessage.style.color = '';
  }
}

// 监听存储变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    let changed = false;
    if (changes.deepseekKey) { config.deepseekKey = changes.deepseekKey.newValue || ''; changed = true; }
    if (changes.openaiKey) { config.openaiKey = changes.openaiKey.newValue || ''; changed = true; }
    if (changes.openaiModel) { config.openaiModel = changes.openaiModel.newValue || 'gpt-5-nano'; changed = true; }
    if (changes.currentModel) {
      config.currentModel = changes.currentModel.newValue || 'deepseek';
      modelSelect.value = config.currentModel;
      changed = true;
    }
    if (changed) updateUIBasedOnConfig();
  }
});

// 图片上传处理
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    currentImageBase64 = event.target.result;
    imagePreview.src = currentImageBase64;
    previewArea.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

// 移除图片
removeImageBtn.addEventListener('click', () => {
  currentImageBase64 = null;
  imageInput.value = '';
  previewArea.classList.add('hidden');
});

// 自动调整文本框高度
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = userInput.scrollHeight + 'px';
});

// 点击设置按钮打开配置页
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 模型切换
modelSelect.addEventListener('change', () => {
  config.currentModel = modelSelect.value;
  chrome.storage.local.set({ currentModel: config.currentModel });
});

// 发送消息逻辑
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text && !currentImageBase64) return;

  let activeKey = config.currentModel === 'deepseek' ? config.deepseekKey : config.openaiKey;
  activeKey = activeKey.replace(/[^\x20-\x7E]/g, '').trim();

  if (!activeKey) {
    alert('API Key 无效或未配置，请重新设置');
    chrome.runtime.openOptionsPage();
    return;
  }

  // 构建用户消息 UI
  const userMsgDiv = addMessage('', 'user');
  if (currentImageBase64) {
    const img = document.createElement('img');
    img.src = currentImageBase64;
    userMsgDiv.appendChild(img);
  }
  if (text) {
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    userMsgDiv.appendChild(textSpan);
  }

  const prompt = text;
  const imageData = currentImageBase64;
  userInput.value = '';
  userInput.style.height = 'auto';
  currentImageBase64 = null;
  previewArea.classList.add('hidden');
  imageInput.value = '';
  
  const aiMessageDiv = addMessage('', 'ai');
  aiMessageDiv.innerHTML = '<div class="loading-indicator"><span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span> AI 分析中</div>';
  sendBtn.disabled = true;
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const startTime = performance.now();
  let fullResponse = '';
  let firstChunkReceived = false;
  try {
    await callLLMStreaming(prompt, imageData, config.currentModel, activeKey, (chunk) => {
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        aiMessageDiv.innerHTML = '';
      }
      fullResponse += chunk;
      aiMessageDiv.innerHTML = marked.parse(fullResponse);
      aiMessageDiv.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
      chatContainer.scrollTop = chatContainer.scrollHeight;
    });
    // 追加耗时信息
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const timeTag = document.createElement('div');
    timeTag.className = 'analysis-time';
    timeTag.textContent = `分析耗时 ${elapsed}s`;
    aiMessageDiv.appendChild(timeTag);
  } catch (error) {
    aiMessageDiv.innerHTML = '';
    aiMessageDiv.textContent = '错误: ' + error.message;
  } finally {
    sendBtn.disabled = false;
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

async function callLLMStreaming(prompt, imageData, modelType, rawApiKey, onChunk) {
  const apiKey = rawApiKey.replace(/[^\x20-\x7E]/g, '').trim();
  
  if (modelType === 'deepseek' && imageData) {
    const endpoint = 'https://api.deepseek.com/v3/multimodal/chat';
    const base64Data = imageData.split(',')[1];
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        image: base64Data,
        text: prompt || '请分析这张图片',
        stream: true
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'DeepSeek V3 多模态请求失败');
    }
    return handleStreamResponse(response, onChunk, true);
  }

  const endpoint = modelType === 'deepseek' 
    ? 'https://api.deepseek.com/v1/chat/completions' 
    : 'https://api.openai.com/v1/chat/completions';
  
  const modelName = modelType === 'deepseek' ? 'deepseek-chat' : (config.openaiModel || 'gpt-5-nano');
  const messages = [];
  if (modelType === 'openai' && imageData) {
    const base64Data = imageData.split(',')[1];
    messages.push({
      role: 'user',
      content: [
        { type: "text", text: prompt || '' },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      stream: true
    })
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || '请求失败');
  }
  return handleStreamResponse(response, onChunk, false);
}

async function handleStreamResponse(response, onChunk, isDeepSeekV3) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    
    // 最后一项可能是完整行也可能是截断的，保留到下一次循环
    buffer = lines.pop();

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // 跳过结束标志
      if (trimmedLine === 'data: [DONE]') continue;
      
      if (trimmedLine.startsWith('data: ')) {
        const jsonStr = trimmedLine.substring(6).trim();
        if (!jsonStr) continue;
        
        try {
          const json = JSON.parse(jsonStr);
          let content = '';
          
          if (isDeepSeekV3) {
            // 适配 DeepSeek V3 可能的流式字段名
            content = json.text_response || json.content || (json.choices && json.choices[0]?.delta?.content) || '';
          } else {
            content = json.choices && json.choices[0]?.delta?.content || '';
          }
          
          if (content) {
            onChunk(content);
          }
        } catch (e) {
          console.warn('忽略解析失败的数据行:', trimmedLine, e);
          // 不抛出错误，继续处理下一行
        }
      }
    }
  }
}

function addMessage(text, type) {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  if (text) {
    if (type === 'user' || type === 'system') div.textContent = text;
    else div.innerHTML = text;
  }
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return div;
}

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

init();

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TEXT_SELECTED') {
    userInput.value = `请解释一下这段文字：\n"${message.text}"`;
    userInput.dispatchEvent(new Event('input'));
  }
});
