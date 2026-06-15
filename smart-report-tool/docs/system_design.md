# 智能报告生成工具 — 系统架构设计文档

> 版本：v1.0  
> 基于 PRD v1.0  
> 输出日期：2026-06-11

---

## 目录

1. [实现方案与框架选型](#1-实现方案与框架选型)
2. [文件列表及相对路径](#2-文件列表及相对路径)
3. [数据结构与接口设计](#3-数据结构与接口设计)
4. [程序调用流程](#4-程序调用流程)
5. [任务列表（有序、含依赖关系）](#5-任务列表有序含依赖关系)
6. [依赖包列表](#6-依赖包列表)
7. [共享知识（跨文件约定）](#7-共享知识跨文件约定)
8. [待明确事项](#8-待明确事项)

---

## 1. 实现方案与框架选型

### 1.1 技术栈总览

| 层级 | 技术选型 | 版本 | 说明 |
|------|----------|------|------|
| 构建工具 | Vite | ^5.0.0 | 快速 HMR，静态站点输出 |
| 前端框架 | React | ^18.2.0 | 函数组件 + Hooks |
| 语言 | TypeScript | ^5.3.0 | 严格模式 |
| 路由 | React Router DOM | ^6.20.0 | 声明式路由 + 嵌套布局 |
| 状态管理 | Zustand | ^4.4.0 | 轻量，无需 Provider 包裹 |
| UI 样式 | Tailwind CSS | ^3.4.0 | 原子化 CSS |
| UI 组件库 | shadcn/ui | latest | Headless + Tailwind，按需安装 |
| 图标库 | lucide-react | ^0.294.0 | shadcn/ui 默认图标 |
| 日期处理 | date-fns | ^2.30.0 | 日期格式化与操作 |
| 数据库 | idb (IndexedDB wrapper) | ^7.1.1 | 浏览器本地结构化存储 |
| AI SDK | CodeBuddy Agent SDK | 由项目环境提供 | 多轮对话、意图识别封装 |
| 工具库 | clsx / tailwind-merge | latest | 类名合并 |

### 1.2 架构模式

采用 **分层架构（Layered Architecture）**：

```
┌─────────────────────────────────────────────┐
│  表现层 (Presentation)                       │
│  Pages → Components → Hooks                  │
├─────────────────────────────────────────────┤
│  状态层 (State)                              │
│  Zustand Stores（按领域划分）                 │
├─────────────────────────────────────────────┤
│  服务层 (Service)                            │
│  Services → IndexedDB / localStorage / SDK   │
├─────────────────────────────────────────────┤
│  数据层 (Data)                               │
│  IndexedDB (idb) + localStorage              │
└─────────────────────────────────────────────┘
```

### 1.3 核心难点与应对

| 难点 | 应对策略 |
|------|----------|
| 纯前端无后端，数据持久化与查询 | 使用 IndexedDB（idb 库）存储结构化数据；localStorage 存储登录 token 和 UI 偏好 |
| 多角色权限控制 | 前端路由守卫 + 组件级权限渲染；权限矩阵表硬编码在常量中 |
| 报告生成进度模拟 | 使用 setInterval 模拟进度，实际为前端组装 HTML 模板 + 日志数据 |
| AI 助手意图识别 | 在 `aiService.ts` 中封装意图分类逻辑（基于关键词 + 简单规则），再调用 CodeBuddy SDK |
| 报告模板预览与导出 | 内置 HTML 模板字符串，用 iframe 预览；下载时生成 Blob URL |

---

## 2. 文件列表及相对路径

项目根目录下的完整文件树：

```
smart-report-tool/
├── public/
│   └── templates/
│       ├── host-template.html
│       ├── storage-template.html
│       ├── database-template.html
│       ├── virtualization-template.html
│       └── network-template.html
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── components.json              # shadcn/ui 配置文件
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── router/
│   │   └── index.tsx            # 路由定义 + 路由守卫
│   ├── types/
│   │   └── index.ts             # 全局 TypeScript 类型
│   ├── constants/
│   │   ├── roles.ts             # 角色与权限矩阵
│   │   ├── categories.ts        # 日志五类分类常量
│   │   ├── colors.ts            # UI 色彩常量
│   │   └── routes.ts            # 路由路径常量
│   ├── utils/
│   │   ├── permissions.ts       # 权限校验函数
│   │   ├── formatters.ts        # 格式化工具（日期、文件大小）
│   │   └── validators.ts        # 表单校验规则
│   ├── services/
│   │   ├── db.ts                # IndexedDB 初始化与封装
│   │   ├── authService.ts       # 登录/登出/Token
│   │   ├── userService.ts       # 用户 CRUD
│   │   ├── scriptService.ts     # 脚本 CRUD
│   │   ├── reportService.ts     # 报告生成与 CRUD
│   │   ├── conversationService.ts # 对话记录 CRUD
│   │   └── aiService.ts         # CodeBuddy SDK 封装 + 意图识别
│   ├── stores/
│   │   ├── authStore.ts         # 认证状态（用户、token、登录态）
│   │   ├── scriptStore.ts       # 脚本列表状态
│   │   ├── reportStore.ts       # 报告列表 + 生成流程状态
│   │   ├── userStore.ts         # 用户管理状态（管理员）
│   │   ├── conversationStore.ts # 对话历史状态
│   │   └── uiStore.ts           # UI 状态（侧边栏折叠、主题等）
│   ├── hooks/
│   │   ├── useAuth.ts           # 认证相关 hook（自动跳转等）
│   │   ├── useScripts.ts        # 脚本数据操作 hook
│   │   ├── useReports.ts        # 报告数据操作 hook
│   │   ├── useUsers.ts          # 用户管理 hook（管理员）
│   │   ├── useConversations.ts  # 对话记录 hook
│   │   └── useAIAssistant.ts    # AI 助手交互 hook
│   ├── components/
│   │   ├── ui/                  # shadcn/ui 组件（按需安装）
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── select.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── sonner.tsx       # toast 通知
│   │   │   ├── badge.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── sheet.tsx
│   │   │   ├── switch.tsx
│   │   │   └── separator.tsx
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx    # 主布局（侧边栏 + 顶部栏 + 内容区）
│   │   │   ├── Sidebar.tsx      # 侧边菜单栏
│   │   │   ├── TopNav.tsx       # 顶部导航栏
│   │   │   └── RouteGuard.tsx   # 路由权限守卫
│   │   ├── common/
│   │   │   ├── FileUploader.tsx     # 拖拽上传组件
│   │   │   ├── DataTable.tsx        # 通用表格（支持排序、分页）
│   │   │   ├── SearchFilter.tsx     # 搜索筛选栏
│   │   │   ├── StatusBadge.tsx      # 状态标签组件
│   │   │   ├── ConfirmDialog.tsx    # 确认删除弹窗
│   │   │   └── EmptyState.tsx       # 空状态展示
│   │   └── report/
│   │       ├── StepWizard.tsx       # 四步向导容器
│   │       ├── LogUploadStep.tsx    # 步骤① 日志上传
│   │       ├── ReportInfoStep.tsx   # 步骤② 填写报告信息
│   │       ├── TemplateSelectStep.tsx # 步骤③ 模板选择与预览
│   │       ├── SubmitStep.tsx       # 步骤④ 提交生成
│   │       └── ProgressPanel.tsx    # 进度展示面板
│   └── pages/
│       ├── LoginPage.tsx
│       ├── DashboardPage.tsx
│       ├── ScriptsPage.tsx
│       ├── ReportCreatePage.tsx
│       ├── ReportsPage.tsx
│       ├── AssistantPage.tsx
│       ├── UsersPage.tsx
│       ├── ConversationsPage.tsx
│       └── SettingsPage.tsx
└── docs/
    ├── system_design.md
    ├── sequence-diagram.mermaid
    └── class-diagram.mermaid
```

---

## 3. 数据结构与接口设计

### 3.1 核心 TypeScript 类型（`src/types/index.ts`）

```typescript
// ==================== 枚举与基础类型 ====================

export type UserRole = 'admin' | 'user' | 'readonly';

export type LogCategory = 'host' | 'storage' | 'database' | 'virtualization' | 'network';

export type ReportStatus = 'generating' | 'success' | 'failed';

export type AIIntent = 'query_report' | 'analyze_data' | 'general';

// ==================== 实体类型 ====================

export interface User {
  id: string;
  username: string;
  password: string;       // bcrypt 或简单哈希（纯前端降级方案）
  role: UserRole;
  displayName: string;
  createdAt: string;      // ISO 8601
}

export interface Script {
  id: string;
  name: string;
  category: LogCategory;
  fileName: string;
  fileSize: number;
  content: string;        // 脚本文本内容或 base64
  uploadedAt: string;
  uploadedBy: string;     // userId
}

export interface Report {
  id: string;
  name: string;
  type: LogCategory;
  date: string;           // YYYY-MM-DD
  author: string;         // displayName
  authorId: string;
  templateId: string;
  status: ReportStatus;
  logs: string[];         // 上传的日志文件名列表
  fileUrl?: string;       // 生成的报告 Blob URL
  aiAnalysis?: string;    // AI 分析结果（数据库类型可选）
  createdAt: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  intent?: AIIntent;
  timestamp: string;
}

export interface Conversation {
  id: string;
  userId: string;
  userName: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  category: LogCategory | 'universal';
  thumbnail?: string;     // 缩略图 URL / base64
  description: string;
  htmlContent: string;    // 模板 HTML 字符串
  isBuiltIn: boolean;
}

// ==================== 生成流程状态 ====================

export interface ReportGenerationState {
  step: 1 | 2 | 3 | 4;
  logCategory: LogCategory;
  uploadedFiles: File[];
  enableAIAnalysis: boolean;
  reportInfo: {
    name: string;
    date: string;
    author: string;
    authorId: string;
  };
  selectedTemplateId: string | null;
  progress: number;       // 0-100
  status: 'idle' | 'generating' | 'success' | 'failed';
  errorMessage?: string;
}
```

### 3.2 服务层 API 接口定义

```typescript
// ==================== AuthService ====================
interface AuthService {
  login(username: string, password: string): Promise<{ token: string; user: User }>;
  logout(): void;
  getCurrentUser(): User | null;
  isAuthenticated(): boolean;
  initDefaultAdmin(): Promise<void>; // 初始化 admin/admin
}

// ==================== UserService ====================
interface UserService {
  getAllUsers(): Promise<User[]>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: Omit<User, 'id' | 'createdAt'>): Promise<User>;
  deleteUser(id: string): Promise<void>;
  searchUsers(query: string): Promise<User[]>;
}

// ==================== ScriptService ====================
interface ScriptService {
  getAllScripts(): Promise<Script[]>;
  getScriptsByCategory(category: LogCategory): Promise<Script[]>;
  searchScripts(keyword: string, category?: LogCategory): Promise<Script[]>;
  createScript(script: Omit<Script, 'id' | 'uploadedAt'>): Promise<Script>;
  deleteScript(id: string): Promise<void>;
}

// ==================== ReportService ====================
interface ReportService {
  getAllReports(): Promise<Report[]>;
  getReportsByUser(userId: string): Promise<Report[]>;
  getReportsByType(type: LogCategory): Promise<Report[]>;
  createReport(report: Omit<Report, 'id' | 'createdAt' | 'status'>): Promise<Report>;
  updateReportStatus(id: string, status: ReportStatus, fileUrl?: string): Promise<void>;
  deleteReport(id: string): Promise<void>;
  generateReportHTML(report: Report, template: ReportTemplate, logs: string[]): string;
}

// ==================== ConversationService ====================
interface ConversationService {
  getAllConversations(): Promise<Conversation[]>;
  getConversationsByUser(userId: string): Promise<Conversation[]>;
  getConversationById(id: string): Promise<Conversation | undefined>;
  addMessage(conversationId: string, message: ConversationMessage): Promise<void>;
  createConversation(userId: string, userName: string): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
}

// ==================== AIService ====================
interface AIService {
  detectIntent(message: string): AIIntent;
  sendMessage(message: string, history: ConversationMessage[]): Promise<string>;
  analyzeLogs(logContent: string): Promise<string>;
}
```

### 3.3 Class Diagram（数据模型 + 服务类关系）

详见 `docs/class-diagram.mermaid`。

---

## 4. 程序调用流程

### 4.1 报告生成四步流程时序图

详见 `docs/sequence-diagram.mermaid`。

### 4.2 AI 助手交互流程时序图（文字描述）

```
User → AssistantPage → useAIAssistant → aiService.detectIntent(message)
                                                       ↓
                                          分支1: intent=query_report
                                            → conversationService 检索报告
                                            → 组装自然语言回复
                                          分支2: intent=analyze_data
                                            → aiService.analyzeLogs() / sendMessage()
                                            → 返回分析结果
                                          分支3: intent=general
                                            → aiService.sendMessage() → CodeBuddy SDK
                                            → 返回 AI 回复
                                                       ↓
                                ← conversationService.addMessage() 持久化
                                ← 更新 conversationStore
                                ← 渲染到聊天界面
```

---

## 5. 任务列表（有序、含依赖关系）

> **任务上限**：≤ 5 个任务  
> **分组原则**：按功能层次分组，不按单文件拆分  
> **第一个任务**：必须是项目基础设施

---

### T01: 项目基础设施

**说明**：初始化完整的前端工程，安装所有依赖，配置构建工具与开发环境。

**源文件**：
- `package.json`
- `vite.config.ts`
- `tailwind.config.ts`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`
- `index.html`
- `components.json`（shadcn/ui 配置）
- `src/main.tsx`
- `src/App.tsx`
- `src/index.css`
- `.gitignore`

**依赖**：无（第一个任务）

**优先级**：P0

**并行说明**：无依赖，可立即开始。

---

### T02: 类型定义 + 常量 + 工具函数 + 数据库层 + 认证/用户服务

**说明**：建立整个应用的数据契约、常量约定、工具库，以及底层数据存储和认证体系。这是所有业务层的基础。

**源文件**：
- `src/types/index.ts`
- `src/constants/roles.ts`
- `src/constants/categories.ts`
- `src/constants/colors.ts`
- `src/constants/routes.ts`
- `src/utils/permissions.ts`
- `src/utils/formatters.ts`
- `src/utils/validators.ts`
- `src/services/db.ts`（IndexedDB 封装，定义所有 ObjectStore）
- `src/services/authService.ts`
- `src/services/userService.ts`

**依赖**：T01

**优先级**：P0

**并行说明**：依赖 T01 完成后才可开始。

---

### T03: 状态管理（Zustand Stores）+ 核心业务服务 + Hooks

**说明**：实现所有 Zustand 状态管理模块和数据服务层，对外暴露 Hooks 供组件使用。

**源文件**：
- `src/stores/authStore.ts`
- `src/stores/scriptStore.ts`
- `src/stores/reportStore.ts`
- `src/stores/userStore.ts`
- `src/stores/conversationStore.ts`
- `src/stores/uiStore.ts`
- `src/services/scriptService.ts`
- `src/services/reportService.ts`
- `src/services/conversationService.ts`
- `src/services/aiService.ts`
- `src/hooks/useAuth.ts`
- `src/hooks/useScripts.ts`
- `src/hooks/useReports.ts`
- `src/hooks/useUsers.ts`
- `src/hooks/useConversations.ts`
- `src/hooks/useAIAssistant.ts`

**依赖**：T02

**优先级**：P0

**并行说明**：依赖 T02（类型和 db.ts）。

---

### T04: 布局组件 + 通用组件 + 路由配置 + shadcn/ui 组件安装

**说明**：搭建页面骨架（侧边栏、顶部栏、布局容器），实现通用可复用组件，配置完整路由体系（含路由守卫）。

**源文件**：
- `src/components/ui/*.tsx`（通过 `npx shadcn-ui@latest add` 安装所需组件）
- `src/components/layout/AppLayout.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/TopNav.tsx`
- `src/components/layout/RouteGuard.tsx`
- `src/components/common/FileUploader.tsx`
- `src/components/common/DataTable.tsx`
- `src/components/common/SearchFilter.tsx`
- `src/components/common/StatusBadge.tsx`
- `src/components/common/ConfirmDialog.tsx`
- `src/components/common/EmptyState.tsx`
- `src/router/index.tsx`

**依赖**：T02（常量和权限工具）

**优先级**：P0

**并行说明**：可与 T03 并行（T03 依赖 T02，T04 也依赖 T02）。T03 和 T04 之间无直接依赖。

---

### T05: 核心页面 + 报告向导组件 + 模板资源

**说明**：实现所有业务页面和报告生成的四步向导，完成应用的最后拼装。包含内置 HTML 模板文件。

**源文件**：
- `public/templates/*.html`（5 个内置报告模板）
- `src/components/report/StepWizard.tsx`
- `src/components/report/LogUploadStep.tsx`
- `src/components/report/ReportInfoStep.tsx`
- `src/components/report/TemplateSelectStep.tsx`
- `src/components/report/SubmitStep.tsx`
- `src/components/report/ProgressPanel.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/ScriptsPage.tsx`
- `src/pages/ReportCreatePage.tsx`
- `src/pages/ReportsPage.tsx`
- `src/pages/AssistantPage.tsx`
- `src/pages/UsersPage.tsx`
- `src/pages/ConversationsPage.tsx`
- `src/pages/SettingsPage.tsx`

**依赖**：T03, T04

**优先级**：P0

**并行说明**：依赖 T03（数据和业务逻辑）和 T04（布局和路由）。

---

## 6. 依赖包列表

### 6.1 npm 核心依赖

```
- react@^18.2.0: UI 框架
- react-dom@^18.2.0: React DOM 渲染
- react-router-dom@^6.20.0: 前端路由
- zustand@^4.4.0: 状态管理
- tailwindcss@^3.4.0: 原子化 CSS
- postcss@^8.4.0: CSS 处理
- autoprefixer@^10.4.0: CSS 前缀补全
- date-fns@^2.30.0: 日期处理
- idb@^7.1.1: IndexedDB Promise 封装
- lucide-react@^0.294.0: 图标库
- clsx@^2.0.0: 条件类名
- tailwind-merge@^2.0.0: Tailwind 类名合并
- class-variance-authority@^0.7.0: shadcn/ui 依赖
- @radix-ui/*: shadcn/ui 底层 headless 组件
- sonner@^1.0.0: Toast 通知（shadcn/ui 推荐）
```

### 6.2 开发依赖

```
- typescript@^5.3.0: 类型系统
- vite@^5.0.0: 构建工具
- @vitejs/plugin-react@^4.2.0: Vite React 插件
- @types/react@^18.2.0: React 类型
- @types/react-dom@^18.2.0: ReactDOM 类型
```

### 6.3 shadcn/ui 组件清单（安装命令）

```bash
npx shadcn-ui@latest add button card dialog dropdown-menu input label select table tabs textarea sonner badge avatar progress scroll-area sheet switch separator
```

### 6.4 AI SDK（项目环境提供）

```
- codebuddy-chat-web@latest: CodeBuddy Agent SDK（多轮对话、意图识别）
  说明：由项目环境预置或 init-cbc-sdk-web skill 初始化。
```

---

## 7. 共享知识（跨文件约定）

### 7.1 路由与权限

- **路由守卫实现位置**：`src/router/index.tsx` + `src/components/layout/RouteGuard.tsx`
- **权限校验逻辑**：`src/utils/permissions.ts` 提供 `canAccess(role, feature)` 函数
- **受保护路由**：所有非 `/login` 页面需 `authStore.isAuthenticated === true`
- **角色路由过滤**：`sidebar` 菜单项根据 `authStore.user.role` 动态渲染
- **路由常量**：统一使用 `src/constants/routes.ts` 中的路径常量，禁止硬编码字符串

### 7.2 数据存储 Key 命名约定

| 存储介质 | Key / StoreName | 用途 |
|----------|-----------------|------|
| localStorage | `srt_auth_token` | JWT Token（模拟） |
| localStorage | `srt_auth_user` | 当前登录用户缓存 |
| localStorage | `srt_ui_sidebar` | 侧边栏折叠状态 |
| IndexedDB | `smart_report_db` | 数据库名称 |
| IndexedDB ObjectStore | `users` | 用户表 |
| IndexedDB ObjectStore | `scripts` | 脚本表 |
| IndexedDB ObjectStore | `reports` | 报告表 |
| IndexedDB ObjectStore | `conversations` | 对话记录表 |
| IndexedDB ObjectStore | `templates` | 报告模板表 |

### 7.3 API 响应格式（服务层内部统一）

所有 Service 层函数返回 Promise，错误统一 throw Error，上层 Store/Hooks 捕获并处理：

```typescript
// 成功：直接返回数据
const user = await userService.getUserById('123');

// 失败：throw new Error('User not found')
```

### 7.4 日期格式约定

- 存储格式：`YYYY-MM-DDTHH:mm:ss.sssZ`（ISO 8601 UTC）
- 展示格式：`YYYY-MM-DD HH:mm`
- 使用 `date-fns` 的 `format()` 和 `parseISO()` 进行转换

### 7.5 文件上传约定

- 脚本文件：限制 `.sh`, `.py`, `.ps1`, `.txt` 等文本格式，最大 5MB
- 日志文件：限制 `.log`, `.txt`, `.csv`, `.json`，最大 20MB
- 上传文件在内存中暂存（`File[]`），提交时读取为文本存入 IndexedDB

### 7.6 颜色常量（Tailwind / CSS 变量）

```typescript
// src/constants/colors.ts
export const COLORS = {
  primary: '#2563EB',
  primaryDark: '#1E40AF',
  danger: '#DC2626',
  dangerLight: '#FEE2E2',
  success: '#16A34A',
  successLight: '#DCFCE7',
  bgGray: '#F8FAFC',
  cardWhite: '#FFFFFF',
  textPrimary: '#1E293B',
  textSecondary: '#64748B',
} as const;
```

### 7.7 角色权限矩阵常量

```typescript
// src/constants/roles.ts
export const PERMISSION_MATRIX: Record<UserRole, Record<string, boolean>> = {
  admin: { /* 全部 true */ },
  user: { /* 排除用户管理、对话记录 */ },
  readonly: { /* 仅报告下载、个人设置 */ },
};
```

---

## 8. 待明确事项

1. **CodeBuddy SDK 集成方式**：`aiService.ts` 中调用 CodeBuddy Agent SDK 的具体 API 签名和初始化方式需确认。假设 SDK 提供类似 `sendMessage(message, history)` 的 Promise 接口。
2. **用户密码安全**：纯前端环境无法使用 bcrypt（无 Node.js crypto 模块），计划使用简单哈希（如 SHA-256）或明文存储（MVP 降级）。建议明确是否接受明文或是否需要引入 Web Crypto API。
3. **报告模板内容**：5 个内置模板的 HTML 结构和占位符格式需补充设计稿或样例数据。
4. **AI 分析流程**：数据库日志调用 AI Agent 分析的输入输出格式、超时处理策略待确认。
5. **IndexedDB 数据迁移**：如果后续版本增加字段，是否需要迁移策略？当前 MVP 暂不考虑。
6. **报告文件导出格式**：PRD 明确为 HTML 格式下载，是否需要同时支持 PDF？当前按 HTML 实现。
