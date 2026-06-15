# 智能报告生成工具 - 增量架构设计

## 1. 变更文件清单

### 1.1 现有文件修改

| 文件 | 变更内容 |
|------|----------|
| `src/types/index.ts` | UserRole 扩展、新增 UserStatus/ScriptType/ExecutionLog 类型、User/Script 接口变更、FeatureKey 扩展 |
| `src/constants/roles.ts` | 权限矩阵重构为 admin/senior/member 三级 |
| `src/services/db.ts` | DB_VERSION 升级至 2，新增 executionLogs store |
| `src/services/authService.ts` | 新增注册逻辑、登录时 status 校验 |
| `src/services/userService.ts` | 新增审批/拒绝用户、修改角色功能 |
| `src/services/scriptService.ts` | 新增执行脚本、获取执行记录功能 |
| `src/stores/authStore.ts` | 支持注册状态、status 校验 |
| `src/stores/scriptStore.ts` | 支持执行脚本、管理执行记录 |
| `src/stores/userStore.ts` | 支持待审核用户列表、审批操作 |
| `src/pages/LoginPage.tsx` | 移除默认账号提示，增加注册入口 |
| `src/pages/ScriptsPage.tsx` | 扩展上传表单、增加执行按钮、展示执行记录 |
| `src/pages/UsersPage.tsx` | 增加待审核 Tab、批准/拒绝按钮、角色修改 |
| `src/pages/SettingsPage.tsx` | 增加账户状态展示 |
| `src/router/index.tsx` | 新增 /register 路由 |

### 1.2 新增文件

| 文件 | 说明 |
|------|------|
| `src/pages/RegisterPage.tsx` | 用户注册页面 |
| `src/components/script/ScriptExecutor.tsx` | 脚本执行对话框组件 |
| `src/components/script/ExecutionLogViewer.tsx` | 执行日志展示组件 |
| `src/hooks/useScriptExecution.ts` | 脚本执行相关 hook |

## 2. 数据模型变更

### 2.1 User 接口变更

```ts
export type UserRole = 'admin' | 'senior' | 'member';
export type UserStatus = 'pending' | 'active' | 'rejected';

export interface User {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
  status: UserStatus;  // 新增
  createdAt: string;
}
```

### 2.2 Script 接口变更

```ts
export type ScriptType = 'python' | 'bat' | 'ps1' | 'sh' | 'powershell';

export interface Script {
  id: string;
  name: string;
  description: string;        // 新增
  scriptType: ScriptType;     // 新增
  version: string;            // 新增
  category: LogCategory;
  fileName: string;
  fileSize: number;
  content: string;
  uploadedAt: string;
  uploadedBy: string;
}
```

### 2.3 ExecutionLog 接口（新增）

```ts
export interface ExecutionLog {
  id: string;
  scriptId: string;
  scriptName: string;
  executedBy: string;
  executedById: string;
  targetHost?: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  output: string[];
  startedAt: string;
  completedAt?: string;
}
```

### 2.4 FeatureKey 扩展

```ts
export type FeatureKey =
  | 'dashboard'
  | 'scripts'
  | 'scriptExecute'
  | 'reportCreate'
  | 'reports'
  | 'deleteReport'
  | 'assistant'
  | 'users'
  | 'conversations'
  | 'settings'
  | 'downloadReport'
  | 'approveUser';
```

## 3. 数据库升级方案

```ts
const DB_VERSION = 2;

// upgrade 回调中新增 executionLogs store
if (!db.objectStoreNames.contains('executionLogs')) {
  db.createObjectStore('executionLogs', { keyPath: 'id' });
}
```

## 4. 权限控制更新

```ts
export const ROLE_PERMISSIONS: Record<UserRole, Record<FeatureKey, boolean>> = {
  admin: { /* 全部 true */ },
  senior: {
    dashboard: true,
    scripts: true,
    scriptExecute: true,
    reportCreate: true,
    reports: true,
    deleteReport: true,
    assistant: true,
    users: false,
    conversations: false,
    settings: true,
    downloadReport: true,
    approveUser: false,
  },
  member: {
    dashboard: false,
    scripts: false,
    scriptExecute: false,
    reportCreate: true,
    reports: true,
    deleteReport: false,
    assistant: true,
    users: false,
    conversations: false,
    settings: true,
    downloadReport: true,
    approveUser: false,
  },
};
```

## 5. 任务列表（有序）

| 批次 | 任务 | 文件 | 依赖 |
|------|------|------|------|
| T01 | 类型定义更新 | `src/types/index.ts` | 无 |
| T01 | 常量更新 | `src/constants/roles.ts` | types |
| T02 | 数据库升级 | `src/services/db.ts` | types |
| T02 | 认证服务更新 | `src/services/authService.ts` | db |
| T02 | 用户服务更新 | `src/services/userService.ts` | db |
| T02 | 脚本服务更新 | `src/services/scriptService.ts` | db |
| T03 | Store 更新（auth/script/user） | `src/stores/*.ts` | services |
| T04 | 新增组件 | `src/components/script/*.tsx` | stores |
| T04 | Hooks 更新 | `src/hooks/*.ts` | stores |
| T05 | 页面更新（Login/Scripts/Users/Settings） | `src/pages/*.tsx` | hooks+components |
| T05 | 新增注册页面 | `src/pages/RegisterPage.tsx` | hooks |
| T05 | 路由更新 | `src/router/index.tsx` | pages |
| T06 | 构建验证 | `npm run build` | 全部 |
