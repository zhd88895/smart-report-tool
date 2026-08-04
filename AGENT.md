# 智能报告生成工具 - 项目规范

> **版本**: v0.3.2  
> **日期**: 2026-07-06  
> **项目负责人**: 郑工  
> **状态**: 开发中

---

## 项目概述

智能报告生成工具是一个面向 IT 运维团队的自动化巡检报告生成平台，核心能力是：**上传巡检脚本 → 批量导入巡检数据 → 后端真实执行脚本 → 自动识别并输出格式化报告**。

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端框架** | React 18 + TypeScript + Vite 5 | 主流选型，现代化开发 |
| **UI 组件** | Tailwind CSS + shadcn/ui | 可定制性强，样式统一 |
| **状态管理** | Zustand | 轻量简洁，适合中等规模应用 |
| **路由** | React Router v6 | 标准选型 |
| **后端** | Express + TypeScript | 模块化架构，零框架依赖 |
| **数据存储** | SQLite | 轻量级关系型数据库 |
| **实时通信** | SSE (Server-Sent Events) | 单向日志推送 |
| **Python 环境** | 内嵌 Python + virtualenv | 隔离性好，支持多版本 |

---

## 项目结构

```
smart-report-tool/
├── smart-report-server/          # 后端服务
│   ├── src/                      # TypeScript 源码
│   │   ├── config.ts             # 配置管理
│   │   ├── index.ts              # 主入口
│   │   ├── types.ts              # 类型定义
│   │   ├── db/                   # 数据库层
│   │   ├── middleware/           # 中间件
│   │   ├── routes/               # 路由模块
│   │   ├── services/             # 业务服务
│   │   └── utils/                # 工具函数
│   ├── data/                     # 数据存储目录
│   └── package.json
├── smart-report-tool/            # 前端应用
│   ├── src/                      # TypeScript 源码
│   │   ├── components/           # 组件库
│   │   ├── pages/                # 页面组件
│   │   ├── stores/               # 状态管理
│   │   ├── services/             # API 服务
│   │   ├── types/                # 类型定义
│   │   ├── router/               # 路由配置
│   │   └── utils/                # 工具函数
│   ├── public/                   # 静态资源
│   └── package.json
├── scripts/                      # 脚本工具
├── docs/                         # 项目文档
└── .workbuddy/                   # WorkBuddy 配置
```

---

## 开发规范

### 1. 代码风格

#### TypeScript 规范
- 使用 TypeScript 严格模式
- 优先使用 `interface` 而非 `type` 定义对象结构
- 函数和变量使用 camelCase 命名
- 类和接口使用 PascalCase 命名
- 常量使用 UPPER_SNAKE_CASE 命名
- 使用 `readonly` 修饰不可变属性

#### React 规范
- 使用函数组件 + Hooks
- 组件文件使用 PascalCase 命名
- 使用 TypeScript 定义 Props 类型
- 避免使用 `any` 类型
- 使用 Zustand 进行状态管理
- 使用 React Router v6 进行路由管理

#### CSS 规范
- 使用 Tailwind CSS 进行样式开发
- 遵循 shadcn/ui 组件库规范
- 使用 CSS 变量管理主题颜色
- 响应式设计：优先移动端适配

### 2. 文件组织

#### 组件文件结构
```typescript
// ComponentName.tsx
import React from 'react';
import { ComponentProps } from './types';

interface ComponentNameProps extends ComponentProps {
  // Props 定义
}

export function ComponentName({ ...props }: ComponentNameProps) {
  // 组件实现
}
```

#### 页面文件结构
```typescript
// PageName.tsx
import React from 'react';
import { PageProps } from './types';

export default function PageName() {
  // 页面实现
}
```

### 3. 状态管理

使用 Zustand 进行状态管理：

```typescript
// stores/exampleStore.ts
import { create } from 'zustand';

interface ExampleState {
  // 状态定义
  data: any[];
  isLoading: boolean;
  
  // Actions
  fetchData: () => Promise<void>;
  updateData: (newData: any[]) => void;
}

export const useExampleStore = create<ExampleState>((set, get) => ({
  data: [],
  isLoading: false,
  
  fetchData: async () => {
    set({ isLoading: true });
    // API 调用
    set({ isLoading: false });
  },
  
  updateData: (newData) => {
    set({ data: newData });
  },
}));
```

### 4. API 服务

使用统一的 API 服务层：

```typescript
// services/apiService.ts
const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  
  return response.json();
}

export const apiService = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, data: any) =>
    request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // ... 其他方法
};
```

---

## 默认 Skills 配置

本项目默认使用以下 Skills 进行开发：

### 1. Impeccable（前端设计工具集）
- **用途**: 创建高质量的前端界面
- **适用场景**: 
  - 组件设计与实现
  - 页面布局开发
  - 样式优化
  - 响应式设计

### 2. Superpowers Brainstorming
- **用途**: 创意工作前的探索和规划
- **适用场景**:
  - 新功能开发前
  - 技术方案设计
  - 问题分析与解决

### 3. ponytail
- **用途**: 懒人模式，YAGNI 原则优先
- **适用场景**:
  - 代码编写
  - 重构
  - Bug 修复
  - 代码审查

### 4. ponytail-audit
- **用途**: 审查整个仓库的过度工程
- **适用场景**:
  - 代码质量审查
  - 架构优化
  - 删除不必要的抽象

### 5. 前端开发
- **用途**: 完整的前端开发流程
- **适用场景**:
  - Web 前端开发
  - 组件集成
  - 性能优化
  - 部署验证

---

## 开发工作流

### 1. 功能开发流程

1. **需求分析**: 使用 Superpowers Brainstorming 进行探索
2. **技术设计**: 制定实现方案
3. **代码实现**: 使用 ponytail 进行编码
4. **UI 设计**: 使用 Impeccable 进行界面设计
5. **代码审查**: 使用 ponytail-audit 进行审查
6. **测试验证**: 确保功能正常
7. **文档更新**: 更新相关文档

### 2. Bug 修复流程

1. **问题定位**: 分析问题根源
2. **方案设计**: 制定修复方案
3. **代码修复**: 使用 ponytail 进行修复
4. **测试验证**: 确保修复有效
5. **回归测试**: 确保不影响其他功能

### 3. 代码审查流程

1. **自审**: 使用 ponytail-audit 进行自查
2. **互审**: 团队成员交叉审查
3. **修改**: 根据审查意见修改
4. **确认**: 最终确认合并

---

## 架构规范

### 1. 前端架构

- **组件化**: 使用 React 组件化开发
- **状态管理**: 使用 Zustand 管理全局状态
- **路由管理**: 使用 React Router v6 管理路由
- **API 服务**: 统一的 API 服务层
- **类型安全**: 严格的 TypeScript 类型定义

### 2. 后端架构

- **模块化**: 使用 Express 模块化架构
- **分层设计**: 路由 → 服务 → 数据访问层
- **配置管理**: 统一的配置管理
- **错误处理**: 统一的错误处理机制
- **日志系统**: 分级日志系统

### 3. 数据存储

- **SQLite**: 使用 SQLite 存储结构化数据
- **文件系统**: 使用文件系统存储脚本、模板、报告等文件
- **路径规范**: 所有路径使用相对路径，禁用绝对路径

---

## 安全规范

### 1. 认证授权

- 使用 HttpOnly Cookie + 服务端会话
- 支持"记住我"功能
- 空闲超时检测
- 角色权限控制

### 2. 数据安全

- 密码使用 bcrypt 加密
- 敏感信息脱敏处理
- SQL 注入防护
- XSS 防护

### 3. 文件安全

- 文件上传类型验证
- 文件大小限制
- 文件内容检查
- 路径遍历防护

---

## 性能规范

### 1. 前端性能

- 代码分割与懒加载
- 图片优化
- 缓存策略
- 虚拟滚动

### 2. 后端性能

- 数据库索引优化
- 查询优化
- 缓存策略
- 异步处理

---

## 测试规范

### 1. 单元测试

- 使用 Jest 进行单元测试
- 覆盖核心业务逻辑
- 覆盖工具函数

### 2. 集成测试

- API 接口测试
- 组件集成测试
- 端到端测试

### 3. 测试覆盖率

- 核心模块覆盖率 > 80%
- 工具函数覆盖率 > 90%

---

## 文档规范

### 1. 代码文档

- 使用 JSDoc 注释
- 复杂逻辑添加注释
- 公共 API 必须文档化

### 2. 项目文档

- README.md: 项目概述和快速开始
- API 文档: 接口说明文档
- 部署文档: 部署指南

### 3. 变更日志

- 使用 CHANGELOG.md 记录版本变更
- 遵循语义化版本控制

---

## 工具配置

### 1. 开发工具

- **IDE**: VS Code / WebStorm
- **版本控制**: Git
- **包管理**: npm / pnpm
- **代码格式化**: Prettier
- **代码检查**: ESLint

### 2. 构建工具

- **前端**: Vite
- **后端**: TypeScript 编译
- **打包**: 优化生产构建

### 3. 部署工具

- **容器化**: Docker（可选）
- **CI/CD**: GitHub Actions（可选）
- **监控**: 日志系统 + 性能监控

---

## 环境要求

### 开发环境

- Node.js 18+
- npm 8+ 或 pnpm 8+
- Python 3.6-3.14（内嵌 Python）
- Git 2.30+

### 运行环境

- Node.js 18+
- Python 3.6-3.14（内嵌 Python）
- SQLite 3.35+

---

## 版本控制

### 分支策略

- `main`: 主分支，稳定版本
- `develop`: 开发分支
- `feature/*`: 功能分支
- `bugfix/*`: 修复分支
- `release/*`: 发布分支

### 提交规范

使用 Conventional Commits 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

类型：
- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关

---

## 附录

### 1. 常用命令

```bash
# 启动后端
cd smart-report-server && npm run dev

# 启动前端
cd smart-report-tool && npm run dev

# 构建前端
cd smart-report-tool && npm run build

# 运行测试
npm test

# 代码检查
npm run lint
```

### 2. 配置文件

- `.env`: 环境变量配置
- `tsconfig.json`: TypeScript 配置
- `vite.config.ts`: Vite 配置
- `tailwind.config.js`: Tailwind 配置

### 3. 联系方式

- 项目负责人: 郑工
- 技术支持: WorkBuddy AI 助手

---

*最后更新：2026-07-06 — 由 WorkBuddy AI 助手创建*