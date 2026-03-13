chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-sidepanel",
    title: "打开 OpenAssist",
    contexts: ["all"]
  });
  
  chrome.contextMenus.create({
    id: "explain-text",
    title: "使用 OpenAssist 解释选中文字",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "analyze-requirement",
    title: "需求分析",
    contexts: ["all"],
    documentUrlPatterns: ["*://wiki.ivedeng.com/*"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-sidepanel") {
    chrome.sidePanel.open({ tabId: tab.id });
  } else if (info.menuItemId === "explain-text") {
    chrome.sidePanel.open({ tabId: tab.id }).then(() => {
      // 等待侧边栏打开后发送消息
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'TEXT_SELECTED',
          text: info.selectionText
        });
      }, 500);
    });
  } else if (info.menuItemId === "analyze-requirement") {
    console.log('[OpenAssist] 需求分析：开始, tabId:', tab.id);
    // 必须在用户手势的同步调用链中打开 sidePanel
    chrome.sidePanel.open({ tabId: tab.id });
    // 然后异步提取内容并通过 storage 传递
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.querySelector('.wiki-content');
        return el ? el.innerHTML : null;
      }
    }).then((results) => {
      console.log('[OpenAssist] executeScript 返回:', results);
      const html = results && results[0] && results[0].result;
      const msg = html
        ? { type: 'REQUIREMENT_ANALYSIS', html: html }
        : { type: 'REQUIREMENT_ANALYSIS', html: null, error: '未找到需求内容（页面中没有 .wiki-content 元素）' };

      chrome.storage.local.set({ pendingRequirement: msg }, () => {
        console.log('[OpenAssist] 已写入 storage');
        // 延迟发送 runtime 消息，给 sidepanel 加载时间
        setTimeout(() => {
          chrome.runtime.sendMessage(msg).catch((err) => {
            console.warn('[OpenAssist] sendMessage 失败（侧边栏会从 storage 读取）:', err.message);
          });
        }, 800);
      });
    }).catch((err) => {
      console.error('[OpenAssist] executeScript 失败:', err);
      const msg = { type: 'REQUIREMENT_ANALYSIS', html: null, error: '提取需求内容失败: ' + err.message };
      chrome.storage.local.set({ pendingRequirement: msg });
    });
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
