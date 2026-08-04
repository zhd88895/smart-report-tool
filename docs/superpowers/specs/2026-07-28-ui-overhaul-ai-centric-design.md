# 全站 UI 优化 + AI 主功能化 设计文档

- 日期：2026-07-28
- 状态：已获用户批准（2026-07-28）
- 前置：多厂商 AI 服务重构已完成（见 2026-07-28-multi-vendor-ai-design.md）

## 1. 背景与目标

当前前端是 shadcn 默认亮蓝主题（#2563EB），菜单按脚本流程排序，AI 功能排第 5 位；存在配色双体系、四个巨型页面（1608/1008/853/681 行）、加载/空态四种写法、会话固定时间踢出等问题。

用户目标（已确认）：

1. 配色改为「深蓝 + 中性灰」专业商务风，保留 APL 三色 Logo 造型
2. 侧边栏分组重排 + 仪表盘改造，AI 功能成为项目主功能；脚本功能保留
3. 脚本相关 API 包装为 AI 工具：AI 可读写脚本、分析脚本、自动执行脚本（写/执行类必须人工确认）
4. 会话超时改为滑动过期：网页有操作即续期
5. 深度：视觉布局 + 重点页面重构（拆分 4 个巨型页面、统一组件状态）

## 2. 现状关键事实（探索结论）

- `index.css:6-27`：仅 `:root` 亮色变量，主色 `221 83% 53%`；`tailwind.config.ts:4` 有 `darkMode:['class']` 但无暗色变量，`uiStore.theme` 无调用方（死代码）
- `constants/colors.ts`：独立色板，全项目零引用（死文件）
- APL Logo 仅在 `Sidebar.tsx:53-57`：三个 `<span>` + 硬编码三色 hex；登录页用 Shield 图标无 Logo
- 菜单双源不一致：`Sidebar.tsx:23-34` vs `constants/routes.ts:17-29` ROUTE_LABELS；AI 设置 feature 复用 `'settings'`
- 布局魔法数 `64px/240px` 重复硬编码：`AppLayout.tsx:24`、`TopNav.tsx:35`、`Sidebar.tsx:48`
- 巨型页面：`ScriptsTemplatesPage` 1608 行（39 useState/25 Dialog）、`ReportCreatePage` 1008 行、`AISettingsPage` 853 行、`ReportsPage` 681 行
- 加载态四种写法（Loader2/RefreshCw/纯文字/三点 bounce）；空态仅 ScriptsTemplatesPage 用 EmptyState；`KnowledgeBasePage:163,218` 用原生 `confirm()`
- `AgentPage.tsx` 未挂路由（死代码），直接 fetch 绕过 api 封装
- `AIAnalysisPanel.tsx:38-120+` 约 300 行提示词硬编码在组件内
- 会话：后端 `SESSION_EXPIRY_MINUTES` 固定过期；前端无活动心跳

## 3. 主题系统设计

### 3.1 配色 token（index.css :root 全量替换）

| Token | 值（HSL） | 说明 |
|---|---|---|
| `--primary` | 215 55% 32% | 藏青蓝（约 #24508C），按钮/链接/强调 |
| `--primary-foreground` | 0 0% 100% | |
| `--background` | 210 20% 98% | 锌灰白内容区背景 |
| `--foreground` | 222 25% 16% | 深蓝灰正文 |
| `--card` / `--popover` | 0 0% 100% | |
| `--muted` | 210 16% 95% | |
| `--muted-foreground` | 215 14% 42% | |
| `--border` / `--input` | 214 20% 88% | |
| `--accent` | 210 24% 93% | hover 底色 |
| `--ring` | 215 55% 32% | 同 primary |
| `--destructive` | 0 62% 45% | 商务红（降饱和） |
| `--radius` | 0.5rem | 不变 |

新增 sidebar 专用 token（深色藏青侧栏）：

| Token | 值 | 说明 |
|---|---|---|
| `--sidebar` | 217 45% 18% | 深藏青侧栏背景（约 #19304F） |
| `--sidebar-foreground` | 210 25% 92% | 侧栏文字 |
| `--sidebar-muted` | 215 18% 62% | 侧栏次级文字/分组标题 |
| `--sidebar-accent` | 216 38% 26% | 侧栏 hover/激活底 |
| `--sidebar-border` | 216 35% 24% | |

tailwind.config.ts 映射 `sidebar.*` 色阶。`ScriptFileCard` 脚本类型色、`DashboardPage` 统计卡色等硬编码色值全部改走 token。

### 3.2 APL Logo

保留 `Sidebar.tsx` 三个 `<span>` 字母造型，三色微调为商务降饱和版（蓝 #4A8FD9 / 红 #D95F5F / 绿 #5FA87F，最终在实施时以深色侧栏上的对比度为准微调）；外层 `text-primary` 与内联色冲突修复。登录页 Shield 图标替换为同款 APL Logo 组件（抽 `components/common/AplLogo.tsx` 复用）。

### 3.3 死代码清理

删 `constants/colors.ts`；删 `uiStore.theme/setTheme` 死代码与 `tailwind.config.ts` darkMode 配置；删未路由的 `AgentPage.tsx`；侧边栏宽度收敛为 `constants/layout.ts` 的 `SIDEBAR_WIDTH_COLLAPSED=64 / SIDEBAR_WIDTH_EXPANDED=240`，AppLayout/TopNav/Sidebar 三处引用。

## 4. 信息架构

### 4.1 侧边栏分组

```
APL Logo
─ AI 工作区 ─
  AI 助手        /assistant
  生成报告       /report/create   （AI 智能分析模式置顶为默认 Tab）
  对话记录       /conversations
  知识库         /knowledge-base
─ 脚本与数据 ─
  脚本及模板      /scripts
  报告管理       /reports
  仪表盘         /dashboard
─ 系统 ─
  用户管理       /users           （admin）
  系统设置       /settings/system （admin）
  AI 设置       /settings/ai     （indent，feature 独立为 'ai-settings'）
  个人设置       /settings
```

- 菜单数据源改为从 `ROUTE_LABELS` 单一来源生成（Sidebar 定义顺序与分组，label 引用常量）
- AI 设置权限 feature 从 `'settings'` 拆为独立 `'ai-settings'`（router 同步），保持向后兼容：admin 全可见
- 分组标题小字大写样式（sidebar-muted）；折叠态隐藏分组标题，菜单按钮补 `aria-label` + tooltip

### 4.2 仪表盘改造（AI 工作台首页）

`DashboardPage` 重构为：

1. **欢迎区**：问候语 + 大号「AI 助手」入口卡（点击进入 /assistant，附一句话能力说明：可分析日志、读写脚本、解答运维问题）
2. **快捷操作卡**：「AI 分析巡检日志」（/report/create AI 模式）、「生成报告」、「上传脚本」
3. **最近 AI 分析**列表（复用报告列表 API，过滤 AI 生成类型，取近 5 条）
4. **统计卡**保留（脚本数/报告数/可下载/用户数），图标色改走 token

## 5. AI 工具调用（脚本操作）

### 5.1 架构

```
助手页消息 → POST /api/ai/chat(+stream)（已有统一入口 callUserAI）
  → 模型返回 tool_calls → 后端工具注册表执行
    ├─ 只读工具：立即执行，结果回注消息流，继续对话循环（最多 3 轮）
    └─ 写/执行工具：不执行，SSE 推 {type:'tool_confirm'} 卡片
         → 前端渲染确认卡 → 用户点「确认执行」
         → POST /api/ai/tools/confirm {pendingId} → 执行 → 结果以 tool 消息续接对话
```

### 5.2 工具注册表（`services/aiTools/`）

| 工具 | 类型 | 说明 |
|---|---|---|
| `list_scripts` | 只读 | 列出当前用户可见脚本（id/名称/类型/状态） |
| `read_script` | 只读 | 读取指定脚本源码与元信息 |
| `analyze_script` | 只读 | 分析脚本功能（调 AI 总结脚本逻辑、输入输出、依赖） |
| `list_reports` | 只读 | 列出近期报告（便于 AI 引用分析结果） |
| `write_script` | 需确认 | 新建或修改脚本（含 main.py 内容），确认后落库 |
| `run_script` | 需确认 | 对指定日志文件执行脚本生成报告，确认后触发既有报告生成链路 |

- 工具实现复用 `scriptService`/`reportService` 既有逻辑，不另起业务路径；权限沿用调用用户的会话（userId 隔离不变）
- `pending_tool_calls` 表（id/user_id/conversation_id/tool/args/status/created_at），确认端点校验归属
- 每次工具调用写审计日志（user_ai_usage_logs 复用或独立 console 审计行 + DB 记录 tool 名与结果状态）

### 5.3 前端

- `AssistantPage` 消息流支持渲染三种卡片：工具调用中（spinner + 工具名）、待确认（参数摘要 + 确认/取消按钮）、已完成（结果摘要，可展开）
- `aiService.sendMessageStream` 的 SSE 解析扩展事件类型（`tool_call`/`tool_confirm`/`tool_result`），与现有行缓冲兼容

## 6. 会话滑动过期

- 后端：session 校验中间件命中时若剩余时间 < `SESSION_EXPIRY_MINUTES/2` 则顺延过期时间（滑动续期）；新增轻量 `POST /api/users/heartbeat`（认证后调用，仅续期返回 204）
- 前端：`AppLayout` 挂载活动监听器（click/keydown/scroll，passive），节流 5 分钟调心跳；`SESSION_EXPIRY_MINUTES` 语义文档化为「无操作超时」
- 连续无操作超时行为不变（跳登录页）

## 7. 重点页面重构

| 页面 | 动作 |
|---|---|
| `ScriptsTemplatesPage` 1608 行 | 拆 `scripts/`（ScriptListPanel、TemplateListPanel、UploadScriptDialog、ScriptDetailDialog 等子组件），页面只留组合与路由状态 |
| `ReportCreatePage` 1008 行 | 五步向导每步拆组件（StepScript/StepTemplate/StepUpload/StepInfo/StepConfirm），AI 模式入口置顶；标题三元嵌套（:370）改映射表 |
| `AISettingsPage` 853 行 | 拆 `ai/settings/`（ProviderDialog、ModelDialog、FetchModelsDialog、UsagePanel） |
| `ReportsPage` 681 行 | 拆列表/筛选/预览组件；评估去掉 safeToast 包装（若 sonner 调用方式修正后无隐患则删） |
| 全站 | 统一 `LoadingSpinner`（Loader2 一种写法）、`EmptyState`、`ConfirmDialog`；`KnowledgeBasePage` 原生 confirm() 替换 |
| `AIAnalysisPanel` | 300 行提示词常量抽离到 `constants/analysisPrompts.ts` |

## 8. 非目标（YAGNI）

- 不做暗色主题（删死代码，不留半成品）
- 不做移动端响应式重构（本期仅保证不恶化；全项目无 md: 类是既有状态）
- Agent 页功能不复活（死代码删除；如未来需要另行设计）
- 后端脚本业务逻辑不改（仅包装为工具）

## 9. 验收标准

| 层 | 项 |
|---|---|
| 构建 | `tsc --noEmit` + `vite build` 零错误 |
| 视觉（浏览器走查） | ① 深蓝侧栏 + 灰白内容区全页一致 ② APL Logo 侧栏/登录页显示正确 ③ 侧边栏三分组、AI 工作区在最上 ④ 仪表盘 AI 工作台布局 |
| 功能 | ⑤ AI 工具调用实测：让 AI 列出脚本→读脚本→起草新脚本（确认卡出现→确认后落库）→执行脚本生成报告 ⑥ 会话心跳：操作后续期，无操作超时仍踢出 ⑦ 知识库删除用 ConfirmDialog ⑧ 回归：脚本上传/报告生成/AI 设置/迁移链路不破坏 |
| 用户隔离 | AI 工具以调用用户身份执行，越权访问他人脚本/报告 404 |
