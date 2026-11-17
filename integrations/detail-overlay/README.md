# 详情悬浮窗口

`src/components/DetailOverlay.tsx` 使用同一 React 运行时和路由上下文创建原生 HTML dialog，完整详情位于 `/instance/:uuid`。

首页组件保持挂载，关闭、返回、Esc、点击外侧遮罩均收起窗口，保留卡片 DOM、筛选和滚动位置；关闭时恢复焦点。原生 dialog 使背景不可交互，内容只在当前标签挂载图表。

手机保留外侧边距，窗口内部滚动。没有 iframe、独立网页或第二套 React root。预测和流媒体标签的显示由主题设置控制。
