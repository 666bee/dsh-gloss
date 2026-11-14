<!-- ai-assisted: true; generated-by: DeepSeek Harness coding agent under human review -->
# DSH Gloss

> 针对六个高频交互环节的界面增强：消息撤回、任务进度、换行输入、联网开关、完成提醒、界面刷新。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![AI-assisted](https://img.shields.io/badge/code-AI--assisted-lightgrey.svg)](#ai-参与说明)

DSH Gloss 是 DeepSeek Harness 桌面端的界面增强插件。它不引入新的工作流，只补齐日常操作中缺失的几处反馈与控制：误发后的撤回窗口、任务的进度与剩余时间、输入区内的联网开关、后台任务完成时的侧栏提示，以及无需重启即可重载界面的入口。

实现上仅使用宿主公开的扩展点，不修改渲染树、不替换宿主节点、不拦截发送与刷新主流程。

> **AI 参与编写**：本项目的代码与文档由 AI 编码代理（DeepSeek Harness）生成初稿，由人工完成需求定义、方案取舍、逐项验收与发布决策。详见 [AI 参与说明](#ai-参与说明)。

## 功能

| 使用场景 | 插件行为 |
| --- | --- |
| 消息误发 | **发送后撤回**：任务启动后，发送键左侧出现撤回键；点击后停止当前任务，并将刚才发送的文本、附件与光标位置原样恢复至输入框 |
| 发送后立即反悔 | **3 秒发送缓冲**：发送后 3 秒内可取消本次提交，仅取消待提交内容，不停止任务；再点一次发送键可立即提交 |
| 长文本换行 | **Alt+Enter 换行**：插入可通过 `Ctrl+Z` 回退的换行符，不触发发送；输入法组词期间不拦截 |
| 任务进度不明确 | **顶栏进度条**：依据任务清单完成度显示进度与剩余时间估算；缺少总数时仅显示不确定动画，不推断数值 |
| 需要临时断网 | **联网开关**：输入区工具行内的开关，关闭后拒绝 `web_search`、`web_fetch`，并注入本轮禁止联网的系统提示；状态持久化 |
| 后台任务完成未察觉 | **侧栏圆点提醒**：当会话不在前台时，任务完成或进入等待（审批、提问、计划确认）时侧栏圆点闪烁两次；前台会话不打扰 |
| 需要重载界面 | **一键刷新**：标题栏「编辑」右侧的图标按钮，触发页面软刷新，host 侧任务不受影响 |
| 运行状态不明确 | **状态指示条**：顶栏下方 2px 细条，运行蓝色、完成绿色、撤回红色；输入时自动隐去 |

## 安装

当前仅支持本地目录安装：

1. 将本仓库克隆或下载到任意目录。
2. 在 DSH 中由 agent 调用 `plugin_manager action=install_bundle target=<该目录绝对路径>`。
3. 重载页面，在「设置 → 插件」中确认 `dsh-gloss` 已启用。

安装后，profile 的 `package.json` 会增加一条 `"dsh-gloss": "link:…"` 依赖，`dsh.profile.bundles` 末尾追加 `dsh-gloss`；`cordis.patch.yml` 中的 `- insert:` 条目由本包提供，无需手工修改 profile。

发布至 npm 后可改用 `dsh plugin add dsh-gloss`。

## 兼容性

- 实测环境：DSH 桌面端 `0.2.2-rc.1`（Windows）。
- 仅使用官方扩展点：Cordis `ctx.effect` / `ctx.slots` / `ctx.locale` / `ctx.webServer` / `ctx.tools.guard` / `ctx.systemPrompt.section`，以及 `conversation.input.left`、`conversation.input.activity`、`conversation.session.header.actions`、`sidebar.workspaces.session.row.action` 四个座位。
- 唯一自建 DOM 为标题栏刷新按钮：宿主将标题栏渲染于 `div[data-windows-menu]` 内且未提供扩展点，插件仅读取其位置并在右侧挂载按钮。
- 宿主缺少某个座位时，对应功能自动降级或关闭，不影响页面启动。

## 运行行为与副作用

- **联网开关为减法实现**：关闭时仅拒绝 `web_search`、`web_fetch` 两个工具并追加一段禁止联网的系统提示，不注销任何工具注册，不影响其它插件。
- **发送缓冲期间的界面表现**：宿主未提供「先渲染消息、后调度任务」的钩子，因此消息气泡在 3 秒缓冲结束、提交实际发生时出现；缓冲开始时输入框内容即清空并进入缓冲态。
- **刷新语义**：刷新按钮执行 `location.reload()`，属于页面软刷新，不等同于重启应用；host 侧运行中的任务不受影响。

## 数据与隐私

- 插件自身不发起网络请求，不上报任何数据。
- 唯一持久化文件为插件目录下的 `state.json`，内容仅包含 `webEnabled` 字段。
- `/dsh-gloss/web` 路由仅用于本机前端读写该开关状态。

## 卸载与故障排查

- 卸载：`plugin_manager action=remove_bundle target=dsh-gloss`。手工清理需移除 profile `package.json` 中的依赖项与 `dsh.profile.bundles` 中的条目，并删除插件目录。
- 与其它插件共存时，可通过以下前缀识别本插件：slot id `dsh-gloss-*`、CSS 类 `.dshGloss*`、样式标签 `style[data-dsh-gloss-css]`、DOM 属性 `data-dsh-gloss-*`、locale 命名空间 `dsh-gloss`、effect 标签 `dsh-gloss: *`、host 路由 `/dsh-gloss/web`。
- 界面异常时，检查桌面应用日志目录下的 `crash-*-web-boot.log`。插件所有入口均包裹 `try/catch`，单个功能失败仅自身降级。

## 开发

```bash
node --check plugins/dsh-gloss/client.js
node --check plugins/dsh-gloss/index.js
node tools/test-client-apply.mjs          # 静态 harness：校验 effect 返回形状、slot id、重复注册
```

设计取舍、接口与挂载点清单、风险对策与已知限制见 [docs/DESIGN.md](./docs/DESIGN.md)；1.0.0 之前的变更记录见 [CHANGELOG.pre-1.0.md](./CHANGELOG.pre-1.0.md)。

## AI 参与说明

本项目在开发过程中使用 AI 编码代理（DeepSeek Harness）生成代码与文档初稿。分工如下：

- **AI 承担**：实现代码、测试脚本、文档初稿、发布材料与提交信息。
- **人工承担**：需求定义、方案取舍、兼容性验收、逐项功能测试与发布决策。
- **验收方式**：每次变更均需通过 `node --check` 语法检查与 `tools/test-client-apply.mjs` 静态 harness，并在真实桌面端重载后逐项截图核对。
- **运行期影响**：AI 仅参与开发过程，不作为运行时依赖；插件本身不包含任何模型调用或远程服务。

上述标记同时以 HTML 注释 `ai-assisted: true` 形式写入本文件头部，便于工具识别。

## English

DSH Gloss is a UI enhancement plugin for the DeepSeek Harness desktop app. It adds six small controls to everyday interactions: undo right after sending, a task progress bar with an ETA, Alt+Enter line breaks, a web-access switch in the composer, sidebar notifications for background completions, and a soft-refresh button in the title bar. It relies solely on public extension points and never patches the host render tree.

Code and documentation were drafted by an AI coding agent (DeepSeek Harness) and reviewed, tested and released by a human maintainer. See [AI 参与说明](#ai-参与说明) for details.

## 许可

MIT
