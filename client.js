/**
 * dsh-gloss —— P1 一键刷新 / P2 发送后撤回 / P3 顶栏进度条
 *
 * 纯 Client 插件：Host 半边（index.js）为空。
 * 全部挂载点都是官方 slot，唯一例外是 P1 的桌面标题栏按钮。
 * 桌面标题栏由 Electron preload（lib/preload-app.cjs）绘制，没有插件扩展 API，
 * 因此 P1 只在标题栏条带内自建一个 fixed 元素锚定到 `div[data-windows-menu]` 右侧，
 * 不修改宿主 DOM、不覆盖宿主事件；标题栏缺失时降级到会话标题栏座位。
 *
 * 注意（1.0.0 修复）：`ctx.effect()` 的返回形状受 Cordis 校验，只接受
 * 释放函数 / null / undefined / thenable / 可迭代对象；返回 `{ dispose }` 之类
 * 的普通对象会抛 `TypeError: Invalid effect`，使本条目在启动审计里变成 failed，
 * 整个 Web 端启动失败。apply 内统一通过 `install()` 归一化并吞掉异常。
 */
window.__ModuleLoader__.load({
  id: 'dsh-gloss',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'dsh-gloss';


    const ID_REFRESH_FALLBACK = 'dsh-gloss-refresh';
    const ID_UNDO = 'dsh-gloss-undo';
    const ID_PROGRESS = 'dsh-gloss-progress';
    const ID_WEB = 'dsh-gloss-web';
    const ID_STATUS = 'dsh-gloss-status';
    const ID_SESSION_RING = 'dsh-gloss-ring';
    /** T4：与 Host 半边共享的开关状态路由（Host 用同一个路径）。 */
    const WEB_ROUTE = '/dsh-gloss/web';

    /** P1 状态机。 */
    const REFRESH = { IDLE: 'idle', REFRESHING: 'refreshing', FAILED: 'failed' };
    /** P2 状态机。 */
    const UNDO = { IDLE: 'idle', ARMED: 'armed', CANCELLING: 'cancelling', RESTORED: 'restored' };

    const RELOAD_DELAY_MS = 320; // 让旋转动画被看见
    const RELOAD_WATCHDOG_MS = 1500; // reload 被拦截时的失败兜底
    const UNDO_COLLAPSE_MS = 300;
    /** T3 发送缓冲期：撤回窗口，期间任务不会被调度。 */
    const DSH_ENH_BUFFER_MS = 3000;
    /** T3 环形倒计时周长（r=15.75 → 2πr≈99）。 */
    const DSH_ENH_RING_LENGTH = 99;
    /** T5 完成/撤回色条的保持时长（之后淡出）。 */
    const STATUS_HOLD_MS = 2600;
    /** T5 停止输入多久后恢复色条（防抖）。 */
    const TYPING_IDLE_MS = 1200;

    const CSS = `
.dshGlossRefresh_host{position:fixed;z-index:1099;display:flex;align-items:center;-webkit-app-region:no-drag;pointer-events:auto}
.dshGlossRefresh_btn{appearance:none;display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#cdd3dd);cursor:pointer;transition:background-color .12s ease,color .12s ease}
.dshGlossRefresh_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dshGlossRefresh_btn:disabled{cursor:default;opacity:.6}
.dshGlossRefresh_btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}
.dshGlossRefresh_icon{width:16px;height:16px;transform:rotate(0deg);transition:transform .32s cubic-bezier(.34,.04,.32,1)}
.dshGlossRefresh_btn[data-state="refreshing"] .dshGlossRefresh_icon{transform:rotate(360deg)}
.dshGlossRefresh_tip{position:absolute;left:100%;top:50%;transform:translate(10px,-50%);white-space:nowrap;font-size:12px;line-height:18px;padding:2px 8px;border-radius:6px;background:var(--dsw-alias-bg-elevated,#2b2f36);color:var(--dsw-alias-label-primary,#e6e9ef);box-shadow:0 2px 8px rgba(0,0,0,.28);opacity:0;visibility:hidden;transition:opacity .12s ease;pointer-events:none}
.dshGlossRefresh_tip[data-show="1"]{opacity:1;visibility:visible}
.dshGlossRefresh_tip[data-tone="error"]{color:#ff8b8b}
.dshGlossUndo_cell{display:flex;align-items:center;justify-content:flex-end;flex:none;width:0;min-width:0}
.dshGlossUndo_cell[data-open="0"]{width:0;visibility:hidden;animation:dshGlossUndoOut .28s cubic-bezier(.4,0,1,1) both}
.dshGlossUndo_cell[data-open="1"]{width:40px;visibility:visible;animation:dshGlossUndoIn .9s cubic-bezier(.22,.85,.28,1) both}
@keyframes dshGlossUndoIn{from{width:0}to{width:40px}}
@keyframes dshGlossUndoOut{from{width:40px}to{width:0}}
.dshGlossUndo_wrap{position:relative;display:flex;align-items:center;justify-content:center;padding-left:6px}
.dshGlossUndo_pop{display:flex;align-items:center;justify-content:center;opacity:0;transform:translateX(10px) scale(.8)}
.dshGlossUndo_cell[data-open="1"] .dshGlossUndo_pop{animation:dshGlossUndoPopIn .78s cubic-bezier(.2,.9,.3,1) both}
.dshGlossUndo_cell[data-open="0"] .dshGlossUndo_pop{animation:dshGlossUndoPopOut .16s ease both}
@keyframes dshGlossUndoPopIn{from{opacity:0;transform:translateX(14px) scale(.45)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes dshGlossUndoPopOut{from{opacity:1;transform:translateX(0) scale(1)}to{opacity:0;transform:translateX(10px) scale(.8)}}
.dshGlossUndo_btn{appearance:none;position:relative;display:grid;place-items:center;width:34px;height:34px;padding:0;border:0;corner-shape:round;border-radius:999px;background:#e5484d;color:#fff;cursor:pointer;flex:none;transform:translateY(-2.75px);transition:background-color .12s ease,transform .12s ease}
.dshGlossUndo_btn:hover:not(:disabled){background:#d93c41}
.dshGlossUndo_btn:active:not(:disabled){transform:translateY(-2.75px) scale(.94)}
.dshGlossUndo_cell[data-open="1"] .dshGlossUndo_btn:disabled{opacity:.55;cursor:default}
.dshGlossUndo_btn:focus-visible{outline:2px solid #ff9ba0;outline-offset:1px}
.dshEnh_Ring{position:absolute;inset:-1px;width:calc(100% + 2px);height:calc(100% + 2px);transform:rotate(-90deg);pointer-events:none;overflow:visible}
.dshEnh_Ring circle{fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-dasharray:99;stroke-dashoffset:99;animation:dshEnhRingCountdown 3s linear forwards}
@keyframes dshEnhRingCountdown{from{stroke-dashoffset:99}to{stroke-dashoffset:0}}
.dshGlossUndo_toast{position:absolute;bottom:calc(100% + 8px);right:0;white-space:nowrap;font-size:12px;line-height:18px;padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-elevated,#2b2f36);color:#ff8b8b;box-shadow:0 2px 10px rgba(0,0,0,.3);z-index:1}
.dshGlossUndo_tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%) translateY(2px);white-space:nowrap;font-size:12px;line-height:18px;padding:3px 9px;border-radius:6px;background:var(--dsw-alias-bg-elevated,#2b2f36);color:var(--dsw-alias-label-primary,#e6e8ec);box-shadow:0 2px 10px rgba(0,0,0,.3);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .14s ease,transform .14s ease,visibility 0s linear .14s;z-index:2}
.dshGlossUndo_wrap:hover .dshGlossUndo_tip{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0);transition:opacity .14s ease,transform .14s ease,visibility 0s}
.dshGlossProgress_host{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:1099;display:flex;align-items:center;gap:10px;height:var(--dsh-windows-titlebar-height,40px);padding:0 4px;pointer-events:none;max-width:min(520px,50vw)}
.dshGlossProgress_host[data-show="0"]{display:none}
.dshGlossProgress_track{position:relative;width:min(320px,38vw);height:4px;border-radius:999px;background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.14));overflow:hidden}
.dshGlossProgress_bar{position:absolute;inset:0 auto 0 0;width:0;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4d6bfe);overflow:hidden;transition:width .3s cubic-bezier(.42,0,.28,1)}
.dshGlossProgress_bar[data-shine="1"]::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.62) 50%,transparent 100%);transform:translateX(-100%);animation:dshGlossProgressShine 1.5s ease-in-out infinite}
@keyframes dshGlossProgressShine{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.dshGlossProgress_track[data-indeterminate="1"] .dshGlossProgress_bar{width:36%;animation:dshGlossProgressSlide 1.3s ease-in-out infinite}
@keyframes dshGlossProgressSlide{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
.dshGlossProgress_count{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#9aa3b2);font-variant-numeric:tabular-nums}
.dshGlossWeb_row{position:relative;display:flex;align-items:center;flex:none}
.dshGlossWeb_btn{appearance:none;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-interactive-bg,rgba(255,255,255,.14));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3b2);font-size:12px;line-height:1;cursor:pointer;flex:none;transition:background-color .16s ease,border-color .16s ease,color .16s ease,opacity .16s ease}
.dshGlossWeb_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#cdd3dd)}
.dshGlossWeb_btn[data-on="1"]{color:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshGlossWeb_btn:disabled{cursor:default;opacity:.6}
.dshGlossWeb_btn[data-unavailable="1"]{cursor:not-allowed;opacity:.45}
.dshGlossWeb_btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}
.dshGlossWeb_globe{width:14px;height:14px;flex:none}
.dshGlossWeb_slash{stroke:currentColor;stroke-width:1.3;stroke-linecap:round}
.dshGlossWeb_text{font-size:12px;white-space:nowrap}
.dshGlossWeb_track{position:relative;width:22px;height:13px;border-radius:999px;background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.16));flex:none;transition:background-color .18s ease}
.dshGlossWeb_btn[data-on="1"] .dshGlossWeb_track{background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshGlossWeb_knob{position:absolute;top:2px;left:2px;width:9px;height:9px;border-radius:999px;background:#fff;transition:transform .2s cubic-bezier(.4,0,.2,1)}
.dshGlossWeb_btn[data-on="1"] .dshGlossWeb_knob{transform:translateX(9px)}
.dshGlossWeb_toast{position:absolute;bottom:calc(100% + 8px);left:0;white-space:nowrap;font-size:12px;line-height:18px;padding:3px 8px;border-radius:6px;background:var(--dsw-alias-bg-elevated,#2b2f36);color:#ff8b8b;box-shadow:0 2px 10px rgba(0,0,0,.3);z-index:2}
.dshGlossStatus_root{position:fixed;left:0;right:0;top:var(--dsh-windows-titlebar-height,40px);height:2px;z-index:1099;pointer-events:none;background-color:transparent;opacity:0;transform:scaleY(.35);transform-origin:top center;transition:opacity .22s ease,transform .24s cubic-bezier(.4,0,.2,1),background-color .3s ease}
.dshGlossStatus_root[data-visible="1"]{opacity:1;transform:scaleY(1)}
.dshGlossStatus_root[data-state="running"]{background-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshGlossStatus_root[data-state="done"]{background-color:#30c463}
.dshGlossStatus_root[data-state="cancelled"]{background-color:#e5484d}
@media (prefers-reduced-motion:reduce){.dshGlossRefresh_icon,.dshGlossProgress_bar,.dshGlossWeb_btn,.dshGlossWeb_track,.dshGlossWeb_knob,.dshGlossStatus_root{transition:none}.dshGlossUndo_cell,.dshGlossUndo_cell .dshGlossUndo_pop{animation:none}.dshGlossUndo_cell[data-open="1"] .dshGlossUndo_pop{opacity:1;transform:none}.dshGlossProgress_track[data-indeterminate="1"] .dshGlossProgress_bar{animation:none;width:100%}.dshGlossProgress_bar[data-shine="1"]::after{animation:none;display:none}.dshEnh_Ring circle{animation:none;stroke-dashoffset:0}}
`;

    const ZH = {
      'refresh.label': '一键刷新',
      'refresh.failed': '刷新失败',
      'undo.label': '撤回',
      'undo.failed': '撤回失败',
      'undo.busy': '撤回中…',
      'progress.label': '任务进度',
      'web.label': '联网',
      'web.on': '联网已开启，点击关闭',
      'web.off': '联网已关闭，点击开启',
      'web.failed': '设置失败',
      'web.unavailable': '联网开关暂不可用（宿主未响应）'
    };
    const EN = {
      'refresh.label': 'Refresh',
      'refresh.failed': 'Refresh failed',
      'undo.label': 'Undo',
      'undo.failed': 'Undo failed',
      'undo.busy': 'Undoing…',
      'progress.label': 'Task progress',
      'web.label': 'Web',
      'web.on': 'Web access on — click to turn off',
      'web.off': 'Web access off — click to turn on',
      'web.failed': 'Update failed',
      'web.unavailable': 'Web toggle unavailable (host not responding)'
    };

    function log(error) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn('[dsh-gloss]', error);
    }

    /** 作用域化样式：单一 data 标记，卸载即移除。 */
    function installStyles() {
      if (document.querySelector('style[data-dsh-gloss-css]') !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.dshGlossCss = '';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /**
     * 软刷新：只重载渲染层页面；Harness Host 进程与运行中的任务不在页面里，因此不被终止。
     * @param onFail - reload 未发生（被拦截）时的回调。
     */
    function softRefresh(onFail) {
      let fired = false;
      const watchdog = window.setTimeout(() => {
        if (fired) return;
        fired = true;
        onFail();
      }, RELOAD_WATCHDOG_MS);
      try {
        window.location.reload();
      } catch (error) {
        window.clearTimeout(watchdog);
        log(error);
        onFail();
      }
    }

    /** 刷新图标（无依赖，标题栏与降级座位共用）。 */
    function refreshIcon(className, size) {
      return h(
        'svg',
        {
          className,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': 'true',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        },
        h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.72' }),
        h('path', { d: 'M13.4 2.4v3.2h-3.2' })
      );
    }

    const TITLEBAR_WAIT_MS = 15000;

    /** 标题栏挂载状态的小型 store：主按钮与降级座位共用同一个真相源。 */
    function createTitlebarState() {
      let mounted = false;
      const listeners = new Set();
      return {
        read: () => mounted,
        write: (next) => {
          if (mounted === next) return;
          mounted = next;
          for (const listener of listeners) {
            try {
              listener();
            } catch (error) {
              log(error);
            }
          }
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      };
    }

    /** 订阅标题栏挂载状态（降级座位据此隐藏自身）。 */
    function useTitlebarMounted(titlebarState) {
      const [mounted, setMounted] = useState(() => titlebarState.read());
      useEffect(() => titlebarState.subscribe(() => setMounted(titlebarState.read())), [titlebarState]);
      return mounted;
    }

    /**
     * P1 生命周期：尽力在标题栏出现后挂载；桌面 preload 创建标题栏的时机可能晚于插件物化
     * （冷启动），因此用有界 MutationObserver 等待，而不是永久降级。
     * @returns 带 dispose() 的控制器，卸载时移除节点、观察器与定时器。
     */
    function createTitlebarMount(doc, t, titlebarState) {
      let dispose = null;
      let timer = null;
      let watcher = null;

      const stopWaiting = () => {
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        if (watcher !== null) {
          watcher.disconnect();
          watcher = null;
        }
      };
      const detach = () => {
        stopWaiting();
        if (dispose !== null) {
          const current = dispose;
          dispose = null;
          try {
            current();
          } catch (error) {
            log(error);
          }
        }
        titlebarState.write(false);
      };
      const attach = () => {
        if (dispose !== null) return true;
        let next = null;
        try {
          next = mountTitlebarRefresh(doc, t);
        } catch (error) {
          log(error);
        }
        if (next === null) return false;
        dispose = next;
        titlebarState.write(true);
        stopWaiting();
        return true;
      };

      if (!attach()) {
        if (doc.documentElement !== null && typeof MutationObserver === 'function') {
          watcher = new MutationObserver(() => {
            if (attach()) stopWaiting();
          });
          watcher.observe(doc.documentElement, { childList: true, subtree: true });
        }
        timer = window.setTimeout(stopWaiting, TITLEBAR_WAIT_MS);
      }

      return { dispose: detach };
    }

    /**
     * P1 主挂载：在桌面标题栏「应用 / 编辑」菜单右侧放一个仅图标按钮。
     * 只读取宿主元素的 boundingRect，不写入、不替换宿主节点。
     * @returns disposer；标题栏不存在时返回 null（调用方走降级座位）。
     */
    function mountTitlebarRefresh(doc, t) {
      const host = doc.querySelector('div[data-windows-menu]');
      if (host === null || typeof host.getBoundingClientRect !== 'function') return null;

      const root = doc.createElement('div');
      root.className = 'dshGlossRefresh_host';
      root.dataset.dshGlossRefresh = '';
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'dshGlossRefresh_btn';
      button.dataset.dshGlossRefreshBtn = '';
      button.dataset.state = REFRESH.IDLE;
      button.setAttribute('aria-label', t('refresh.label'));
      button.innerHTML =
        '<svg class="dshGlossRefresh_icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.72"/><path d="M13.4 2.4v3.2h-3.2"/></svg>';
      const tip = doc.createElement('span');
      tip.className = 'dshGlossRefresh_tip';
      tip.dataset.dshGlossRefreshTip = '';
      root.append(button, tip);

      let state = REFRESH.IDLE;
      let hovered = false;
      let failTimer = null;

      const render = () => {
        button.dataset.state = state;
        button.disabled = state === REFRESH.REFRESHING;
        tip.textContent = state === REFRESH.FAILED ? t('refresh.failed') : t('refresh.label');
        tip.dataset.tone = state === REFRESH.FAILED ? 'error' : 'info';
        tip.dataset.show = hovered || state === REFRESH.FAILED ? '1' : '0';
      };
      const place = () => {
        const node = doc.querySelector('div[data-windows-menu]');
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        root.style.left = `${Math.round(rect.right + 6)}px`;
        root.style.top = `${Math.round(rect.top + (rect.height - 28) / 2)}px`;
      };
      const fail = () => {
        state = REFRESH.FAILED;
        render();
        if (failTimer !== null) window.clearTimeout(failTimer);
        failTimer = window.setTimeout(() => {
          failTimer = null;
          if (state !== REFRESH.FAILED) return;
          state = REFRESH.IDLE;
          render();
        }, 2600);
      };
      const onClick = () => {
        if (state === REFRESH.REFRESHING) return; // 刷新中禁止重复点击
        state = REFRESH.REFRESHING;
        hovered = false;
        render();
        window.setTimeout(() => softRefresh(fail), RELOAD_DELAY_MS);
      };
      const onEnter = () => {
        hovered = true;
        render();
      };
      const onLeave = () => {
        hovered = false;
        render();
      };

      button.addEventListener('click', onClick);
      root.addEventListener('pointerenter', onEnter);
      root.addEventListener('pointerleave', onLeave);
      doc.body.appendChild(root);
      render();
      place();

      const onResize = () => place();
      window.addEventListener('resize', onResize);
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
      if (observer !== null) {
        observer.observe(doc.documentElement);
        observer.observe(host);
      }

      return () => {
        if (failTimer !== null) window.clearTimeout(failTimer);
        window.removeEventListener('resize', onResize);
        if (observer !== null) observer.disconnect();
        button.removeEventListener('click', onClick);
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointerleave', onLeave);
        root.remove();
      };
    }

    /** P1 降级座位：没有桌面标题栏时，把同一个按钮放到会话标题栏。 */
    function RefreshFallback(props) {
      const { t, titlebar } = props;
      const titlebarMounted = useTitlebarMounted(titlebar);
      const [state, setState] = useState(REFRESH.IDLE);
      const failed = state === REFRESH.FAILED;
      useEffect(() => {
        if (!failed) return;
        const timer = window.setTimeout(() => setState(REFRESH.IDLE), 2600);
        return () => window.clearTimeout(timer);
      }, [failed]);
      if (titlebarMounted) return null;
      const onClick = () => {
        if (state === REFRESH.REFRESHING) return;
        setState(REFRESH.REFRESHING);
        window.setTimeout(() => softRefresh(() => setState(REFRESH.FAILED)), RELOAD_DELAY_MS);
      };
      return h(
        'span',
        { className: 'dshGlossRefresh_host', 'data-dsh-gloss-refresh': '', style: { position: 'relative', zIndex: 1 } },
        h(
          'button',
          {
            type: 'button',
            className: 'dshGlossRefresh_btn',
            'data-state': state,
            disabled: state === REFRESH.REFRESHING,
            'aria-label': t('refresh.label'),
            title: failed ? t('refresh.failed') : t('refresh.label'),
            onClick
          },
          refreshIcon('dshGlossRefresh_icon', 16)
        ),
        failed ? h('span', { className: 'dshGlossRefresh_tip', 'data-show': '1', 'data-tone': 'error', style: { left: 'auto', right: 0, top: '100%', transform: 'translateY(4px)' } }, t('refresh.failed')) : null
      );
    }

    /** T2：从锚点向上找到「包含可编辑区」的组件容器，作为按键监听范围。 */
    function dshEnhComposerScope(node) {
      let element = node === null || node === undefined ? null : node.parentElement;
      for (let depth = 0; depth < 10 && element !== null; depth += 1) {
        if (element.querySelector('[contenteditable="true"], textarea') !== null) return element;
        element = element.parentElement;
      }
      return null;
    }

﻿    /**
     * T8 会话行状态闪烁：用户不在该会话界面时，任务跑完（宿主圆点转绿）或
     * 需要用户操作（宿主圆点转橙）时，让**宿主原有的那个圆点**闪两下。
     *
     * 不再画额外的线条：只在状态变成 done / attention 的那一刻，用 Web Animations API
     * 在圆点上跑一段有限次数的透明度动画（900ms 结束自动清理，不写宿主类名/样式）。
     *
     * 状态来源：root 作用域的 `sessionStatus` hook → `{ running, pendingInteraction, completionUnread }`；
     * 落点：`sidebar.workspaces.session.row.action`（每行都渲染）只当锚点。
     */
    function SessionRing(props) {
      const { sessionId, useSessionStatus } = props;
      const snapshot =
        typeof useSessionStatus === 'function'
          ? useSessionStatus((value) => (value !== undefined && value !== null && typeof value.get === 'function' ? value.get(sessionId) : undefined))
          : undefined;
      const pending = snapshot === undefined || snapshot === null ? undefined : snapshot.pendingInteraction;
      const kind = pending !== undefined && pending !== null ? 'attention' : snapshot !== undefined && snapshot !== null && snapshot.completionUnread === true ? 'done' : '';
      const anchorRef = useRef(null);

      useEffect(() => {
        if (kind === '') return undefined;
        const anchor = anchorRef.current;
        if (anchor === null) return undefined;

        const findRow = () => {
          let row = anchor.parentElement;
          for (let depth = 0; depth < 8 && row !== null; depth += 1) {
            const rect = row.getBoundingClientRect();
            if (rect.width > 120 && rect.height >= 16 && rect.height <= 64) return row;
            row = row.parentElement;
          }
          return null;
        };

        // 宿主那个状态圆点 = leading 单元格里尺寸最小且近似正方形的元素。
        const findDot = (row) => {
          const cell = row.firstElementChild;
          if (cell === null || cell === undefined) return null;
          const list = [cell];
          const nested = cell.querySelectorAll('*');
          for (let index = 0; index < nested.length; index += 1) list.push(nested[index]);
          let best = null;
          for (let index = 0; index < list.length; index += 1) {
            const element = list[index];
            if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') continue;
            const rect = element.getBoundingClientRect();
            if (rect.width < 6 || rect.width > 26 || rect.height < 6 || rect.height > 26) continue;
            if (Math.abs(rect.width - rect.height) > 6) continue;
            if (best === null || rect.width < best.width) best = { element, width: rect.width };
          }
          return best === null ? null : best.element;
        };

        let animation = null;
        const frame = window.requestAnimationFrame(() => {
          const row = findRow();
          if (row === null) return;
          // 用户正看着这个会话，不需要再提醒。
          if (row.getAttribute('aria-selected') === 'true') return;
          if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          const dot = findDot(row);
          if (dot === null || typeof dot.animate !== 'function') return;
          animation = dot.animate(
            [
              { opacity: 1 },
              { opacity: 0.15 },
              { opacity: 1 },
              { opacity: 0.15 },
              { opacity: 1 }
            ],
            { duration: 900, easing: 'ease-in-out' }
          );
        });

        return () => {
          window.cancelAnimationFrame(frame);
          if (animation !== null) {
            try {
              animation.cancel();
            } catch (error) {
              log(error);
            }
          }
        };
      }, [kind]);

      return h('span', {
        ref: anchorRef,
        className: 'dshEnh_SessionRingAnchor',
        'data-dsh-gloss-ring-anchor': '',
        'aria-hidden': 'true',
        style: { display: 'none' }
      });
    }

    /**
     * P2 发送后撤回 + T2 Alt+Enter 换行。
     * 只读 `useInput` / `useSession` 快照；发送、停止仍由宿主流程执行。
     */
    function UndoButton(props) {
      const { sessionId, sessions, useInput, useSession, inputActions, status, t } = props;
      const input = typeof useInput === 'function' ? useInput((value) => value) : undefined;
      const running = typeof useSession === 'function' ? useSession((session) => session?.running) === true : false;
      const [state, setState] = useState(UNDO.IDLE);
      const [mounted, setMounted] = useState(false);
      const [toast, setToast] = useState(null);
      const armedRef = useRef(null);
      const previousRef = useRef(undefined);
      const stateRef = useRef(UNDO.IDLE);
      const anchorRef = useRef(null);
      const [buffering, setBuffering] = useState(false);
      const bufferRef = useRef(null);
      const bufferTimerRef = useRef(null);
      const inputRef = useRef(undefined);
      const runningRef = useRef(false);
      inputRef.current = input;
      runningRef.current = running;
      stateRef.current = state;

      // 发送检测：草稿非空 → 空，即为一次成功发出的提交；记住原文。
      useEffect(() => {
        const previous = previousRef.current;
        previousRef.current = input;
        if (previous === undefined || input === undefined) return;
        const wasEmpty = (previous.draft ?? '').trim() === '';
        const isEmpty = (input.draft ?? '').trim() === '';
        if (stateRef.current === UNDO.ARMED) {
          if (isEmpty) return;
          // 撤回键显示期间用户（或失败自动恢复）重新填充了输入框 → 收起，绝不覆盖新内容。
          armedRef.current = null;
          setState(UNDO.IDLE);
          return;
        }
        if (stateRef.current !== UNDO.IDLE || wasEmpty || !isEmpty) return;
        armedRef.current = {
          text: previous.draft ?? '',
          attachmentIds: Array.isArray(previous.attachmentIds) ? [...previous.attachmentIds] : []
        };
        setState(UNDO.ARMED);
      }, [input]);

      // 任务结束 → 无运行中任务可撤回，收起。
      useEffect(() => {
        if (stateRef.current !== UNDO.ARMED || running) return;
        const timer = window.setTimeout(() => {
          if (stateRef.current !== UNDO.ARMED) return;
          armedRef.current = null;
          setState(UNDO.IDLE);
        }, 1200);
        return () => window.clearTimeout(timer);
      }, [running]);

      // 显示条件：缓冲期（待提交，可撤回）或任务进行中（已提交，可撤回）。
      const open = buffering || (running && (state === UNDO.ARMED || state === UNDO.CANCELLING));

      // 展开/收起：只控制挂载；入场/退场动画交给 data-open 上的 CSS 关键帧，
      // 这样元素插入的第一帧就从 0 播到终态，不再出现「瞬间出现」。
      useEffect(() => {
        if (open) {
          setMounted(true);
          return;
        }
        const timer = window.setTimeout(() => setMounted(false), UNDO_COLLAPSE_MS);
        return () => window.clearTimeout(timer);
      }, [open]);

      useEffect(() => {
        if (toast === null) return;
        const timer = window.setTimeout(() => setToast(null), 2600);
        return () => window.clearTimeout(timer);
      }, [toast]);

      // T3：发送缓冲。拦截「发送手势」→ 3s 环形倒计时（可撤回窗口）→ 到时才真正提交。
      // 缓冲期内消息尚未提交，因此撤回只需取消这次待提交，不必调用停止运行中任务。
      const finishBuffer = useCallback(
        (record) => {
          if (bufferRef.current !== record) return;
          bufferRef.current = null;
          if (bufferTimerRef.current !== null) {
            window.clearTimeout(bufferTimerRef.current);
            bufferTimerRef.current = null;
          }
          setBuffering(false);
          const draft = inputRef.current?.draft ?? '';
          if (draft !== record.text) {
            log('dsh-gloss: buffer dropped (draft changed)');
            return;
          }
          try {
            inputActions.submit('queue', 'dsh-enh-buffer');
          } catch (error) {
            log(error);
            setToast(t('undo.failed'));
          }
        },
        [inputActions, t]
      );

      const startBuffer = useCallback(() => {
        if (bufferRef.current !== null) return;
        const snapshot = inputRef.current;
        const text = snapshot?.draft ?? '';
        if (text.trim() === '') return;
        const record = {
          text,
          attachmentIds: Array.isArray(snapshot?.attachmentIds) ? [...snapshot.attachmentIds] : []
        };
        bufferRef.current = record;
        setBuffering(true);
        bufferTimerRef.current = window.setTimeout(() => finishBuffer(record), DSH_ENH_BUFFER_MS);
      }, [finishBuffer]);

      /** 缓冲期内再次点发送键 = 立即发送（以当前草稿为准，不用缓冲开始时的快照）。 */
      const flushBuffer = useCallback(() => {
        const record = bufferRef.current;
        if (record === null) return;
        const next = { ...record, text: inputRef.current?.draft ?? record.text };
        bufferRef.current = next;
        finishBuffer(next);
      }, [finishBuffer]);

      const revokeBuffer = useCallback(() => {
        if (bufferRef.current === null) return;
        bufferRef.current = null;
        if (bufferTimerRef.current !== null) {
          window.clearTimeout(bufferTimerRef.current);
          bufferTimerRef.current = null;
        }
        setBuffering(false);
        // 缓冲期从未提交：草稿/附件/光标保持原样，无需恢复，也绝不调用停止。
        // T5：这属于「撤回」事件 → 状态条置红。
        try {
          status?.pulseCancel?.();
        } catch (error) {
          log(error);
        }
      }, [status]);

      useEffect(
        () => () => {
          if (bufferTimerRef.current !== null) window.clearTimeout(bufferTimerRef.current);
          bufferTimerRef.current = null;
          bufferRef.current = null;
        },
        []
      );

      // T2：Alt+Enter 换行；T3：Enter 走 3s 发送缓冲。
      // 宿主 Lexical 绑定对 Alt+Enter 主动放行（不 preventDefault），因此用官方 inputActions 插入可撤销换行，不改宿主键位。
      useEffect(() => {
        const anchor = anchorRef.current;
        if (anchor === null || inputActions === undefined) return undefined;
        const scope = dshEnhComposerScope(anchor);
        if (scope === null) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Enter') return;
          if (event.isComposing === true || event.keyCode === 229) return;
          const target = event.target;
          const editor = typeof target?.closest === 'function' ? target.closest('[contenteditable="true"], textarea') : null;
          if (editor === null || !scope.contains(editor)) return;
          if (event.altKey === true) {
            if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) return;
            event.preventDefault();
            event.stopPropagation();
            try {
              const span = inputActions.captureInsertion();
              if (inputActions.insertText('\n', span) === false) {
                // 草稿版本已变化（例如刚提交）：放弃这次换行，绝不覆盖新内容。
                log('dsh-gloss: alt+enter skipped (stale draft)');
              }
            } catch (error) {
              log(error);
            }
            return;
          }
          if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) return;
          if ((inputRef.current?.draft ?? '').trim() === '') return; // 空草稿/纯附件交给宿主
          event.preventDefault();
          event.stopPropagation();
          startBuffer();
        };
        scope.addEventListener('keydown', onKeyDown, true);
        return () => scope.removeEventListener('keydown', onKeyDown, true);
      }, [mounted, inputActions, startBuffer]);

      // T3：点发送键同样走缓冲（运行态的这颗键是「停止」，不拦）；缓冲期内再点一次 = 立即发送。
      useEffect(() => {
        const anchor = anchorRef.current;
        if (anchor === null || inputActions === undefined) return undefined;
        const scope = dshEnhComposerScope(anchor);
        if (scope === null) return undefined;
        const onClick = (event) => {
          const target = event.target;
          const button = typeof target?.closest === 'function' ? target.closest('button[class*="primary"]') : null;
          if (button === null || !scope.contains(button)) return;
          if (bufferRef.current !== null) {
            // 第二次点发送：跳过剩余倒计时立刻发出。
            event.preventDefault();
            event.stopPropagation();
            flushBuffer();
            return;
          }
          if (runningRef.current || (inputRef.current?.draft ?? '').trim() === '') return;
          event.preventDefault();
          event.stopPropagation();
          startBuffer();
        };
        scope.addEventListener('click', onClick, true);
        return () => scope.removeEventListener('click', onClick, true);
      }, [mounted, inputActions, startBuffer, flushBuffer]);

      /** 恢复原始提示词、附件、草稿持久化；任一步失败都视为撤回失败。 */
      const restore = useCallback(
        (armed) => {
          if (inputActions === undefined) throw new Error('inputActions unavailable');
          inputActions.setDraft(armed.text);
          if (armed.attachmentIds.length > 0) {
            try {
              inputActions.addAttachments(armed.attachmentIds);
            } catch (error) {
              log(error); // 附件可能已被回收：文字仍恢复，附件降级
            }
          }
          inputActions.persistDraft();
        },
        [inputActions]
      );

      /** 官方停止入口：sessions.scope(id).get('conversation').cancel()。 */
      const cancelTurn = useCallback(async () => {
        const scoped = sessions?.scope?.(sessionId);
        const conversation = scoped?.get?.('conversation');
        if (typeof conversation?.cancel !== 'function') throw new Error('conversation.cancel unavailable');
        await conversation.cancel();
      }, [sessions, sessionId]);

      const onClick = async () => {
        if (bufferRef.current !== null) {
          // T3：缓冲期内撤回 = 取消这次待提交，草稿原样保留，不调用停止。
          revokeBuffer();
          return;
        }
        if (stateRef.current !== UNDO.ARMED) return; // 防重复点击
        const armed = armedRef.current;
        if (armed === null) return;
        if ((input?.draft ?? '').trim() !== '') {
          setToast(t('undo.failed'));
          return;
        }
        setState(UNDO.CANCELLING);
        try {
          await cancelTurn();
          restore(armed);
          armedRef.current = null;
          setState(UNDO.RESTORED);
          // T5：停止进行中的任务同样属于「撤回/中断」→ 状态条置红。
          try {
            status?.pulseCancel?.();
          } catch (error) {
            log(error);
          }
          window.setTimeout(() => {
            if (stateRef.current === UNDO.RESTORED) setState(UNDO.IDLE);
          }, 320);
        } catch (error) {
          log(error);
          setToast(t('undo.failed')); // 撤回键上方 toast
          setState(UNDO.ARMED); // 回滚 UI，按钮恢复可用
        }
      };

      if (!mounted) {
        // 常驻的零占位锚点：T2 的按键监听需要一件稳定的 DOM 参照，收起时也不可交互。
        return h('span', {
          ref: anchorRef,
          className: 'dshEnh_UndoAnchor',
          'data-dsh-enh-anchor': '',
          'data-dsh-gloss-undo': '',
          'data-open': '0',
          'aria-hidden': 'true',
          style: { display: 'none' }
        });
      }
      const busy = state === UNDO.CANCELLING;
      return h(
        'div',
        { ref: anchorRef, className: 'dshGlossUndo_cell', 'data-dsh-gloss-undo': '', 'data-open': open ? '1' : '0' },
        h(
          'div',
          { className: 'dshGlossUndo_wrap' },
          toast !== null ? h('span', { className: 'dshGlossUndo_toast', role: 'status' }, toast) : null,
          toast === null
            ? h('span', { className: 'dshGlossUndo_tip', role: 'tooltip' }, busy ? t('undo.busy') : t('undo.label'))
            : null,
          h(
            'div',
            { className: 'dshGlossUndo_pop' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshGlossUndo_btn',
                'data-dsh-gloss-undo-btn': '',
                disabled: busy,
                'aria-label': busy ? t('undo.busy') : t('undo.label'),
                onClick,
                onMouseDown: (event) => event.preventDefault()
              },
              h(
                'svg',
                {
                  viewBox: '0 0 16 16',
                  width: 18,
                  height: 18,
                  'aria-hidden': 'true',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.7,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                },
                // 公路掉头标识：左竖线上行 → 180° 半圆 → 右竖线下行 → 朝下的箭头
                h('path', { d: 'M4.7 12V6.9a2.7 2.7 0 0 1 5.4 0V10.2' }),
                h('path', { d: 'M8 7.9l2.1 2.3 2.1-2.3' })
              ),
              // T3：环形倒计时（3s 走完即提交），纯 CSS 关键帧驱动 stroke-dashoffset。
              buffering
                ? h(
                    'svg',
                    { className: 'dshEnh_Ring', viewBox: '0 0 34 34', 'aria-hidden': 'true' },
                    h('circle', { cx: 17, cy: 17, r: 15.75, strokeDasharray: DSH_ENH_RING_LENGTH, strokeDashoffset: 0 })
                  )
                : null
            )
          )
        )
      );
    }

    /**
     * T5 状态条 store：运行蓝 / 完成绿 / 撤回（中断）红，输入时隐藏。
     *
     * 事件来源：`running` 由无头桥组件订阅 session store 推送；「撤回」由本插件
     * 自己的两个入口（P2 停止任务、T3 缓冲撤回）在本地判定——宿主没有暴露
     * 「失败」字段（`sessionStatus` 快照只有 running/pendingInteraction/completionUnread），
     * 因此不猜测失败，只用确定事件。
     */
    function createStatusState() {
      let status = 'idle'; // idle | running | done | cancelled
      let typing = false;
      let timer = null;
      const listeners = new Set();

      const emit = () => {
        const value = { status, typing };
        for (const listener of listeners) {
          try {
            listener(value);
          } catch (error) {
            log(error);
          }
        }
      };

      const hold = (next) => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        status = next;
        emit();
        timer = setTimeout(() => {
          timer = null;
          status = 'idle';
          emit();
        }, STATUS_HOLD_MS);
      };

      return {
        read: () => ({ status, typing }),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        setRunning: (running) => {
          if (running) {
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
            if (status === 'running') return;
            status = 'running';
            emit();
            return;
          }
          if (status !== 'running') return;
          hold('done');
        },
        /** 本插件确定的撤回/中断 → 红。 */
        pulseCancel: () => hold('cancelled'),
        setTyping: (next) => {
          if (typing === next) return;
          typing = next;
          emit();
        },
        dispose: () => {
          if (timer !== null) clearTimeout(timer);
          timer = null;
          listeners.clear();
        }
      };
    }

    /** T5 无头桥：读取运行态与草稿，写进 store（组件本身不渲染任何节点）。 */
    function StatusBridge(props) {
      const { status, useSession, useInput } = props;
      const running = typeof useSession === 'function' ? useSession((session) => session?.running === true) === true : false;
      const draft = typeof useInput === 'function' ? useInput((value) => value?.draft ?? '') : '';
      useEffect(() => {
        status.setRunning(running);
      }, [status, running]);
      // 输入时隐藏，停止输入 1.2s 后恢复（草稿非空 ≠ 正在输入：
      // 撤回后草稿会留在输入框里，此时应当继续显示状态）。
      useEffect(() => {
        const text = String(draft ?? '');
        if (text === '') {
          status.setTyping(false);
          return undefined;
        }
        status.setTyping(true);
        const timer = setTimeout(() => status.setTyping(false), TYPING_IDLE_MS);
        return () => clearTimeout(timer);
      }, [status, draft]);
      useEffect(() => () => status.setTyping(false), [status]);
      return null;
    }

    /** T5 图层：标题栏正下方、贯穿左右的一条 2px 状态条（不接收指针事件）。 */
    function createStatusMount(doc, status) {
      let disposed = false;
      const root = doc.createElement('div');
      root.className = 'dshGlossStatus_root';
      root.dataset.state = 'idle';
      root.dataset.visible = '0';
      root.setAttribute('aria-hidden', 'true');

      const render = (value) => {
        if (disposed) return;
        const { status: current, typing } = value;
        root.dataset.state = current;
        root.dataset.visible = current !== 'idle' && !typing ? '1' : '0';
      };

      render(status.read());
      const unsubscribe = status.subscribe(render);
      doc.body.appendChild(root);

      return () => {
        disposed = true;
        unsubscribe();
        root.remove();
      };
    }

    /** P3 进度状态：无头桥组件写入，标题栏图层读取。 */    function createProgressState() {
      let value = { running: false, done: 0, total: 0, startedAt: 0 };
      let startedAt = 0;
      const listeners = new Set();
      return {
        read: () => value,
        write: (next) => {
          if (next.running === true && value.running !== true) startedAt = Date.now();
          if (next.running !== true) startedAt = 0;
          const merged = { running: next.running === true, done: next.done, total: next.total, startedAt };
          if (merged.running === value.running && merged.done === value.done && merged.total === value.total && merged.startedAt === value.startedAt) return;
          value = merged;
          for (const listener of listeners) {
            try {
              listener(value);
            } catch (error) {
              log(error);
            }
          }
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      };
    }

    /**
     * P3 无头桥：挂在官方座位里读取 published props，把状态写进 store。
     *
     * 绘制交给标题栏图层而不是座位本身：座位祖先有 backdrop-filter/transform 时
     * `position:fixed` 会被限制在那个祖先里，落不到顶栏中心。
     * 总数来源：本会话 `todos` projection（todo_write 维护的任务清单）。
     * 清单为空时不伪造总数，退化为不确定进度。
     */
    function ProgressBridge(props) {
      const { useSession, useProjection, progress } = props;
      const running = typeof useSession === 'function' ? useSession((session) => session?.running) === true : false;
      const todos = typeof useProjection === 'function' ? useProjection('todos') : undefined;
      const total = Array.isArray(todos) ? todos.length : 0;
      const done = useMemo(
        () => (Array.isArray(todos) ? todos.filter((todo) => todo?.status === 'completed').length : 0),
        [todos]
      );
      useEffect(() => {
        progress.write({ running, done, total });
      }, [progress, running, done, total]);
      useEffect(
        () => () => progress.write({ running: false, done: 0, total: 0 }),
        [progress]
      );
      return null;
    }

    /**
     * P3 图层：顶栏中心的蓝色进度条 + 右侧“已完成/总数（· 剩余估算）”；无任务时整体隐藏。
     *
     * T7：ETA 只用「本次运行已经花掉的时间 / 已完成数 × 剩余数」推算，条件不满足
     * （没有总数、还没有任何一步完成、已完成=总数）时**不显示**，绝不编造；
     * 流光只在运行中由 CSS 动画驱动，静止态没有动画。
     */
    function createProgressMount(doc, t, progress) {
      const root = doc.createElement('div');
      root.className = 'dshGlossProgress_host';
      root.dataset.dshGlossProgress = '';
      root.dataset.show = '0';
      root.setAttribute('aria-label', t('progress.label'));

      const track = doc.createElement('div');
      track.className = 'dshGlossProgress_track';
      track.dataset.indeterminate = '0';
      const bar = doc.createElement('div');
      bar.className = 'dshGlossProgress_bar';
      bar.dataset.shine = '0';
      track.append(bar);
      const count = doc.createElement('span');
      count.className = 'dshGlossProgress_count';
      root.append(track, count);

      const formatEta = (ms) => {
        const seconds = Math.max(1, Math.round(ms / 1000));
        if (seconds < 60) return `${seconds} 秒`;
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes} 分钟`;
        return `${Math.round(minutes / 60)} 小时`;
      };

      // 只有「真在跑 + 有总数 + 至少完成一步 + 还没做完」时才给估算，其余一律返回 null。
      const etaMs = (value) => {
        if (value.running !== true) return null;
        if (!(value.total > 0) || value.done <= 0 || value.done >= value.total) return null;
        if (!(value.startedAt > 0)) return null;
        const elapsed = Date.now() - value.startedAt;
        if (!(elapsed > 0)) return null;
        const eta = (elapsed / value.done) * (value.total - value.done);
        if (!Number.isFinite(eta) || eta <= 0 || eta > 2 * 60 * 60 * 1000) return null;
        return eta;
      };

      let disposed = false;
      let timer = null;
      const stopTimer = () => {
        if (timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      };

      const render = () => {
        if (disposed) return;
        const value = progress.read();
        const determinate = value.total > 0;
        root.dataset.show = value.running ? '1' : '0';
        track.dataset.indeterminate = determinate ? '0' : '1';
        bar.dataset.shine = value.running ? '1' : '0';
        count.hidden = !determinate;
        if (determinate) {
          const eta = etaMs(value);
          count.textContent = eta === null ? `${value.done}/${value.total}` : `${value.done}/${value.total} · 约 ${formatEta(eta)}`;
          bar.style.width = `${Math.max(0, Math.min(100, Math.round((value.done / value.total) * 100)))}%`;
        } else {
          count.textContent = '';
          bar.style.width = '';
        }
        // 有估算可显示时才需要每秒刷新文案。
        const ticking = determinate && etaMs(value) !== null;
        if (ticking && timer === null) timer = window.setInterval(render, 1000);
        if (!ticking) stopTimer();
      };

      render();
      const unsubscribe = progress.subscribe(render);
      doc.body.appendChild(root);

      return () => {
        disposed = true;
        stopTimer();
        unsubscribe();
        root.remove();
      };
    }

    /**
     * 请求用同一个相对路径：桌面端页面自身是 `dsh-app://app/`，该协议会把
     * 同源请求转发到本机 Harness 服务，因此不需要（也不应该）猜 HTTP 端口。
     */
    function webEndpoint() {
      if (typeof fetch !== 'function') return '';
      if (typeof document === 'undefined' || document === null) return '';
      const base = typeof document.baseURI === 'string' ? document.baseURI : '';
      if (base === '') return '';
      return WEB_ROUTE;
    }

    /**
     * T4 联网开关的共享状态。
     * 唯一事实来源在 Host 半边（`/dsh-gloss/web`）：GET 读、POST 写。
     * 这里做三件事：乐观更新（点击立即反馈）、失败回滚、多实例同步。
     */
    function createWebAccessStore() {
      const listeners = new Set();
      let enabled = true;
      let busy = false;
      let lastError = '';
      let available = true;
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch (error) {
            log(error);
          }
        }
      };
      /**
       * 读 Host 状态。Host 插件比 webServer 服务先 apply 时路由会稍晚就绪，
       * 因此首轮失败按 400/800/1200/1600ms 退避重试，全部失败才判定不可用，
       * 避免把「刚启动还没挂上路由」误显示成开关坏了。
       */
      const probe = async (attempt) => {
        const endpoint = webEndpoint();
        if (endpoint === '') return;
        try {
          const response = await fetch(endpoint, { method: 'GET', cache: 'no-store' });
          if (!response.ok) throw new Error(`web toggle http ${response.status}`);
          const data = await response.json();
          let changed = available !== true || lastError !== '';
          available = true;
          lastError = '';
          if (typeof data?.enabled === 'boolean' && data.enabled !== enabled) {
            enabled = data.enabled;
            changed = true;
          }
          if (changed) emit();
        } catch (error) {
          log(error);
          if (attempt < 4) {
            window.setTimeout(() => {
              void probe(attempt + 1);
            }, 400 * (attempt + 1));
            return;
          }
          available = false;
          lastError = String(error && error.message ? error.message : error).slice(0, 90);
          emit();
        }
      };
      return {
        read: () => enabled,
        isBusy: () => busy,
        isAvailable: () => available,
        readError: () => lastError,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        async load() {
          await probe(0);
        },
        async set(next) {
          const previous = enabled;
          enabled = next;
          busy = true;
          emit();
          const endpoint = webEndpoint();
          if (endpoint === '') {
            lastError = 'no-endpoint';
            busy = false;
            emit();
            return false;
          }
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled: next })
            });
            if (!response.ok) throw new Error(`web toggle http ${response.status}`);
            const data = await response.json();
            if (typeof data?.enabled === 'boolean') enabled = data.enabled;
            available = true;
            lastError = '';
            busy = false;
            emit();
            return true;
          } catch (error) {
            log(error);
            const message = String(error && error.message ? error.message : error).slice(0, 90);
            // 404 = 宿主路由没挂上（插件 Host 半边没跑起来），这时把开关标记为不可用，
            // 而不是让用户反复点击却只看到「设置失败」。
            if (message.includes('404')) available = false;
            lastError = message;
            enabled = previous;
            busy = false;
            emit();
            return false;
          }
        }
      };
    }

    /** T4：输入区工具行最左侧（权限控件右侧）的联网开关。 */
    function WebToggle(props) {
      const { t, webAccess } = props;
      const [enabled, setEnabled] = useState(() => webAccess.read());
      const [busy, setBusy] = useState(() => webAccess.isBusy());
      const [available, setAvailable] = useState(() => webAccess.isAvailable());
      const [failed, setFailed] = useState(false);
      const [errorText, setErrorText] = useState(() => webAccess.readError());
      const failTimer = useRef(null);

      useEffect(() => {
        // 订阅后立刻同步一次：load() 可能在组件挂载前就已完成，
        // 只靠订阅回调会漏掉那一次 emit（表现为 UI 停在默认值）。
        const sync = () => {
          setEnabled(webAccess.read());
          setBusy(webAccess.isBusy());
          setAvailable(webAccess.isAvailable());
          setErrorText(webAccess.readError());
        };
        sync();
        return webAccess.subscribe(sync);
      }, [webAccess]);

      useEffect(
        () => () => {
          if (failTimer.current !== null) window.clearTimeout(failTimer.current);
        },
        []
      );

      const onClick = useCallback(() => {
        if (busy || !available) return;
        const next = !webAccess.read();
        setEnabled(next); // 乐观更新：点击立刻反馈，失败再回滚
        setFailed(false);
        webAccess.set(next).then((ok) => {
          if (ok) return;
          setFailed(true);
          if (failTimer.current !== null) window.clearTimeout(failTimer.current);
          failTimer.current = window.setTimeout(() => setFailed(false), 2400);
        });
      }, [busy, available, webAccess]);

      return h(
        'div',
        { className: 'dshGlossWeb_row' },
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled ? 'true' : 'false',
            'aria-label': t('web.label'),
            title: available === false ? t('web.unavailable') : enabled ? t('web.on') : t('web.off'),
            className: 'dshGlossWeb_btn',
            'data-on': enabled ? '1' : '0',
            'data-unavailable': available ? '0' : '1',
            'data-dsh-gloss': 'web-toggle',
            disabled: busy,
            onClick
          },
          h(
            'svg',
            {
              className: 'dshGlossWeb_globe',
              viewBox: '0 0 16 16',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.3,
              'aria-hidden': 'true'
            },
            h('circle', { cx: 8, cy: 8, r: 6 }),
            h('path', { d: 'M2 8h12' }),
            h('path', { d: 'M8 2c1.7 1.8 2.7 3.8 2.7 6S9.7 12.2 8 14c-1.7-1.8-2.7-3.8-2.7-6S7.3 3.8 8 2z' }),
            enabled
              ? null
              : h('line', { className: 'dshGlossWeb_slash', x1: 2.6, y1: 13.4, x2: 13.4, y2: 2.6 })
          ),
          h('span', { className: 'dshGlossWeb_text' }, t('web.label')),
          h(
            'span',
            { className: 'dshGlossWeb_track', 'aria-hidden': 'true' },
            h('span', { className: 'dshGlossWeb_knob' })
          )
        ),
        failed
          ? h(
              'span',
              { className: 'dshGlossWeb_toast', role: 'status' },
              errorText === '' ? t('web.failed') : `${t('web.failed')}: ${errorText}`
            )
          : null
      );
    }

    /**
     * 插件主体的实际初始化。
     *
     * 被 `apply` 整体包在 try/catch 里：client 条目在宿主启动审计中一旦 apply
     * 抛错，整条 entry 就是 failed，`web boot: 1 entry did not activate` 会让
     * 整个 Web 端启动失败（表现为刷新页面直接闪退）。因此这里任何异常都只能
     * 降级成本插件部分功能缺失，绝不能冒到条目层。
     */
    function activate(ctx) {
      const t = ctx.locale.bind(NS);
        const titlebarState = createTitlebarState();
        const progressState = createProgressState();
        const statusState = createStatusState();
        const webAccess = createWebAccessStore();

        /**
         * 安装一个 effect。
         *
         * Cordis 的 `ctx.effect()` 只接受三种返回：一个释放函数、null/undefined，
         * 或（异步）可迭代对象——返回其他对象会抛 `TypeError: Invalid effect`，
         * 进而让整个 client 条目在启动审计里变成 failed（页面直接启动失败）。
         * 因此这里统一归一化为「函数或 undefined」，并把任何异常挡在本插件内部。
         */
        const install = (label, body) => {
          try {
            ctx.effect(() => {
              try {
                const disposer = body();
                return typeof disposer === 'function' ? disposer : undefined;
              } catch (error) {
                log(error);
                return undefined;
              }
            }, label);
          } catch (error) {
            log(error);
          }
        };

        install('dsh-gloss: locale', () => {
          ctx.locale.register(NS, { zh: ZH, en: EN });
          return () => {};
        });
        install('dsh-gloss: styles', () => installStyles());

        // P1 主：桌面标题栏按钮（缺失标题栏时由下方降级座位接管）。
        install('dsh-gloss: titlebar refresh', () => {
          const controller = createTitlebarMount(document, t, titlebarState);
          return () => controller.dispose();
        });

        // P1 降级座位。
        install('dsh-gloss: refresh fallback', () =>
          ctx.slots.inject('conversation.session.header.actions', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.actions',
                id: ID_REFRESH_FALLBACK,
                order: 80,
                locale: NS,
                inject: () => ({ t, titlebar: titlebarState })
              },
              RefreshFallback
            )
          )
        );

        // P2 主：模型选择器与发送键之间的撤回键。
        // 该座位（single，宿主当前无占用者）在模型选择器之后、提交键之前。
        // 撤回键展开时宽度增长会把模型名区域向左推，正是需求要的位移。
        install('dsh-gloss: undo button', () => {
          const unregister = ctx.slots.inject('conversation.input.activity', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.activity',
                id: ID_UNDO,
                locale: NS,
                inject: () => ({ t, sessions: ctx.sessions, status: statusState })
              },
              UndoButton
            )
          );
          return () => {
            try {
              if (typeof unregister === 'function') unregister();
            } catch (error) {
              log(error);
            }
          };
        });

        // T4：联网开关 —— 输入区工具行最左侧（权限模式控件右侧）。
        install('dsh-gloss: web access state', () => {
          webAccess.load();
          return () => {};
        });
        install('dsh-gloss: web toggle', () =>
          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: ID_WEB,
                order: 10,
                locale: NS,
                inject: () => ({ t, webAccess })
              },
              WebToggle
            )
          )
        );

        // P3 主：顶栏中心进度条。
        install('dsh-gloss: progress bar', () => {
          const mount = createProgressMount(document, t, progressState);
          const unregister = ctx.slots.inject('conversation.session.header.actions', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.actions',
                id: ID_PROGRESS,
                order: 90,
                locale: NS,
                inject: () => ({ t, progress: progressState })
              },
              ProgressBridge
            )
          );
          return () => {
            try {
              if (typeof unregister === 'function') unregister();
            } catch (error) {
              log(error);
            }
            mount();
          };
        });

        // T5 主：顶栏下方贯穿左右的状态条（无头桥写状态 + body 图层绘制）。
        install('dsh-gloss: status bar', () => {
          const mount = createStatusMount(document, statusState);
          const unregister = ctx.slots.inject('conversation.session.header.actions', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.actions',
                id: ID_STATUS,
                order: 95,
                locale: NS,
                inject: () => ({ status: statusState })
              },
              StatusBridge
            )
          );
          return () => {
            try {
              if (typeof unregister === 'function') unregister();
            } catch (error) {
              log(error);
            }
            mount();
            statusState.dispose();
          };
        });
        // T8 主：侧栏会话行状态环。锚点放在每行都渲染的 action 座位，
        // 圆环本身画在 body 图层（leading 座位在非 idle 时会被宿主的 StateDot 顶替）。
        install('dsh-gloss: session ring', () =>
          ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
            ctx.slots.register(
              {
                name: 'sidebar.workspaces.session.row.action',
                id: ID_SESSION_RING,
                order: 20,
                locale: NS,
                inject: () => ({ t })
              },
              SessionRing
            )
          )
        );
    }

    return {
      name: NS,
      inject: ['slots', 'locale', 'sessions'],
      apply(ctx) {
        try {
          activate(ctx);
        } catch (error) {
          log(error);
        }
      }
    };
  }
});
