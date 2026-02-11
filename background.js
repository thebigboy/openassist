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
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
