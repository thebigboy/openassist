const deepseekInput = document.getElementById('deepseek-key');
const openaiInput = document.getElementById('openai-key');
const openaiModelInput = document.getElementById('openai-model');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status');

// 加载现有配置
chrome.storage.local.get(['deepseekKey', 'openaiKey', 'openaiModel'], (result) => {
  if (result.deepseekKey) deepseekInput.value = result.deepseekKey;
  if (result.openaiKey) openaiInput.value = result.openaiKey;
  if (result.openaiModel) openaiModelInput.value = result.openaiModel;
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
    statusMsg.textContent = '✅ 设置已成功保存！侧边栏已同步。';
    statusMsg.style.color = '#059669';

    // 3秒后清除状态提示
    setTimeout(() => {
      statusMsg.textContent = '';
    }, 3000);
  });
});
