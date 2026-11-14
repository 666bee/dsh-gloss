# DSH Gloss 设计说明

维护者文档。面向用户的说明见 [README](../README.md)。

## 1. 目的与边界

给 DSH 桌面端补「差一点」的交互细节，所有能力必须满足：

- 只用官方扩展点（Cordis `ctx.*` 与宿主 slot），不 monkey patch、不替换宿主节点、不劫持发送 / 刷新主流程；
- 最小侵入：能放官方座位就放座位，放不下的自建 `position:fixed` 图层且 `pointer-events:none`；
- 全前缀命名空间，与其它插件共存；
- 每个入口 `try/catch` + 日志，单点失败只降级本插件；
- 生命周期内所有监听、观察器、定时器在 disposer 里成对清理，重复 enable/disable 幂等；
- 不编造数据（没有总数就不显示数字）、不改布局、尊重 `prefers-reduced-motion`。

## 2. P0 结论

六项需求均可实现，不需要 monkey patch，但有一处必须自建 DOM（标题栏刷新按钮）。

| 需求 | 机制 | 结论 |
| --- | --- | --- |
| 一键刷新 | 桌面标题栏由 Electron preload（`lib/preload-app.cjs` 的 `installWindowsMenu()`）绘制成 `div[data-windows-menu]`（`position:fixed; z-index:1100`），**没有任何插件扩展点**。只能读它的 `getBoundingClientRect()`，在右侧放自己的 `position:fixed` 按钮（`z-index:1099`），不改动宿主节点 | 可行（DOM 锚点） |
| 发送后撤回 | 官方 slot `conversation.input.activity`（session 作用域，single，"Compact action after the model selector"），座位在模型选择器之后、提交键之前：撤回键宽度展开把模型名区向左推；按钮 34px 正圆、`translateY(-2.75px)` 与发送键圆心对齐 | 可行（官方扩展点） |
| 顶栏进度条 | 无「顶栏中心」座位：`shell.leading` 在 Windows 永不挂载（`dsh-client-ui-layout`：`const leadingMounted = darwin && sidebarCollapsed;`），`shell.overlay` 是 root 作用域（拿不到 `sessionId` / `useProjection`）。渲染节点挂在 session 作用域的 `conversation.session.header.actions`，用 `position:fixed` 定位到标题栏中心，`pointer-events:none` 不挡宿主 | 可行（官方扩展点 + 该座位自带的 `useSession` / `useProjection`） |

**未引入的能力**（宿主没有，因此不实现、不伪造）：没有「重载 UI」服务（`location.reload()` 是唯一软刷新）、没有 send/submit 事件总线（只有 `connection/reset`、`locale/change`、`slots/changed`、`theme/change`）、没有设置光标 / 选区的公开 API（`InputActions` 只有 `captureInsertion / insertText / setDraft / persistDraft / addAttachments / removeAttachment / pruneAttachments / submit`）。

## 3. 接口与挂载点

| 用途 | 接口 |
| --- | --- |
| 注册 client 模块 | `window.__ModuleLoader__.load({ id: 'dsh-gloss', factory(require) { … } })`，导出 `{ inject: ['slots','locale','sessions'], apply(ctx) }` |
| 拆装 | `ctx.effect(fn, label)`（renderer 卸载 / 热重载时执行返回的 disposer）、`ctx.slots.inject(name, () => ctx.slots.register({ name, id, order, locale, inject }, Component))` |
| 文案 | `ctx.locale.bind(ns)`、`ctx.locale.register(ns, { zh, en })` |
| 刷新 | `window.location.reload()`（**不重启宿主进程**，任务在 host 侧继续跑） |
| 锚点 | `document.querySelector('div[data-windows-menu]')` → `getBoundingClientRect().right + 6` |
| 发送 / 草稿 | `useInput(s => s)` → `{ draft, attachmentIds, draftRev, phase, … }`；`inputActions.setDraft(text)`、`addAttachments(ids)`、`persistDraft()` |
| 停止任务 | `ctx.sessions.scope(sessionId).get('conversation').cancel()`（官方 Stop 的同一路径，"preserving Queue"） |
| 运行态 | `useSession(s => s.running)` |
| 换行 | 组件内 `keydown` 捕获监听（作用域限本会话 composer）→ `inputActions.captureInsertion()` + `inputActions.insertText('\n', span)`；`span.draftRev` 过期即放弃 |
| 联网开关 | Host 半边（`index.js`）：`ctx.tools.guard()` 只拒绝 `web_search` / `web_fetch`（不注销，故不影响其他插件的工具注册）+ `ctx.systemPrompt.section({ name: 'dsh-gloss-no-web', order: 900 })` 注入禁止联网约束；状态经 `ctx.webServer.register({ kind: 'exact', path: '/dsh-gloss/web' })` 读写并持久化到插件目录 `state.json` |
| 状态通道 | Client 用相对路径 `fetch('/dsh-gloss/web')`：桌面端页面是 `dsh-app://app/`（自定义协议），相对请求由应用转发到本机 Harness 服务，不能用 `location.origin` 拼绝对 URL |
| 状态源 | `useSession(s => s.running)` 推 running / done；本插件自己的撤回（取消、缓冲撤回）成功后 `pulseCancel()` 置红。完成 / 红条保持 `STATUS_HOLD_MS = 2600` 后淡出 |
| 输入隐藏 | `useInput(s => s.draft)` 变化 → `setTyping(true)`，`TYPING_IDLE_MS = 1200` 后 `setTyping(false)`（**不是**按「草稿非空」判断：撤回后草稿会留在输入框里） |
| 总数 / 完成数 | `useProjection('todos') ?? []`（即 `todo_write` 的任务清单，`status` ∈ `completed / inProgress / pending`）；`total = todos.length`、`done = completed` 数。**无 todo 时不能用假总数** → 不确定进度 |
| 挂载点 | 刷新：`div[data-windows-menu]` 右侧自建节点，缺失时降级到 `conversation.session.header.actions`（order 80）；进度条 order 90、状态条桥 order 95 同在 `conversation.session.header.actions`；撤回键：`conversation.input.activity`（single 座位）；联网开关：`conversation.input.left`（list 座位，权限控件右侧，order 10）；侧栏提醒：`sidebar.workspaces.session.row.action`（order 20，宿主每行无条件渲染，只当定位锚点，动画直接作用在宿主圆点上）；进度条与状态条本体都在 `document.body` 下的 `position:fixed` 图层（不进任何 slot 的布局流） |

## 4. 命名空间

`dsh-gloss-*`（slot id）、`.dshGloss*`（CSS 类）、`style[data-dsh-gloss-css]`（样式标签）、`data-dsh-gloss-*`（DOM 属性）、locale 命名空间 `dsh-gloss`、effect 标签 `dsh-gloss: *`、host 路由 `/dsh-gloss/web`、进程单例 `Symbol.for('dsh-gloss.runtime@1')`。

1.0.0 之前这些前缀是 `dsh-polish` / `dshPolish`（见 [CHANGELOG.pre-1.0.md](../CHANGELOG.pre-1.0.md)）。

## 5. 兼容性风险与对策

| 风险 | 对策 |
| --- | --- |
| 标题栏是 preload 建的，宿主重绘会替换它 | `place()` 每次重新 `querySelector` 定位；`MutationObserver`（有界 15s）+ `ResizeObserver` 兜底；节点缺失时降级到会话标题栏座位，两者互斥（共享 `titlebarState`） |
| 占用 `conversation.input.activity`（single 座位） | 宿主当前没有其他占用者；空闲时组件返回 `null`（无节点、不占宽度），只在撤回窗口内存在；不调用 `onActiveChange`，不会把工具栏展开 |
| z-index 冲突 | 一律 `1099`（宿主标题栏是 `1100`），不抬到宿主之上；`pointer-events:none` 只用于进度条与状态条 |
| 样式泄漏 | 单 `<style data-dsh-gloss-css>`，全部选择器以 `.dshGloss*` 前缀作用域化，无全局选择器、无 `!important`；卸载时移除 |
| 事件 / 监听泄漏 | 所有监听、观察器、定时器都在 disposer 里成对清理；重复 enable/disable 幂等 |
| 重复点击 | `REFRESH` 状态机（IDLE / REFRESHING / FAILED，刷新中 `disabled`）、`UNDO` 状态机（IDLE / ARMED / CANCELLING / RESTORED） |
| 失败隔离 | 全部入口 `try/catch` + `log`；失败只让本插件降级 / 提示，不冒泡到宿主 |

## 6. 文件结构

```
dsh-gloss/
  package.json          dsh.bundle.patch + dsh.client{platform:"web", immediately:true, inject:[…]}
  cordis.patch.yml      - insert: - id: dsh-gloss  name: 'dsh-gloss'
  index.js              host 半边：联网开关门控（tools.guard + systemPrompt.section）、/dsh-gloss/web 路由、state.json
  client.js             web 半边：全部 UI（经典脚本 bundle，__ModuleLoader__.load）
  README.md             面向用户
  CHANGELOG.md          1.0.0 起
  CHANGELOG.pre-1.0.md  旧名时期历史（0.1.0 – 1.5.1）
  docs/                 DESIGN.md / market-entry.yml / RELEASE.md
  state.json            运行时状态（不入包，已 gitignore）
```

安装：`plugin_manager action=install_bundle target=<目录>`，entryId 形如 `include:dsh-gloss`。

## 7. 验证步骤

1. **静态**：`node --check client.js`、`node --check index.js`；`node tools/test-client-apply.mjs`（stub loader / DOM / ctx 跑 `factory` + `apply` + 全部 disposer，断言 6 个 slot 注册、10 个 effect 执行、effect 返回形状符合 Cordis 规则）。
2. **刷新按钮位置**：截图确认图标在「编辑」右侧、尺寸与菜单项同高（28px）。
3. **刷新中**：点击后按钮 `disabled` 且图标旋转 360°，320ms 后页面重载；重载期间再点无效。
4. **不杀任务**：任务流式中点击刷新 → 页面重载、会话继续、任务不中断。
5. **刷新失败**：拦截 `location.reload` → 1.5s 看门狗在右侧显示「刷新失败」。
6. **撤回键出现 / 收起**：发送一条提示词 → 模型名区左移、发送键左侧淡入红色圆键；悬停显示「撤回」浮层；仅 `running` 为真时显示，任务结束立即收起；草稿再次非空也立即收起。
7. **撤回成功**：点撤回 → 任务取消、输入框恢复原始文本与附件、光标在文末。
8. **撤回失败**：让 `conversation.cancel` 抛错 → 撤回键上方 toast「撤回失败」，按钮回到可点状态，UI 回滚。
9. **进度有总数**：`todo_write` 写 3 条（1 完成）→ 顶栏中心蓝色进度条 1/3，右侧「1/3」；完成数变化时宽度平滑过渡。
10. **进度无总数**：任务运行但无 todo → 不确定进度（往复动画），不显示假数字；无任务时不渲染。
11. **共存**：与 `codex-effort-slider`、`task-progress`、`billion-context` 同时启用，按钮布局与事件互不影响。
12. **幂等**：反复 disable / enable → DOM、样式、监听无堆积（`document.querySelectorAll('[data-dsh-gloss-refresh]').length` 恒为 1）。

## 8. 已知限制

- 生产构建的桌面应用**没有 reload 入口**：应用菜单只有「应用 / 编辑 / 检查更新 / CLI / 退出」，`role:"reload"` 只在 `development` 为真时插入，F5 / Ctrl+F5 未绑定。刷新只能靠本插件的按钮或重启应用。
- 光标只能恢复到文末（没有设置选区的公开 API）。
- 发送缓冲期的**用户气泡不会提前出现**：宿主没有「先渲染消息、后调度任务」的钩子（`submit(mode)` 会立刻 `dispatchRun({type:'enter'})`），因此缓冲期只能抑制提交本身，气泡在 3s 到点时才随提交出现；若要「气泡立即插入、任务延迟启动」，必须改宿主提交链路（属于 monkey patch，本项目不做）。
- 缓冲期拦截依赖两个稳定的宿主特征：可编辑区 `[contenteditable="true"]` / `textarea`，发送键 `button[class*="primary"]`。宿主若改类名，Enter 拦截仍然生效，发送键拦截会自动失效（不报错，退化为「Enter 有缓冲、点按钮无缓冲」）。

## 9. 附录：0.1.1 冷启动崩溃复盘（历史，旧名时期）

安装并重启桌面应用后，Web 端直接启动失败：

```
Error: web boot: 1 entry did not activate
dsh-polish: failed
```

日志位置：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log`。

根因：`apply()` 里 P1 的 effect 返回了普通对象 `{ dispose }`。Cordis 的 `Fiber#_execute`（`@deepseek-ai/cordis/src/fiber.ts`）只接受这几种返回形状：释放函数、`null` / `undefined`、thenable、可迭代对象；其余一律 `throw new TypeError('Invalid effect')`。于是 `apply` 抛出 → client 条目在启动审计里变成 failed → 整个 Web 端启动失败。HMR 热挂载时看不出问题（旧版本已挂载），只有冷启动才暴露。

修复：`apply()` 内 `install(label, body)` 把 effect 返回值统一归一化为「函数或 undefined」，并用 `try/catch` 包住注册与执行体；`tools/test-client-apply.mjs` 的 effect stub 按 Cordis 规则校验返回形状，这类错误会在静态测试阶段直接失败。
