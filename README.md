# DSH Gloss

> 六处界面细节，天天都在用。 / Six small things you'll use every day.

DSH Gloss 补的是 DeepSeek Harness 里那几处「差一点」：发出去的话三秒内能撤回，任务跑到哪了一步顶栏有进度和剩余时间，想断网干活输入框旁边有个开关，切去别的会话后台跑完了侧栏圆点会闪两下。没有大功能，都是每天要按几十次的小东西。

## 它能做什么

| 你遇到的 | 插件给的 |
| --- | --- |
| 发出去才发现打错了 | **发送后撤回**：任务跑起来后，发送键左边会多出一个红色圆键，点一下就停下并把你刚发的内容、附件、光标位置原样放回输入框 |
| 手快按了 Enter | **3 秒缓冲**：发送后 3 秒内还能反悔，撤回只取消这次提交、不停任务；想立刻发就再点一次发送键 |
| 不知道任务跑到哪了 | **顶栏进度条**：按任务清单的完成情况画进度，右侧给出「已完成/总数」和大致剩余时间；没有清单时只走不确定动画，绝不编数字 |
| 写长段落按 Enter 就发出去了 | **Alt+Enter 换行**：插一个能 `Ctrl+Z` 回退的换行，不触发发送；输入法组词时不拦截 |
| 想临时断网干活 | **联网开关**：输入区工具行里的「联网」开关，关掉后联网工具被拒绝并注入禁止联网的提示；状态记在本地 |
| 切去别的会话就错过完成 | **侧栏圆点提醒**：不在那个会话时，它跑完或开始等你操作（审批、提问、计划确认），侧栏圆点会闪两下；你正在看的会话不打扰 |
| 想重载界面找不到入口 | **一键刷新**：标题栏「编辑」右边的图标按钮，点一下图标转一圈、页面软刷新，后台任务继续跑 |
| 分不清在跑还是跑完了 | **状态指示条**：顶栏下方 2px 细条，运行蓝、完成绿、撤回红；你在打字时会自动隐去 |

## 安装

本地目录安装（当前可用）：

```
# 在 DSH 里让 agent 调用：
# plugin_manager action=install_bundle target=<本目录绝对路径>
```

装好后 profile 的 `package.json` 会多一条 `"dsh-gloss": "link:…"`，`dsh.profile.bundles` 末尾追加 `dsh-gloss`，`cordis.patch.yml` 里的 `- insert:` 条目由本包提供，不需要手改 profile。

发布到 npm 之后可以直接写 `dsh plugin add dsh-gloss`。装完在「设置 → 插件」里确认已启用。

## 兼容性

- 实测环境：DSH 桌面端 `0.2.2-rc.1`（Windows）。
- 只使用官方扩展点：Cordis `ctx.effect` / `ctx.slots` / `ctx.locale` / `ctx.webServer` / `ctx.tools.guard` / `ctx.systemPrompt.section`，以及 `conversation.input.left`、`conversation.input.activity`、`conversation.session.header.actions`、`sidebar.workspaces.session.row.action` 四个座位。
- 不 monkey patch、不替换宿主节点、不劫持发送与刷新主流程。唯一一处自建 DOM 是标题栏刷新按钮（宿主把标题栏画在 `div[data-windows-menu]` 里，没有插件扩展点，所以只读它的位置、在右侧放自己的按钮）。
- 宿主缺某个座位时对应功能自动降级或关闭，不会拖垮页面启动。

## 权限与副作用（请先读）

- **联网开关是「减法」**：关闭时插件只拒绝 `web_search`、`web_fetch` 两个工具，并追加一段系统提示要求这轮不要联网；不注销任何工具注册，不影响其它插件。
- 发送缓冲期间**你的消息气泡不会提前出现**：宿主没有「先渲染消息、后调度任务」的钩子，所以气泡是在 3 秒到点真正提交时才出现（输入框内容会立刻清空并进入缓冲态）。
- 刷新按钮执行的是页面软刷新（`location.reload()`），不等同于重启应用；host 侧正在跑的任务不受影响。
- 插件自身不联网、不上报数据。唯一持久化的文件是插件目录下的 `state.json`，内容只有 `webEnabled`。

## 卸载与排查

- 卸载：`plugin_manager action=remove_bundle target=dsh-gloss`；手工清理的话，移除 profile `package.json` 里的依赖与 `dsh.profile.bundles` 里的条目、删掉插件目录即可。
- 与其它插件共存时按这些前缀识别：slot id `dsh-gloss-*`、CSS 类 `.dshGloss*`、样式标签 `style[data-dsh-gloss-css]`、DOM 属性 `data-dsh-gloss-*`、locale 命名空间 `dsh-gloss`、effect 标签 `dsh-gloss: *`、host 路由 `/dsh-gloss/web`。
- 万一界面异常，看桌面应用日志目录下的 `crash-*-web-boot.log`；本插件所有入口都做了 try/catch，失败只降级自己。

## 开发

```bash
node --check plugins/dsh-gloss/client.js
node --check plugins/dsh-gloss/index.js
node tools/test-client-apply.mjs          # 静态 harness：校验 effect 形状、slot id、重复注册
```

设计取舍、P0 结论、接口与挂载点清单、风险对策、已知限制见 [docs/DESIGN.md](./docs/DESIGN.md)；旧版本变更见 [CHANGELOG.pre-1.0.md](./CHANGELOG.pre-1.0.md)。

## 许可

MIT
