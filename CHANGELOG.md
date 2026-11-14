# DSH Gloss 更新日志

本文件从 1.0.0 起记录。1.0.0 之前的历史（旧名 `dsh-polish`，版本 0.1.0 – 1.5.1）见 [CHANGELOG.pre-1.0.md](./CHANGELOG.pre-1.0.md)。

## 1.0.0 — 2026-11-14

首个公开发布版本，同时改名。

### 改名

- 包名 `dsh-polish` → `dsh-gloss`，显示名 DSH Polish → **DSH Gloss**。旧名在 npm 已被他人占位，无法继续发布。
- 对外标识符同步改名，避免与其它插件冲突：模块 id `dsh-gloss`、slot id `dsh-gloss-*`、CSS 类 `.dshGloss*`、样式标签 `style[data-dsh-gloss-css]`、DOM 属性 `data-dsh-gloss-*`、locale 命名空间 `dsh-gloss`、effect 标签 `dsh-gloss: *`、宿主路由 `/dsh-gloss/web`。
- 版本号归零到 1.0.0：这是新名字下的第一条产线，功能集合与 1.5.2 完全一致。

### 功能

- 一键刷新：桌面标题栏「编辑」右侧的图标按钮，点击后图标转一圈，页面软刷新，host 侧任务不受影响。
- 发送后撤回：任务进行中，发送键左侧出现红色圆键，点击 = 停止任务并恢复原始输入。
- 发送缓冲 3 秒：发送后 3 秒内可反悔，撤回只取消这次待提交，不停止任务；再点一次发送键可立即发出。
- Alt+Enter 换行：插入可 `Ctrl+Z` 回退的换行，不发送；输入法组词期间不拦截。
- 顶栏进度条：按 `todo_write` 的完成情况显示进度和剩余估算；没有总数时走不确定动画，不编造数字；运行中条内有一道流光。
- 联网开关：输入区工具行的「联网」开关，关闭后 `web_search` / `web_fetch` 被拒，并注入禁止联网的系统提示；状态持久化。
- 状态指示条：顶栏下方 2px 细条，运行蓝 / 完成绿 / 撤回红，输入时自动隐藏。
- 侧栏圆点提醒：不在该会话时，后台跑完或开始等你的会话，侧栏圆点闪两下。

### 验证

- `node --check` 通过（`client.js`、`index.js`）。
- `node tools/test-client-apply.mjs` → `ok: true`，10 个 effect、6 个 slot，id 均为 `dsh-gloss-*`。
- 重挂 profile 后重载页面，六项功能逐个截图核对；`GET /dsh-gloss/web` 返回 `200 {"ok":true,"enabled":true}`；无新增崩溃日志。
