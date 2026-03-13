# Chrome 扩展「需求分析」功能实现文档

## 功能概述

在 `wiki.ivedeng.com` 域名下的网页上，右键菜单中新增「需求分析」选项。点击后：
1. 自动打开侧边栏
2. 提取页面 `.wiki-content` 元素的 HTML 内容
3. 转换为 Markdown 后以可折叠标签形式挂在输入框上方
4. 自动填充分析提示词
5. 发送时将需求文档内容拼接到 prompt 中发给 LLM

## 数据流

```
右键「需求分析」
  → background.js: chrome.sidePanel.open()（同步，必须在用户手势链中）
  → background.js: chrome.scripting.executeScript() 提取 .wiki-content innerHTML
  → background.js: 写入 chrome.storage.local + 延迟发送 runtime 消息（双通道）
  → sidepanel/script.js: 收到消息 / 从 storage 读取
  → Turndown.js 将 HTML 转 Markdown
  → 显示可折叠标签 + 填充提示词
  → 用户点击发送 → prompt 拼接 wiki 内容 → LLM API
```

## 第三方依赖

- **turndown.js** — HTML 转 Markdown 库
- 下载地址: `https://unpkg.com/turndown/dist/turndown.js`
- 放入 `sidepanel/libs/turndown.min.js`

```bash
curl -L -o sidepanel/libs/turndown.min.js https://unpkg.com/turndown/dist/turndown.js
```

---

## 修改清单

### 1. manifest.json — 新增权限

新增 `activeTab`、`scripting` 权限和 `host_permissions`：

```json
{
  "permissions": [
    "sidePanel",
    "contextMenus",
    "storage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "*://wiki.ivedeng.com/*"
  ]
}
```

**说明**：
- `activeTab`: 允许访问当前激活的 tab
- `scripting`: 允许使用 `chrome.scripting.executeScript()` 注入脚本
- `host_permissions`: 限定只在 wiki.ivedeng.com 域名下有注入权限

---

### 2. background.js — 新增菜单项和内容提取

#### 2.1 注册右键菜单（在 `onInstalled` 中添加）

```javascript
chrome.contextMenus.create({
  id: "analyze-requirement",
  title: "需求分析",
  contexts: ["all"],
  documentUrlPatterns: ["*://wiki.ivedeng.com/*"]
});
```

`documentUrlPatterns` 确保该菜单项仅在 wiki.ivedeng.com 域名下显示。

#### 2.2 处理菜单点击（在 `onClicked` 监听器中添加分支）

```javascript
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
```

> **踩坑记录**: `chrome.sidePanel.open()` 必须在用户手势的**同步调用链**中执行。如果放在 `executeScript().then()` 等异步回调中，会报错：
> `sidePanel.open() may only be called in response to a user gesture`
> 解决方案：先同步调用 `sidePanel.open()`，再异步提取内容。

> **踩坑记录**: `chrome.runtime.sendMessage()` 在 sidepanel 尚未加载完成时会静默失败（无 listener 接收）。解决方案：采用 **storage + runtime 消息双通道**，确保数据不丢失。

---

### 3. sidepanel/index.html — 新增标签容器 + 引入 Turndown

#### 3.1 在 `#preview-area` 和 `<footer>` 之间添加标签容器

```html
<div id="wiki-content-tag" class="hidden">
  <div class="tag-header">
    <span class="tag-label">📄 需求内容</span>
    <button id="toggle-wiki-content" title="展开/收起">▼</button>
    <button id="remove-wiki-content" title="移除">&times;</button>
  </div>
  <div id="wiki-content-body" class="tag-body"></div>
</div>
```

#### 3.2 在 `<script>` 区域引入 turndown.js（放在 marked.js 之后）

```html
<script src="libs/marked.min.js"></script>
<script src="libs/highlight.min.js"></script>
<script src="libs/turndown.min.js"></script>
<script src="script.js"></script>
```

---

### 4. sidepanel/style.css — 新增标签样式

在 `.hidden` 规则之前添加：

```css
/* Wiki Content Tag */
#wiki-content-tag {
  margin: 0;
  padding: 0.5rem 1rem;
  background-color: #f9fafb;
  border-top: 1px solid var(--border);
}

.tag-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tag-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-main);
  flex: 1;
}

#toggle-wiki-content,
#remove-wiki-content {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.875rem;
  transition: all 0.2s;
}

#toggle-wiki-content:hover,
#remove-wiki-content:hover {
  background-color: #e5e7eb;
  color: var(--text-main);
}

.tag-body {
  max-height: 120px;
  overflow: hidden;
  margin-top: 0.4rem;
  padding: 0.5rem;
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-main);
  transition: max-height 0.3s ease;
}

.tag-body.expanded {
  max-height: 300px;
  overflow-y: auto;
}

.tag-body h1, .tag-body h2, .tag-body h3,
.tag-body h4, .tag-body h5, .tag-body h6 {
  margin: 0.4rem 0 0.2rem;
  font-size: 0.875rem;
}

.tag-body p {
  margin: 0.25rem 0;
}

.tag-body ul, .tag-body ol {
  padding-left: 1.2rem;
  margin: 0.25rem 0;
}

.tag-body pre {
  background-color: #f3f4f6;
  padding: 0.4rem;
  border-radius: 0.25rem;
  overflow-x: auto;
  font-size: 0.75rem;
}

.tag-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.25rem 0;
  font-size: 0.75rem;
}

.tag-body th, .tag-body td {
  border: 1px solid var(--border);
  padding: 0.2rem 0.4rem;
}
```

---

### 5. sidepanel/script.js — 核心逻辑

#### 5.1 新增 DOM 引用和状态变量

在现有 DOM 引用之后添加：

```javascript
const wikiContentTag = document.getElementById('wiki-content-tag');
const wikiContentBody = document.getElementById('wiki-content-body');
const toggleWikiBtn = document.getElementById('toggle-wiki-content');
const removeWikiBtn = document.getElementById('remove-wiki-content');

let currentWikiMarkdown = null;
```

#### 5.2 新增标签交互事件

```javascript
// Wiki 内容标签：展开/收起
toggleWikiBtn.addEventListener('click', () => {
  const isExpanded = wikiContentBody.classList.toggle('expanded');
  toggleWikiBtn.textContent = !isExpanded ? '▲' : '▼';
});

// Wiki 内容标签：移除
removeWikiBtn.addEventListener('click', () => {
  currentWikiMarkdown = null;
  wikiContentTag.classList.add('hidden');
  wikiContentBody.innerHTML = '';
  toggleWikiBtn.textContent = '▼';
  wikiContentBody.classList.remove('expanded');
});
```

#### 5.3 修改 sendMessage() — 拼接需求内容到 prompt

将 `const prompt = text;` 替换为：

```javascript
let prompt = text;
if (currentWikiMarkdown) {
  prompt = text + '\n\n---\n以下是需求文档内容：\n' + currentWikiMarkdown;
}
```

#### 5.4 新增消息处理函数

```javascript
// 处理需求分析消息
function handleRequirementAnalysis(message) {
  if (message.error || !message.html) {
    addMessage(message.error || '未找到需求内容', 'system');
    return;
  }
  const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  currentWikiMarkdown = turndownService.turndown(message.html);

  wikiContentBody.innerHTML = marked.parse(currentWikiMarkdown);
  wikiContentBody.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });
  wikiContentTag.classList.remove('hidden');
  wikiContentBody.classList.remove('expanded');
  toggleWikiBtn.textContent = '▼';

  userInput.value = '请对以下需求文档进行分析，包括：该网页是我的一份需求，是否存在逻辑性的错误或遗漏的地方。';
  userInput.dispatchEvent(new Event('input'));
}
```

#### 5.5 在 runtime 消息监听器中新增分支

```javascript
chrome.runtime.onMessage.addListener((message) => {
  console.log('[OpenAssist] sidepanel 收到消息:', message.type);
  if (message.type === 'TEXT_SELECTED') {
    userInput.value = `请解释一下这段文字：\n"${message.text}"`;
    userInput.dispatchEvent(new Event('input'));
  } else if (message.type === 'REQUIREMENT_ANALYSIS') {
    handleRequirementAnalysis(message);
  }
});
```

#### 5.6 新增 storage 兜底读取（脚本末尾添加）

```javascript
// 启动时检查 storage 中是否有待处理的需求分析数据（兜底机制）
chrome.storage.local.get('pendingRequirement', (result) => {
  if (result.pendingRequirement) {
    console.log('[OpenAssist] 从 storage 读取到待处理需求数据');
    handleRequirementAnalysis(result.pendingRequirement);
    chrome.storage.local.remove('pendingRequirement');
  }
});
```

---

## 踩坑总结

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `sidePanel.open() may only be called in response to a user gesture` | `sidePanel.open()` 放在了 `executeScript().then()` 异步回调中，脱离了用户手势上下文 | 将 `sidePanel.open()` 提到 `onClicked` 监听器的同步调用链中，先开面板再异步提取内容 |
| 点击需求分析后侧边栏无反应 | `chrome.runtime.sendMessage()` 在 sidepanel 尚未加载完时发送，无 listener 接收，消息静默丢失 | 采用 **storage + runtime 消息双通道**：background 先写入 storage，sidepanel 启动时检查 storage 兜底读取 |
| 菜单项在所有网站都出现 | 未限定菜单显示域名 | 使用 `documentUrlPatterns: ["*://wiki.ivedeng.com/*"]` 限制仅在 wiki 域名显示 |

## 验证步骤

1. 在 `chrome://extensions/` 重新加载扩展
2. 访问 `wiki.ivedeng.com` 任意需求页面
3. 右键应看到「需求分析」菜单项（其他域名不应出现）
4. 点击后侧边栏打开，输入框填充提示词，上方出现需求内容标签
5. 标签可展开/收起、可移除
6. 点击发送，确认 API 请求中包含了需求文档内容

## 调试方法

- **Service Worker 控制台**：`chrome://extensions/` → 点击扩展的 "Service Worker" 链接，查看 `[OpenAssist]` 开头的日志
- **Sidepanel 控制台**：在侧边栏面板上右键 → 检查，查看 Console
- 关键日志节点：`开始` → `executeScript 返回` → `已写入 storage` → `sidepanel 收到消息`
