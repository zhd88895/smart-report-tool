# 全站 UI 优化 + AI 主功能化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端改造成深蓝+中性灰商务风、AI 功能主导的信息架构，后端增加 AI 工具调用（读写/分析/执行脚本）与会话滑动过期，同时拆分 4 个巨型页面、统一全站组件状态。

**Architecture:** 前端三层——主题 token 层（index.css + tailwind 映射）、布局层（Sidebar/AppLayout/TopNav/Dashboard）、页面层（4 个巨型页面拆分 + 状态统一）；后端两层——会话滑动过期（心跳端点 + 中间件顺延）、AI 工具注册表（只读自动执行、写/执行走 pending 确认流）。复用既有 scriptService/reportService/callUserAI，不另起业务路径。

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Zustand（前端）；Express + TypeScript + better-sqlite3（后端）。

## Global Constraints

- 工作目录 `E:\Kimi_workspace\smart-report-tool`；**两个嵌套 git 仓库**：`smart-report-server/`（master）与 `smart-report-tool/`（master）。前端任务提交 web 仓库，后端任务提交 server 仓库，互不交叉。
- 设计文档：`docs/superpowers/specs/2026-07-28-ui-overhaul-ai-centric-design.md`（已批准），色值/分组/工具表以其为准。
- 每个任务完成后必须验证：改动仓库跑 `npx tsc --noEmit` 零错误；前端涉及渲染的任务再跑 `npx vite build` 零错误。node 在 PATH 不可用时前缀 `export PATH="/c/Program Files/nodejs:$PATH"`。
- commit message 中文，前缀 `feat(ui):` / `refactor(ui):` / `feat(ai):` / `feat(auth):` / `chore:`。
- 不引入新依赖（UI 重构用现有 tailwind/shadcn；AI 工具用既有 fetch/DB）。
- 安全底线：`write_script`/`run_script` 工具绝不自动执行，必须 pending + 用户确认；所有 SQL 带 user_id；越权返回 404。
- APL Logo 三个字母造型与三色必须保留（色值可调饱和度，不可改成单色或图片）。
- 不做暗色主题、不做移动端响应式重构、不改后端脚本业务逻辑。
- 项目无测试框架（无 vitest/jest），验证方式为 tsc + vite build + 浏览器走查（Task 12），不为 UI 任务补测试脚手架。

---

### Task 1: 主题 token 替换与死代码清理（web）

**Files:**
- Modify: `smart-report-tool/src/index.css`（:root 变量全量替换 + 新增 sidebar token）
- Modify: `smart-report-tool/tailwind.config.ts`（映射 sidebar 色阶；删 darkMode）
- Delete: `smart-report-tool/src/constants/colors.ts`（零引用死文件）
- Delete: `smart-report-tool/src/pages/AgentPage.tsx`（未路由死代码；先 grep 确认无引用）
- Modify: `smart-report-tool/src/stores/uiStore.ts`（删 theme/setTheme 死代码）
- Create: `smart-report-tool/src/constants/layout.ts`

**Interfaces:**
- Produces: CSS 变量 `--sidebar`、`--sidebar-foreground`、`--sidebar-muted`、`--sidebar-accent`、`--sidebar-border`；tailwind 色 `sidebar.DEFAULT/foreground/muted/accent/border`；`layout.ts` 导出 `SIDEBAR_WIDTH_COLLAPSED = 64`、`SIDEBAR_WIDTH_EXPANDED = 240`。

- [ ] **Step 1:** grep 确认 `constants/colors`、`AgentPage`、`uiStore` 的 theme 无引用（`Grep "colors'"`、`Grep "AgentPage"`、`Grep "setTheme|theme"` in src），有引用则先记录再处理。
- [ ] **Step 2:** 按设计文档 §3.1 表格替换 index.css `:root` 全部变量，新增 5 个 sidebar token（primary `215 55% 32%`、sidebar `217 45% 18%` 等，逐值照抄设计文档）。
- [ ] **Step 3:** tailwind.config.ts 删 `darkMode: ['class']`，colors 扩展加 `sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', muted: 'hsl(var(--sidebar-muted))', accent: 'hsl(var(--sidebar-accent))', border: 'hsl(var(--sidebar-border))' }`。
- [ ] **Step 4:** 创建 layout.ts 导出两个宽度常量；删 colors.ts、AgentPage.tsx；uiStore 删 theme 字段。
- [ ] **Step 5:** `npx tsc --noEmit` 零错误 + `npx vite build` 零错误。
- [ ] **Step 6:** `git add -A && git commit -m "feat(ui): 深蓝商务主题 token 与死代码清理"`

### Task 2: AplLogo 组件 + 侧边栏分组重排 + 布局宽度收敛（web）

**Files:**
- Create: `smart-report-tool/src/components/common/AplLogo.tsx`
- Modify: `smart-report-tool/src/components/layout/Sidebar.tsx`（深色侧栏 + 三分组 + 单源 label）
- Modify: `smart-report-tool/src/components/layout/AppLayout.tsx`（宽度用 layout.ts 常量，删 isLoginPage 死分支）
- Modify: `smart-report-tool/src/components/layout/TopNav.tsx`（宽度常量；配色走 token）
- Modify: `smart-report-tool/src/constants/routes.ts`（label 统一为菜单文案：仪表盘/脚本及模板/生成报告…）
- Modify: `smart-report-tool/src/router/index.tsx`（AI 设置 feature `'ai-settings'`）
- Modify: `smart-report-tool/src/pages/LoginPage.tsx`（Shield 图标换 AplLogo）

**Interfaces:**
- Consumes: Task 1 的 sidebar 色阶与 layout.ts 常量。
- Produces: `AplLogo({ size?: 'sm'|'md'|'lg', dark?: boolean })`；Sidebar 分组结构（AI 工作区/脚本与数据/系统，顺序见设计 §4.1）；feature key `'ai-settings'`。

- [ ] **Step 1:** AplLogo.tsx：三个 `<span>` 字母，色 `text-[#4A8FD9]`/`text-[#D95F5F]`/`text-[#5FA87F]`，深色侧栏变体（dark prop 调亮）；抽自现 Sidebar.tsx:53-57 并修复 text-primary 冲突。
- [ ] **Step 2:** Sidebar 重写：`bg-sidebar text-sidebar-foreground`，分组标题 `text-sidebar-muted text-xs uppercase tracking-wider`，菜单项 hover/激活 `bg-sidebar-accent`；菜单数组按设计 §4.1 顺序定义，label 引用 ROUTE_LABELS；折叠态隐藏分组标题，按钮加 `aria-label` 与 title tooltip。
- [ ] **Step 3:** routes.ts 的 ROUTE_LABELS 改成与菜单一致（仪表盘/脚本及模板/生成报告/报告管理/AI助手/用户管理/系统设置/AI设置/知识库/个人设置/对话记录）。
- [ ] **Step 4:** AppLayout/TopNav 的 64/240 魔法数改引 layout.ts；删 AppLayout isLoginPage 死分支；LoginPage 换 AplLogo。
- [ ] **Step 5:** router 与 Sidebar 中 AI 设置 feature 改 `'ai-settings'`；grep 权限判断逻辑确认 admin 默认全通过。
- [ ] **Step 6:** tsc + vite build 零错误。
- [ ] **Step 7:** commit `feat(ui): 深色侧栏三分组布局与 APL Logo 组件化`

### Task 3: 全站组件状态统一（web）

**Files:**
- Create: `smart-report-tool/src/components/common/LoadingSpinner.tsx`（`{ text?: string }`，Loader2 统一封装）
- Modify: `AISettingsPage.tsx:430`、`AssistantPage.tsx:237-239`、`KnowledgeBasePage.tsx:325`、`KnowledgeFilePicker.tsx:138`、`AIAnalysisPanel.tsx:707`（加载态全换 LoadingSpinner）
- Modify: `KnowledgeBasePage.tsx:163,218`（原生 confirm() → ConfirmDialog）
- Modify: `DashboardPage.tsx:54` 等空态改 `EmptyState`

**Interfaces:**
- Produces: `LoadingSpinner({ text?: string, className?: string })`。

- [ ] **Step 1:** 创建 LoadingSpinner（Loader2 animate-spin + 可选文字，与既有 ui 组件同风格）。
- [ ] **Step 2:** grep `加载中` 与 `animate-spin` 全 src，逐处替换为 LoadingSpinner。
- [ ] **Step 3:** KnowledgeBasePage 两处 confirm() 改 ConfirmDialog（参照其他页面用法）。
- [ ] **Step 4:** grep `暂无` 找自写空态，能换 EmptyState 的全换。
- [ ] **Step 5:** tsc + vite build 零错误。
- [ ] **Step 6:** commit `refactor(ui): 统一全站加载/空态/确认对话框`

### Task 4: 仪表盘 AI 工作台改造（web）

**Files:**
- Modify: `smart-report-tool/src/pages/DashboardPage.tsx`（整体重构，现 71 行）
- Modify: 视需要复用 `services/api.ts` 报告列表接口（过滤 AI 生成类型取 5 条）

**Interfaces:**
- Consumes: Task 1 主题 token；既有报告列表 API。

- [ ] **Step 1:** 按设计 §4.2 实现四区：欢迎区+AI 助手大入口卡（跳 /assistant）、快捷操作卡（AI 分析巡检日志→/report/create?mode=ai、生成报告、上传脚本）、最近 AI 分析列表（5 条）、统计卡（图标色改 token）。
- [ ] **Step 2:** `/report/create?mode=ai` 查询参数支持：ReportCreatePage 读取 mode=ai 时默认进 AI 智能分析模式（本任务只加读取逻辑，页面重构在 Task 6）。
- [ ] **Step 3:** tsc + vite build 零错误。
- [ ] **Step 4:** commit `feat(ui): 仪表盘改造为 AI 工作台首页`

### Task 5: ScriptsTemplatesPage 拆分（web）

**Files:**
- Create: `smart-report-tool/src/components/scripts/ScriptListPanel.tsx`、`TemplateListPanel.tsx`、`UploadScriptDialog.tsx`、`UploadTemplateDialog.tsx`、`ScriptDetailDialog.tsx`（按现有 25 个 Dialog 归类）
- Modify: `smart-report-tool/src/pages/ScriptsTemplatesPage.tsx`（1608→约 300 行，只留组合与 Tab 状态）

**Interfaces:**
- Consumes: 既有 scripts/templates service API（不动）；Task 3 LoadingSpinner。

- [ ] **Step 1:** 通读现页面，按「脚本列表 / 模板列表 / 上传对话框 / 详情对话框」划分状态归属，画好 props 接口再动手。
- [ ] **Step 2:** 逐块抽组件，行为保持不变（纯结构重构，不改交互逻辑）。
- [ ] **Step 3:** ScriptFileCard 硬编码类型色（:6-10）改 token 语义色。
- [ ] **Step 4:** tsc + vite build 零错误。
- [ ] **Step 5:** commit `refactor(ui): 拆分脚本及模板巨型页面`

### Task 6: ReportCreatePage 拆分 + AI 模式置顶（web）

**Files:**
- Create: `smart-report-tool/src/components/report/create/StepScript.tsx`、`StepTemplate.tsx`、`StepUpload.tsx`、`StepInfo.tsx`、`StepConfirm.tsx`
- Modify: `smart-report-tool/src/pages/ReportCreatePage.tsx`（1008→约 300 行；标题三元嵌套 :370 改映射表；AI 模式默认 Tab）

**Interfaces:**
- Consumes: Task 4 的 `?mode=ai` 参数（本任务落地默认 AI 模式）；`components/report/AIAnalysisPanel` 不动内核。

- [ ] **Step 1:** 五步向导每步拆组件，页面只留步骤机与共享状态。
- [ ] **Step 2:** 页面标题按步骤+模式映射表渲染；默认 Tab 改为 AI 智能分析（mode 查询参数可覆盖回脚本模式）。
- [ ] **Step 3:** tsc + vite build 零错误。
- [ ] **Step 4:** commit `refactor(ui): 拆分报告生成向导并置顶 AI 模式`

### Task 7: AISettingsPage 拆分 + 提示词抽离（web）

**Files:**
- Create: `smart-report-tool/src/components/ai/settings/ProviderDialog.tsx`、`ModelDialog.tsx`、`FetchModelsDialog.tsx`、`UsagePanel.tsx`
- Modify: `smart-report-tool/src/pages/AISettingsPage.tsx`（853→约 350 行）
- Create: `smart-report-tool/src/constants/analysisPrompts.ts`（AIAnalysisPanel 的 300 行提示词常量抽离）
- Modify: `smart-report-tool/src/components/report/AIAnalysisPanel.tsx`（引用常量）

**Interfaces:**
- Consumes: 既有 aiConfigService（不动）。

- [ ] **Step 1:** 按厂商对话框/模型对话框/拉取模型对话框/用量面板四块抽组件。
- [ ] **Step 2:** 提示词常量抽离到 analysisPrompts.ts，AIAnalysisPanel 改 import。
- [ ] **Step 3:** tsc + vite build 零错误。
- [ ] **Step 4:** commit `refactor(ui): 拆分 AI 设置页并抽离分析提示词常量`

### Task 8: ReportsPage 拆分 + safeToast 评估（web）

**Files:**
- Create: `smart-report-tool/src/components/reports/ReportFilterBar.tsx`、`ReportListTable.tsx`、`ReportPreviewDialog.tsx`
- Modify: `smart-report-tool/src/pages/ReportsPage.tsx`（681→约 300 行；:24-31 safeToast 评估）

- [ ] **Step 1:** 拆筛选栏/列表/预览对话框三组件。
- [ ] **Step 2:** 排查 safeToast 包装成因（读 sonner 版本与调用方式），能安全去除则直接换裸 `toast`；不能则保留并在注释说明原因。
- [ ] **Step 3:** tsc + vite build 零错误。
- [ ] **Step 4:** commit `refactor(ui): 拆分报告管理页`

### Task 9: 会话滑动过期（server + web）

**Files:**
- Modify: `smart-report-server/src/middleware/auth.ts`（或 session 校验处：剩余 < SESSION_EXPIRY_MINUTES/2 时顺延）
- Modify: `smart-report-server/src/routes/users.ts`（新增 `POST /heartbeat`，认证后 204）
- Modify: `smart-report-tool/src/components/layout/AppLayout.tsx`（活动监听 + 节流 5 分钟心跳）

**Interfaces:**
- Produces: `POST /api/users/heartbeat`（需认证，成功 204 无 body；续期逻辑复用中间件同一函数）。

- [ ] **Step 1:** 读 session 校验实现（users.ts/sessionService），加滑动续期函数 `touchSession(sessionId)`：剩余不足一半时 UPDATE expires_at。
- [ ] **Step 2:** 加 heartbeat 路由（authenticate + touchSession + 204）。
- [ ] **Step 3:** AppLayout useEffect：click/keydown/scroll passive 监听，节流 5 分钟 `fetch('/api/users/heartbeat', {method:'POST', credentials:'include'})`，卸载清理。
- [ ] **Step 4:** 双仓库 tsc 零错误 + web build 零错误。
- [ ] **Step 5:** server commit `feat(auth): 会话滑动过期与心跳端点`；web commit `feat(auth): 用户活动心跳续期`

### Task 10: AI 工具注册表——只读工具（server）

**Files:**
- Create: `smart-report-server/src/services/aiTools/registry.ts`（工具定义：OpenAI function schema + handler）
- Create: `smart-report-server/src/services/aiTools/scriptTools.ts`（list_scripts/read_script/analyze_script/list_reports 实现，复用 scriptService/reportService）
- Modify: `smart-report-server/src/services/aiProviderService.ts`（callUserAI 已有 tool calling 支持，接入工具循环，最多 3 轮）
- Modify: `smart-report-server/src/routes/ai.ts`（chat 请求带 `enableTools` 时挂工具）

**Interfaces:**
- Produces: `TOOL_DEFINITIONS: OpenAITool[]`；`executeTool(userId: string, name: string, args: unknown): Promise<ToolResult>`；`ToolResult = { ok: boolean; summary: string; data?: unknown }`；工具名 `list_scripts`/`read_script`/`analyze_script`/`list_reports`（Task 11 加 `write_script`/`run_script`，同一注册表）。
- 安全：handler 内所有查询带 userId；不存在的脚本/报告返回 `{ok:false}` 不抛异常。

- [ ] **Step 1:** 读 scriptService/reportService 既有方法与 callUserAI 的 tool calling 现状，确定复用点。
- [ ] **Step 2:** registry.ts：工具 schema 数组 + 分发器；scriptTools.ts 四只读 handler（analyze_script：读源码后调 callUserAI 生成功能总结，防递归用 feature:'tool' 且不再挂工具）。
- [ ] **Step 3:** aiProviderService 加工具循环：模型返回 tool_calls → 只读工具立即执行 → 结果作 tool 消息回注 → 继续，最多 3 轮；写/执行类工具名在本任务先返回「待确认功能 Task 11 实现」占位错误。
- [ ] **Step 4:** routes/ai.ts chat/chatStream 支持 `enableTools`（助手页请求带 true）。
- [ ] **Step 5:** tsc 零错误；手动 curl 冒烟：带 enableTools 发「列出我的脚本」验证 tool 循环。
- [ ] **Step 6:** server commit `feat(ai): AI 工具注册表与只读脚本工具`

### Task 11: 写/执行工具 + pending 确认流（server + web）

**Files:**
- Create: `smart-report-server/src/db/aiToolConfirmRepository.ts`（`pending_tool_calls` 表：id/user_id/tool/args/status/created_at）
- Modify: `smart-report-server/src/services/aiTools/scriptTools.ts`（write_script/run_script handler：创建 pending 记录，返回待确认）
- Modify: `smart-report-server/src/routes/ai.ts`（SSE 推 `tool_confirm` 事件；新增 `POST /api/ai/tools/confirm {pendingId}`、`POST /api/ai/tools/cancel`）
- Modify: `smart-report-tool/src/services/aiService.ts`（SSE 解析扩展 tool_call/tool_confirm/tool_result 事件）
- Create: `smart-report-tool/src/components/ai/ToolCallCard.tsx`（调用中/待确认/已完成三态卡片）
- Modify: `smart-report-tool/src/pages/AssistantPage.tsx`（渲染卡片；确认/取消回调；请求带 enableTools）

**Interfaces:**
- Consumes: Task 10 registry/executeTool。
- Produces: `POST /api/ai/tools/confirm` body `{pendingId: string}` → 执行并 200 `{code,data:{summary}}`；SSE 事件 `data: {"type":"tool_confirm","pendingId":"...","tool":"write_script","argsSummary":"..."}`；前端 `ToolCallCard({ state: 'running'|'pending'|'done'|'error', tool: string, summary: string, onConfirm?: () => void, onCancel?: () => void })`。

- [ ] **Step 1:** pending_tool_calls 建表（跟随既有 migration 模式）+ repository（归属校验：confirm 时 WHERE id=? AND user_id=?，失败 404）。
- [ ] **Step 2:** write_script（新建/修改脚本，args: scriptId?/name/category/mainPy/description）与 run_script（scriptId/logFileName）handler：INSERT pending，返回 `{ok:true, pending:true}`。
- [ ] **Step 3:** SSE 层：工具循环遇到 pending 工具时推 tool_confirm 事件并暂停；confirm 端点执行（write_script 复用 scriptService 创建/更新；run_script 复用报告生成链路），结果落 conversation。
- [ ] **Step 4:** 前端 SSE 事件解析 + ToolCallCard + AssistantPage 集成（确认后重新发起带确认结果的续聊请求）。
- [ ] **Step 5:** 双仓库 tsc + web build 零错误。
- [ ] **Step 6:** server commit `feat(ai): 写/执行脚本工具的待确认执行流`；web commit `feat(ai): 助手页工具调用卡片与确认交互`

### Task 12: E2E 验收（主会话执行，不派子代理）

- [ ] 浏览器走查视觉四件套（深蓝侧栏/Logo/分组/仪表盘工作台）
- [ ] AI 工具实测：列出脚本 → 读脚本 → 起草新脚本（确认卡→确认→落库）→ 执行脚本
- [ ] 会话心跳实测；知识库删除 ConfirmDialog；回归：脚本上传/报告生成/AI 设置/迁移

---

## Self-Review 记录

- Spec 覆盖：§3 主题→T1/T2；§4 架构→T2/T4；§5 工具→T10/T11；§6 会话→T9；§7 页面→T3/T5/T6/T7/T8；§9 验收→T12。无缺口。
- 类型一致：`executeTool`/`ToolResult`/`ToolCallCard`/`'ai-settings'` 在 T10/T11/T2 间一致引用。
- 占位符：T8 safeToast 给出两条明确路径；T3 grep 清单已列具体文件行号。
