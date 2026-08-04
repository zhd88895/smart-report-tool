# 多厂商 AI 服务重构设计文档

> **日期**: 2026-07-28
> **状态**: 已获用户批准
> **方案**: 方案 A —— 统一 Provider 适配层 + 用户级配置库
> **影响范围**: 后端 AI 调用全链路 + 前端 AI 相关页面

---

## 1. 背景与问题

### 1.1 现状

项目内 AI 服务存在两套互不通气的实现：

- `services/aiProxy.ts`：AI 助手聊天使用，支持前端通过 localStorage 传厂商配置（MiMo/DeepSeek/Kimi 等 7 种预设）
- `services/aiService.ts`：报告 AI 分析、Agent 流程使用，写死读 `.env` 的 MiMo 配置，且对 MiMo 使用错误的 `Authorization: Bearer` 认证头（MiMo 要求 `api-key` 头无前缀），导致这些流程必然失败
- 数据库系统设置中的 `ai.vendor/ai.baseUrl/ai.model` 为死配置，未接入任何调用链路

### 1.2 已确认的故障根因

- 2026-07-03 的"AI 助手暂时无法响应"：前端 localStorage 存储的 `maxTokens=1048576` 超出 MiMo 模型上限（131072），厂商返回 400。后端后续加了钳制逻辑，当前 MiMo 聊天（流式/非流式）实测已连通，但 localStorage 中的异常值仍残留
- 报告分析/Agent 流程：认证头错误导致 401

### 1.3 需求（用户确认）

1. 配置存后端数据库，按用户隔离——每个用户管理自己的厂商/Key/模型，只能使用自己的配置
2. Cherry Studio 式完整能力：每用户多厂商（预设 9 种 + 自定义）、每厂商多模型、拉取远端模型列表、默认模型、测试连接、模型级参数（temperature/输入输出 Token 上限）、启用/禁用、用量统计
3. 全项目所有 AI 功能统一走这套配置；各功能入口可快速选择模型
4. 详细配置集中在左侧栏「系统设置」下的「AI设置」子页面
5. 前端优化仅限 AI 相关界面，其他页面后续再说

---

## 2. 数据模型（SQLite 新增 3 张表）

### 2.1 `user_ai_providers` —— 用户级 AI 厂商配置

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL | 隔离键，关联 users.id |
| vendor_key | TEXT | `mimo/deepseek/kimi/qwen/glm/minimax/lingyi/openai/custom`，用于查找厂商 quirks |
| name | TEXT | 显示名 |
| base_url | TEXT | API 地址 |
| api_key | TEXT | 密钥（API 返回时打码，仅更新时整体提交） |
| enabled | INTEGER | 0/1 停用开关 |
| sort_order | INTEGER | 列表排序 |
| created_at / updated_at | TEXT | ISO 时间 |

### 2.2 `user_ai_models` —— 厂商下的模型

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| provider_id | TEXT NOT NULL | 关联厂商，级联删除 |
| user_id | TEXT NOT NULL | 冗余隔离键，便于校验 |
| model_id | TEXT | API 模型标识（如 `deepseek-chat`） |
| display_name | TEXT | 显示名 |
| temperature | REAL | 默认 0.7 |
| max_input_tokens | INTEGER | 输入裁剪上限（超长截断最早的非 system 消息） |
| max_output_tokens | INTEGER | 输出上限（映射 `max_tokens` 或 MiMo 的 `max_completion_tokens`） |
| enabled | INTEGER | 0/1 |
| is_default | INTEGER | 每用户最多一个默认模型（服务层事务保证唯一） |
| created_at / updated_at | TEXT | |

### 2.3 `user_ai_usage_logs` —— 轻量用量记录

| 字段 | 说明 |
|---|---|
| id / user_id / model_id | 标识 |
| feature | 调用来源：`chat / analyze_file / agent / report_analysis` |
| prompt_tokens / completion_tokens | 用量 |
| created_at | 时间 |

### 2.4 厂商 quirks 注册表（后端常量，非数据库）

每个 `vendor_key` 声明：

- 认证方式：MiMo = `api-key` 头无前缀；其余 = `Authorization: Bearer`
- token 参数名：MiMo = `max_completion_tokens`；其余 = `max_tokens`
- 默认 baseUrl、预设模型列表

新增厂商只需加一条注册项。

### 2.5 设计要点

- 所有查询强制带 `user_id`；API 层从 JWT 取用户 ID，**不接受前端传 userId**
- 删除厂商级联删模型；删除默认模型时自动将同厂商最新启用模型顶为默认
- `is_default` 唯一性由服务层在事务中保证（先清后设）

---

## 3. API 设计

### 3.1 新增路由 `/api/ai-config/*`（全部 authenticate，userId 从 JWT 取）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ai-config/providers` | 我的厂商列表（含模型数，api_key 打码） |
| POST | `/api/ai-config/providers` | 新增厂商 |
| PUT | `/api/ai-config/providers/:id` | 修改厂商（apiKey 留空表示不改动） |
| DELETE | `/api/ai-config/providers/:id` | 删除厂商（级联删模型） |
| PUT | `/api/ai-config/providers/:id/toggle` | 启用/停用厂商 |
| GET | `/api/ai-config/providers/:id/models` | 某厂商下我的模型列表 |
| POST | `/api/ai-config/providers/:id/models` | 手动添加模型 |
| PUT | `/api/ai-config/models/:id` | 修改模型参数 |
| DELETE | `/api/ai-config/models/:id` | 删除模型 |
| PUT | `/api/ai-config/models/:id/toggle` | 启用/停用模型 |
| PUT | `/api/ai-config/models/:id/set-default` | 设为默认模型 |
| POST | `/api/ai-config/providers/:id/fetch-models` | 拉取远端模型列表，返回未添加的差量，支持批量导入 |
| POST | `/api/ai-config/test-connection` | 测试连接（厂商配置或 providerId，发 1-token 请求验证） |
| GET | `/api/ai-config/resolved` | 我的默认模型 + 全部启用模型精简列表（模型选择器数据源） |
| GET | `/api/ai-config/usage` | 我的用量统计（按模型/功能聚合，近 30 天） |

### 3.2 改造现有 AI 接口（路径不变）

| 接口 | 变化 |
|---|---|
| POST `/api/ai/chat`、`/api/ai/chat/stream` | 不再接受前端 `config`，改为可选 `modelId`；后端按 userId 解析配置 |
| POST `/api/ai/models` | 废弃，由 fetch-models 取代 |
| GET `/api/ai/status` | 语义改为「当前用户是否有可用默认模型」 |
| POST `/api/ai/analyze-file` | 去掉 `config` 字段，加可选 `modelId` |
| Agent / 报告分析 | `agentService`、`analysisService`、`aiAnalysisWithTools` 改调 `callUserAI(userId, …)` |

### 3.3 统一调用入口

```ts
callUserAI(userId, { messages, modelId?, stream, feature, temperature?, maxOutputTokens? })
  → 解析模型（指定或默认）→ 查厂商 quirks → 组装认证头和 token 参数
  → 输入超 max_input_tokens 时截断最早的非 system 消息
  → 调用厂商 API（流式/非流式）→ 写 usage_logs → 返回
```

### 3.4 错误处理与安全

- 未配置任何模型 → 400「请先在 AI 设置中配置模型」
- 厂商 401 → 提示检查 Key；429 → 提示限流；超时 120s
- api_key 出库即打码；所有 SQL 带 user_id；test-connection 不持久化

---

## 4. 后端调用链改造清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `services/aiProviderService.ts` | 新增 | quirks 注册表 + `callUserAI`（流式/非流式）+ 模型解析 + Token 截断 + 用量记录 |
| `services/userAIConfigService.ts` | 新增 | 厂商/模型 CRUD、默认唯一性、Key 打码、迁移种子 |
| `db/repositories/userAIConfigRepository.ts` | 新增 | 三张新表数据访问 |
| `db/database.ts` | 修改 | 新表 DDL（user_id 索引）；移除死配置种子 |
| `routes/aiConfig.ts` | 新增 | `/api/ai-config/*` 全部端点 |
| `routes/ai.ts` | 修改 | chat/stream/analyze-file 走 `callUserAI`；status 改语义 |
| `services/agentService.ts` | 修改 | `aiService.callAI` → `callUserAI(userId, …)` |
| `services/analysisService.ts` | 修改 | 同上（两处调用） |
| `services/aiAnalysisWithTools.ts` | 修改 | 同上 |
| `services/aiProxy.ts` | 删除 | 功能并入 aiProviderService |
| `services/aiService.ts` | 删除 | 旧类实现废弃（Function Calling 类型并入 aiProviderService） |
| `routes/agent.ts`、`routes/analysis.ts` | 小改 | JWT userId 透传 service |
| `config.ts` | 保留 | `MIMO_*` 仅作迁移种子与零配置兜底 |

---

## 5. 前端设计

### 5.1 新增「AI设置」页 `/settings/ai`

左侧栏「系统设置」改为可展开分组，下挂「系统设置」「AI设置」子项；路由守卫与系统设置同级。

布局：

```
┌─────────────────────────────────────────────┐
│ AI 设置                        [+ 添加厂商]  │
├──────────────┬──────────────────────────────┤
│ 厂商列表      │  当前选中厂商的模型管理        │
│ ▸ 小米 MiMo   │  ┌────────────────────────┐ │
│   2 个模型    │  │ ● mimo-v2.5-pro [默认] │ │
│ ▸ DeepSeek   │  │   温度 0.7  输出 4096   │ │
│   1 个模型    │  │   [编辑][停用][删除]    │ │
│              │  ├────────────────────────┤ │
│              │  │ ○ mimo-v2.5-flash      │ │
│              │  └────────────────────────┘ │
│              │  [拉取模型列表] [+ 手动添加]  │
├──────────────┴──────────────────────────────┤
│ 用量统计（近30天，按模型/功能聚合）           │
└─────────────────────────────────────────────┘
```

- 厂商卡片：显示名、vendor、baseUrl、打码 Key、启用开关、编辑/删除
- 添加/编辑厂商弹窗：厂商类型下拉（9 种预设，选中自动填 baseUrl）→ 填 Key → 「测试连接」→ 保存
- 模型编辑弹窗：显示名、temperature 滑块、输入/输出 Token 上限、设为默认
- 「拉取模型列表」：弹出差量列表勾选导入

### 5.2 改造现有页面/组件

| 页面/组件 | 改动 |
|---|---|
| `stores/aiConfigStore.ts` | 重写：不再 persist localStorage，改从 `/api/ai-config/resolved` 拉取；保留一次性迁移函数 |
| `components/ai/ModelSelector.tsx` | 显示当前默认模型；下拉按厂商分组列出启用模型；选择写入会话级 modelId |
| `components/ai/AIConfigDialog.tsx` | 删除；配置缺失改为引导条 + 跳转 AI 设置 |
| `pages/AssistantPage.tsx` | 新 ModelSelector + 未配置引导 |
| `pages/AgentPage.tsx` | 同上（注意：该页当前未挂路由，保持现状不额外处理） |
| `components/report/AIAnalysisPanel.tsx` | 加同款模型选择器，去掉 config 传参 |
| `services/aiService.ts`（前端） | 删除 `getConfig()`，请求改传 `modelId?` |
| `pages/AISettingsPage.tsx` | 新增 |
| `components/layout/Sidebar.tsx`、`constants/routes.ts`、`router/index.tsx` | 新增 AI 设置入口与路由 |

设计规范：沿用现有蓝白风格（`#2563EB` 主色、shadcn/ui、圆角卡片），复用 DataTable/Dialog/Select/Switch 组件。

---

## 6. 迁移与兼容

1. **localStorage → 数据库（一次性，幂等）**：新 store 初始化检测旧 `ai-vendor-config`，含 apiKey 且库中无厂商时自动入库（`maxTokens` 1048576 修正为 4096），成功后清除旧数据；失败不阻塞，下次重试
2. **`.env` 兜底**：用户无任何启用模型且 `MIMO_API_KEY` 有效时，以系统兜底配置调用（不写库），响应头标记 `X-AI-Fallback: true`，前端显示「正在使用系统默认配置」提示条
3. **数据库**：新表 DDL 走现有启动建表机制 `IF NOT EXISTS`，老库平滑升级
4. **死配置清理**：`ai.vendor/ai.baseUrl/ai.model` 从种子数据移除（存量数据保留但无链路引用）
5. **兼容**：旧前端传 `config` 字段被忽略不报错；历史 conversations 不受影响

---

## 7. 测试方案

| 层 | 内容 |
|---|---|
| 后端验证 | 厂商 CRUD 隔离性（A 用户访问 B 用户资源返回 404）；默认模型唯一性；Key 打码；quirks 认证头正确性（MiMo `api-key` vs 标准 `Bearer`） |
| 端到端（浏览器实测） | ① 旧 localStorage 自动迁移入库 ② AI 设置：添加厂商→测试连接→拉模型→设默认 ③ AI 助手：默认/切换模型聊天 ④ 报告生成 AI 分析走指定模型 ⑤ 用户隔离：test 账号看不到 admin 配置 ⑥ 兜底：删光配置后 .env 接管并显示提示条 |
| 回归 | 脚本生成报告、知识库、用户管理等非 AI 功能不受影响 |

## 8. 验收标准

- 全项目不再有代码直接读 `MIMO_*` 环境变量发起 AI 调用（兜底逻辑除外）
- 每个 AI 功能入口均可选择模型
- `aiProxy.ts`、`aiService.ts` 两套旧实现删除
- AI 助手不再出现"暂时无法响应"
