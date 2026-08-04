# 多厂商 AI 服务重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全项目 AI 服务重构为 Cherry Studio 式的「用户级多厂商多模型」体系：配置存 SQLite、按用户隔离、统一调用入口、新增 AI 设置页。

**Architecture:** 后端新增 `user_ai_providers`/`user_ai_models`/`user_ai_usage_logs` 三表 + 厂商 quirks 注册表 + 统一调用入口 `callUserAI(userId, req)`，删除 `aiProxy.ts`/`aiService.ts` 两套旧实现；前端 `aiConfigStore` 重写为服务端数据源，新增 `/settings/ai` 页面，各 AI 功能页接入模型选择器。

**Tech Stack:** Express + TypeScript（tsx）+ sqlite3（allAsync/getAsync/runAsync 封装）+ React 18 + Zustand + shadcn/ui。

**设计文档:** `docs/superpowers/specs/2026-07-28-multi-vendor-ai-design.md`

## Global Constraints

- 后端路径相对 `smart-report-server/`，前端相对 `smart-report-tool/`
- API 响应统一 `{ code, data, message, error? }`（`ApiResponse<T>`，见 `src/types.ts`）
- 所有 SQL 查询强制带 `user_id`；userId 只从 `req.user.userId`（JWT 会话）获取，禁止接受前端传 userId
- api_key 出 API 必须打码：`key.slice(0,6) + '***' + key.slice(-4)`，长度不足时只返回 `***`
- 项目无测试框架；验证方式为「tsx 一次性脚本 + curl API 实测 + 浏览器端到端」，验证脚本放 `smart-report-server/scripts/` 用 `npx tsx` 运行，跑完即弃
- 每个 Task 完成后提交 git，提交信息用 Conventional Commits
- 后端改动后 tsx watch 自动重载；前端 vite 热更新；验证前端用浏览器（kimi-webbridge，session 名 `smart-report-ai`）
- 代码注释用中文，风格与现有文件一致

---

### Task 1: 数据库三表 + userAIConfigRepository

**Files:**
- Modify: `smart-report-server/src/db/database.ts`（createSchema 的 schema 模板字符串内追加 DDL）
- Create: `smart-report-server/src/db/repositories/userAIConfigRepository.ts`
- Test: `smart-report-server/scripts/verify-ai-config-repo.ts`（一次性验证脚本）

**Interfaces:**
- Consumes: `allAsync/getAsync/runAsync` from `../database`
- Produces（后续 Task 依赖的精确签名）:

```ts
export interface UserAIProvider {
  id: string; user_id: string; vendor_key: string; name: string;
  base_url: string; api_key: string; enabled: number; sort_order: number;
  created_at: string; updated_at: string;
}
export interface UserAIModel {
  id: string; provider_id: string; user_id: string; model_id: string;
  display_name: string; temperature: number; max_input_tokens: number;
  max_output_tokens: number; enabled: number; is_default: number;
  created_at: string; updated_at: string;
}
export interface UserAIUsageLog {
  id: string; user_id: string; model_id: string; feature: string;
  prompt_tokens: number; completion_tokens: number; created_at: string;
}
export const userAIConfigRepository: {
  listProviders(userId: string): Promise<UserAIProvider[]>;
  getProvider(userId: string, id: string): Promise<UserAIProvider | null>;
  createProvider(userId: string, data: { vendor_key: string; name: string; base_url: string; api_key: string }): Promise<UserAIProvider>;
  updateProvider(userId: string, id: string, patch: Partial<Pick<UserAIProvider,'name'|'base_url'|'api_key'|'enabled'|'sort_order'>>): Promise<void>;
  deleteProvider(userId: string, id: string): Promise<void>;
  listModels(userId: string, providerId?: string): Promise<UserAIModel[]>;
  getModel(userId: string, id: string): Promise<UserAIModel | null>;
  createModel(userId: string, providerId: string, data: { model_id: string; display_name?: string }): Promise<UserAIModel>;
  updateModel(userId: string, id: string, patch: Partial<Pick<UserAIModel,'display_name'|'temperature'|'max_input_tokens'|'max_output_tokens'|'enabled'>>): Promise<void>;
  deleteModel(userId: string, id: string): Promise<void>;
  setDefaultModel(userId: string, id: string): Promise<void>;
  getDefaultModel(userId: string): Promise<(UserAIModel & { provider: UserAIProvider }) | null>;
  getModelWithProvider(userId: string, id: string): Promise<(UserAIModel & { provider: UserAIProvider }) | null>;
  logUsage(entry: { user_id: string; model_id: string; feature: string; prompt_tokens: number; completion_tokens: number }): Promise<void>;
  getUsageStats(userId: string, days: number): Promise<Array<{ model_id: string; feature: string; prompt_total: number; completion_total: number; calls: number }>>;
}
```

- [ ] **Step 1: 追加 DDL**

在 `createSchema()` 的 schema 模板字符串末尾（`idx_kb_files_title` 索引之后、反引号之前）追加：

```sql
    -- 用户级 AI 厂商配置表
    CREATE TABLE IF NOT EXISTS user_ai_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      vendor_key TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 用户级 AI 模型表
    CREATE TABLE IF NOT EXISTS user_ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT,
      temperature REAL DEFAULT 0.7,
      max_input_tokens INTEGER DEFAULT 128000,
      max_output_tokens INTEGER DEFAULT 4096,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES user_ai_providers(id) ON DELETE CASCADE
    );

    -- AI 用量记录表
    CREATE TABLE IF NOT EXISTS user_ai_usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uai_providers_user ON user_ai_providers(user_id);
    CREATE INDEX IF NOT EXISTS idx_uai_models_user ON user_ai_models(user_id);
    CREATE INDEX IF NOT EXISTS idx_uai_models_provider ON user_ai_models(provider_id);
    CREATE INDEX IF NOT EXISTS idx_uai_usage_user ON user_ai_usage_logs(user_id, created_at);
```

同时删除 `seedDefaultSettings()` 中三条死配置种子（`ai.vendor`、`ai.baseUrl`、`ai.model`，约在 database.ts 第 569-571 行）。

- [ ] **Step 2: 创建 userAIConfigRepository.ts**

完整实现（模式参照 `knowledgeBaseRepository.ts`，ID 格式 `uaip_*/uaim_*/uail_` + Date.now + 随机串）。要点：
- `setDefaultModel`：先 `UPDATE user_ai_models SET is_default=0 WHERE user_id=?`，再 `UPDATE ... SET is_default=1 WHERE id=? AND user_id=?`
- `deleteModel`：删除后若删的是默认模型，自动 `UPDATE` 同用户最新启用模型为默认
- `getDefaultModel`/`getModelWithProvider`：JOIN providers，要求 provider.enabled=1 且 model.enabled=1
- `getUsageStats`：`WHERE user_id=? AND created_at >= datetime('now', ?)` 传 `-${days} days`，GROUP BY model_id, feature

- [ ] **Step 3: 验证脚本**

`scripts/verify-ai-config-repo.ts`：initDatabase → 为测试用户 `verify_user_1` 创建厂商+两个模型 → setDefault → getDefaultModel 断言 → 创建第二个用户 `verify_user_2` 断言 `getProvider('verify_user_2', 第一个厂商id)` 返回 null（隔离性）→ logUsage + getUsageStats 断言 → 清理测试数据。运行 `npx tsx scripts/verify-ai-config-repo.ts`，期望输出全部 `✓`。

- [ ] **Step 4: Commit**

```bash
git add smart-report-server/src/db/database.ts smart-report-server/src/db/repositories/userAIConfigRepository.ts
git commit -m "feat(server): 新增用户级AI配置三表与仓储层"
```

---

### Task 2: aiProviderService —— 厂商 quirks 注册表 + 统一调用入口

**Files:**
- Create: `smart-report-server/src/services/aiProviderService.ts`
- Test: `smart-report-server/scripts/verify-ai-provider.ts`

**Interfaces:**
- Consumes: Task 1 的 `userAIConfigRepository`；`getConfig()` from `../config`（MIMO_* 兜底）
- Produces:

```ts
export type VendorKey = 'mimo'|'deepseek'|'kimi'|'qwen'|'glm'|'minimax'|'lingyi'|'openai'|'custom';
export interface VendorQuirks {
  key: VendorKey; name: string; defaultBaseUrl: string;
  authHeader: string; authPrefix: string;
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  defaultModels: string[];
}
export const VENDOR_QUIRKS: Record<VendorKey, VendorQuirks>;
export interface AIMessage {
  role: 'system'|'user'|'assistant'|'tool';
  content: string | null;
  tool_calls?: AIToolCall[]; tool_call_id?: string;
}
export interface AIToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface AIToolDefinition { type: 'function'; function: { name: string; description: string; parameters: any } }
export interface UserAIRequest {
  messages: AIMessage[]; modelId?: string; feature: 'chat'|'analyze_file'|'agent'|'report_analysis';
  tools?: AIToolDefinition[]; temperature?: number; maxOutputTokens?: number;
}
export interface UserAIResponse {
  message: string; toolCalls?: AIToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string; provider: string; fallback: boolean;
}
export async function callUserAI(userId: string, req: UserAIRequest): Promise<UserAIResponse>;
export async function callUserAIStream(userId: string, req: UserAIRequest): Promise<{ stream: ReadableStream<Uint8Array>; model: string; provider: string; fallback: boolean }>;
export async function fetchRemoteModels(provider: UserAIProvider): Promise<string[]>;
export async function testProviderConnection(provider: Pick<UserAIProvider,'vendor_key'|'base_url'|'api_key'>): Promise<{ ok: boolean; error?: string }>;
```

- [ ] **Step 1: quirks 注册表**

```ts
export const VENDOR_QUIRKS: Record<VendorKey, VendorQuirks> = {
  mimo:    { key:'mimo',    name:'小米 MiMo',  defaultBaseUrl:'https://token-plan-cn.xiaomimimo.com/v1',        authHeader:'api-key',       authPrefix:'',        tokenParam:'max_completion_tokens', defaultModels:['mimo-v2.5-pro','mimo-v2.5-flash'] },
  deepseek:{ key:'deepseek',name:'DeepSeek',   defaultBaseUrl:'https://api.deepseek.com/v1',                    authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',            defaultModels:['deepseek-chat','deepseek-reasoner'] },
  kimi:    { key:'kimi',    name:'Kimi',       defaultBaseUrl:'https://api.moonshot.cn/v1',                     authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',            defaultModels:['kimi-k2-0905-preview','moonshot-v1-8k'] },
  qwen:    { key:'qwen',    name:'通义千问',    defaultBaseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',           defaultModels:['qwen-plus','qwen-turbo'] },
  glm:     { key:'glm',     name:'智谱 GLM',   defaultBaseUrl:'https://open.bigmodel.cn/api/paas/v4',           authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',            defaultModels:['glm-4-plus','glm-4-flash'] },
  minimax: { key:'minimax', name:'MiniMax',    defaultBaseUrl:'https://api.minimax.chat/v1',                    authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',            defaultModels:['abab6.5s-chat'] },
  lingyi:  { key:'lingyi',  name:'零一万物',    defaultBaseUrl:'https://api.lingyiwanwu.com/v1',                 authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',           defaultModels:['yi-large'] },
  openai:  { key:'openai',  name:'OpenAI',     defaultBaseUrl:'https://api.openai.com/v1',                      authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',            defaultModels:['gpt-4o','gpt-4o-mini'] },
  custom:  { key:'custom',  name:'自定义',      defaultBaseUrl:'',                                               authHeader:'Authorization', authPrefix:'Bearer ', tokenParam:'max_tokens',            defaultModels:[] },
};
```

- [ ] **Step 2: 配置解析（含 .env 兜底）**

```ts
interface ResolvedConfig {
  apiKey: string; baseUrl: string; model: string;
  maxInputTokens: number; maxOutputTokens: number; temperature: number;
  quirks: VendorQuirks; modelDbId: string | null; providerName: string; fallback: boolean;
}

async function resolveConfig(userId: string, modelId?: string): Promise<ResolvedConfig> {
  const row = modelId
    ? await userAIConfigRepository.getModelWithProvider(userId, modelId)
    : await userAIConfigRepository.getDefaultModel(userId);
  if (row) {
    const quirks = VENDOR_QUIRKS[row.provider.vendor_key as VendorKey] ?? VENDOR_QUIRKS.custom;
    return {
      apiKey: row.provider.api_key, baseUrl: row.provider.base_url,
      model: row.model_id, maxInputTokens: row.max_input_tokens,
      maxOutputTokens: row.max_output_tokens, temperature: row.temperature,
      quirks, modelDbId: row.id, providerName: row.provider.name, fallback: false,
    };
  }
  // .env 兜底：用户无启用模型且 MIMO_API_KEY 有效
  const env = getConfig();
  if (env.MIMO_API_KEY && !env.MIMO_API_KEY.startsWith('tp-xxxxx')) {
    return {
      apiKey: env.MIMO_API_KEY, baseUrl: env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
      model: env.MIMO_MODEL || 'mimo-v2.5-pro', maxInputTokens: 128000,
      maxOutputTokens: Math.min(env.MIMO_MAX_TOKENS || 4096, 131072), temperature: 0.7,
      quirks: VENDOR_QUIRKS.mimo, modelDbId: null, providerName: '系统默认', fallback: true,
    };
  }
  throw new Error('未配置 AI 模型，请前往「AI 设置」添加厂商和模型');
}
```

- [ ] **Step 3: callUserAI / callUserAIStream**

要点：
- 认证头：`headers[quirks.authHeader] = quirks.authPrefix ? quirks.authPrefix + apiKey : apiKey`（参照旧 aiProxy.buildAuthHeaders）
- 请求体：`{ model, messages, [quirks.tokenParam]: Math.min(maxOutputTokens, 131072), temperature, stream, ...(tools?.length ? { tools, tool_choice:'auto' } : {}) }`
- 输入截断：按 `maxInputTokens`（粗算 1 token ≈ 2 字符）超出时从最早的非 system 消息开始丢弃
- 非流式解析 `choices[0].message`（content + tool_calls）+ usage；成功后 `logUsage`（modelDbId 非空才写）
- 流式直接返回 `response.body`（转发逻辑在路由层，与旧 ai.ts 一致）；流式无法可靠拿 usage，不写日志（可接受）
- 错误：401 → 'API Key 无效或已过期'；429 → '请求频率过高'；其余带响应文本；超时 120s（流式不设超时）
- `fetchRemoteModels`：GET `{baseUrl}/models`，15s 超时，返回 `data.data[].id`
- `testProviderConnection`：发 `max_output=16` 的「Hi」请求，ok 或带 error

- [ ] **Step 4: 验证脚本**

`scripts/verify-ai-provider.ts`：直接调用 `testProviderConnection` 用 .env 的 MiMo 配置断言 `ok:true`；再 `callUserAI('nonexistent_user', ...)`（无库配置 → 走 .env 兜底）断言 `fallback:true` 且 message 非空。运行期望全 `✓`。

- [ ] **Step 5: Commit**

```bash
git add smart-report-server/src/services/aiProviderService.ts
git commit -m "feat(server): 新增厂商quirks注册表与统一AI调用入口"
```

---

### Task 3: userAIConfigService + routes/aiConfig.ts（配置管理 API）

**Files:**
- Create: `smart-report-server/src/services/userAIConfigService.ts`
- Create: `smart-report-server/src/routes/aiConfig.ts`
- Modify: `smart-report-server/src/index.ts`（挂载路由）
- Test: curl 实测（登录态 Cookie）

**Interfaces:**
- Consumes: Task 1 repository、Task 2 `fetchRemoteModels/testProviderConnection/VENDOR_QUIRKS`、`authenticate` middleware、`ApiResponse`
- Produces（前端依赖的端点，见设计文档 §3.1，响应 data 形状）:
  - `GET /api/ai-config/resolved` → `{ defaultModel: ResolvedModel|null, models: ResolvedModel[], fallbackAvailable: boolean }`，`ResolvedModel = { id, providerId, providerName, vendorKey, modelId, displayName, isDefault }`
  - 厂商列表项 `apiKeyMasked` 字段替代 api_key

- [ ] **Step 1: userAIConfigService.ts**

要点：
- `maskApiKey(key)`：长度 >10 → `slice(0,6)+'***'+slice(-4)`，否则 `'***'`
- `createProvider`：校验 vendor_key 在 VENDOR_QUIRKS 中、name/baseUrl/apiKey 非空；custom 允许空默认 baseUrl 但请求必须填
- `updateProvider`：apiKey 为空字符串/undefined 时不更新该字段
- `importModels(userId, providerId, modelIds[])`：差量入库（跳过已存在 model_id），首个模型自动设为默认（若用户无默认模型）
- `getResolved(userId)`：组装 defaultModel + models（仅 enabled 的 provider+model）+ fallbackAvailable（env MIMO key 有效）
- `getUsage(userId)`：repository.getUsageStats(userId, 30)

- [ ] **Step 2: routes/aiConfig.ts**

Router 工厂模式（参照 `routes/templates.ts` 的 `getRouter()`）。全部端点 `authenticate`。从 `req.user!.userId` 取 userId。统一 try/catch → `safeErrorMessage`。资源不存在（含越权访问他人资源）返回 404「资源不存在」。端点清单与设计文档 §3.1 一致（15 个）。

`fetch-models` 实现：取 provider（隔离校验）→ `fetchRemoteModels` → 与库中已有 model_id 求差 → 若 body 带 `import: true` 则直接入库差量并返回导入结果，否则只返回差量列表。

- [ ] **Step 3: 挂载路由**

`index.ts` 在 knowledgeBase 挂载后追加：

```ts
import { aiConfigRoutes } from './routes/aiConfig';
// ...
app.use('/api/ai-config', aiConfigRoutes.getRouter());
```

- [ ] **Step 4: curl 实测**

用浏览器已有会话 Cookie 或临时登录获取 Cookie，依次实测：POST providers（MiMo）→ GET providers（断言 apiKeyMasked 无原文）→ POST fetch-models（import:true）→ GET resolved（断言 defaultModel 非空）→ PUT set-default → GET usage。另用第二个用户 Cookie 访问第一个用户的 provider id，断言 404。

- [ ] **Step 5: Commit**

```bash
git add smart-report-server/src/services/userAIConfigService.ts smart-report-server/src/routes/aiConfig.ts smart-report-server/src/index.ts
git commit -m "feat(server): 新增/api/ai-config用户级AI配置管理API"
```

---

### Task 4: 改造 routes/ai.ts 走统一入口

**Files:**
- Modify: `smart-report-server/src/routes/ai.ts`（chat/chatStream/status/analyzeFile 四个 handler + import）
- Test: curl + 浏览器实测

**Interfaces:**
- Consumes: Task 2 `callUserAI/callUserAIStream`
- Produces: 请求体契约变化——`{ messages, modelId? }`，不再读 `config`；响应头兜底标记 `X-AI-Fallback: true`

- [ ] **Step 1: 改 chat**

```ts
const { messages = [], modelId } = req.body as { messages: ChatMessage[]; modelId?: string };
// ...校验 messages 非空后：
const result = await callUserAI(req.user!.userId, {
  messages: [{ role: 'system', content: buildSystemPrompt() }, ...messages],
  modelId, feature: 'chat',
});
if (result.fallback) res.setHeader('X-AI-Fallback', 'true');
res.status(200).json({ code: 200, data: result, message: 'success' });
```

- [ ] **Step 2: 改 chatStream**

同样改走 `callUserAIStream(req.user!.userId, { messages: [...], modelId, feature: 'chat' })`；SSE 转发逻辑（reader/decoder/分行/res.write）保持现状不变；fallback 时 flush 前设 `X-Accel-Buffering` 同时设 `X-AI-Fallback`。

- [ ] **Step 3: 改 status**

```ts
const resolved = await userAIConfigService.getResolved(req.user!.userId);
res.json({ code: 200, data: { configured: !!resolved.defaultModel || resolved.fallbackAvailable, fallback: !resolved.defaultModel && resolved.fallbackAvailable }, message: 'success' });
```

- [ ] **Step 4: 改 analyzeFile**

删除 `config` 字段解析与 `cfg?.apiKey` 校验；改收 `modelId`；`callUserAIStream(req.user!.userId, { messages:[{role:'user',content:prompt}], modelId, feature:'analyze_file', maxOutputTokens: 8192 })`。文件转换逻辑（readAndConvertFile/convertWithCLI）保持不变。删除 `extractConfig` 方法和不再使用的 import（chatCompletion 等）。

- [ ] **Step 5: 实测**

浏览器 evaluate 发 `/api/ai/chat`（不带 config）断言 200；发 `/api/ai/chat/stream` 断言有 SSE 数据。

- [ ] **Step 6: Commit**

```bash
git add smart-report-server/src/routes/ai.ts
git commit -m "refactor(server): AI聊天/分析接口改走统一调用入口"
```

---

### Task 5: 改造 Agent/分析调用链 + 删除旧实现

**Files:**
- Modify: `smart-report-server/src/services/agentService.ts:998-1025`（callAI 方法）+ executeStream 签名透传 userId
- Modify: `smart-report-server/src/services/analysisService.ts:279,321`（两处 aiService.callAI）
- Modify: `smart-report-server/src/services/aiAnalysisWithTools.ts:132`
- Modify: `smart-report-server/src/routes/agent.ts`、`smart-report-server/src/routes/analysis.ts`（透传 `req.user!.userId`）
- Delete: `smart-report-server/src/services/aiProxy.ts`、`smart-report-server/src/services/aiService.ts`
- Test: `cd smart-report-server && npx tsc --noEmit` 全量编译检查

- [ ] **Step 1: analysisService**

`AnalysisRequest` 接口加 `userId: string; modelId?: string`；两处调用改为：

```ts
const response = await callUserAI(request.userId, {
  messages: [ ...原 messages ],
  modelId: request.modelId, feature: 'report_analysis',
});
// response.message 用法不变
```

流式分支 `analyzeStream` 原来 `stream:true` 走的其实也是非流式返回（旧实现不支持真流式），直接用 `callUserAI` 后 `yield response.message`，行为不变。

- [ ] **Step 2: aiAnalysisWithTools**

`AnalyzeWithToolsRequest` 加 `userId: string`；调用改 `callUserAI(request.userId, { messages, feature: 'report_analysis' })`。

- [ ] **Step 3: agentService**

`callAI` 私有方法签名改 `callAI(userId: string, messages: any[])`：

```ts
const { callUserAI } = await import('./aiProviderService');
const tools = getOpenAIToolDefinitions();
const response = await callUserAI(userId, { messages, tools, feature: 'agent' });
return { message: response.message, toolCalls: response.toolCalls || [] };
```

`executeStream` 的参数对象加 `userId: string`，内部调用 `this.callAI(...)` 处全部透传（用 Grep 找 `this.callAI(` 全部调用点）。`routes/agent.ts` 两处 `agentService.executeStream({...})` 加 `userId: req.user!.userId`。

- [ ] **Step 4: routes/analysis.ts**

`analysisService.analyze/analyzeStream`、`aiAnalysisWithToolsService.analyzeWithTools` 调用处加 `userId: req.user!.userId`（先确认这几个路由已挂 `authenticate`，未挂则补上）。

- [ ] **Step 5: 删除旧文件**

`git rm smart-report-server/src/services/aiProxy.ts smart-report-server/src/services/aiService.ts`，然后全库 Grep `aiProxy|from './aiService'|from '../services/aiService'` 确认零残留。

- [ ] **Step 6: 编译检查 + Commit**

`cd smart-report-server && npx tsc --noEmit` 期望零错误。提交 `refactor(server): Agent与分析流程统一走callUserAI，删除旧AI实现`。

---

### Task 6: 前端 aiConfigStore 重写 + 迁移 + API 服务层

**Files:**
- Rewrite: `smart-report-tool/src/stores/aiConfigStore.ts`
- Create: `smart-report-tool/src/services/aiConfigService.ts`
- Modify: `smart-report-tool/src/services/aiService.ts`（删 getConfig、请求改 modelId、删 fetchModelList）
- Modify: `smart-report-tool/src/hooks/useAIAssistant.ts`（透传 modelId，删 addTokenUsage——用量改由服务端统计）
- Test: 前端 `npm run build` 通过

**Interfaces:**
- Produces:

```ts
// aiConfigService.ts
export interface ResolvedModel { id: string; providerId: string; providerName: string; vendorKey: string; modelId: string; displayName: string; isDefault: boolean }
export interface ResolvedAIConfig { defaultModel: ResolvedModel | null; models: ResolvedModel[]; fallbackAvailable: boolean }
export async function fetchResolved(): Promise<ResolvedAIConfig>;
export async function migrateLegacyConfig(): Promise<boolean>; // 见 Step 2

// aiConfigStore.ts（重写后）
interface AIConfigState {
  resolved: ResolvedAIConfig | null;
  selectedModelId: string | null;   // 会话级选择，null = 用默认
  isLoading: boolean;
  loadResolved: () => Promise<void>;
  selectModel: (modelId: string | null) => void;
  /** 当前生效模型（selectedModelId 优先，否则 defaultModel） */
  currentModel: () => ResolvedModel | null;
}
export const useAIConfigStore: UseBoundStore<...>; // 不 persist
```

- [ ] **Step 1: aiConfigService.ts**

```ts
import { getApiUrl } from './api';

export interface ResolvedModel { /* 如上 */ }
export interface ResolvedAIConfig { /* 如上 */ }

export async function fetchResolved(): Promise<ResolvedAIConfig> {
  const res = await fetch(getApiUrl('/ai-config/resolved'), { credentials: 'include' });
  if (!res.ok) throw new Error('获取 AI 配置失败');
  return (await res.json()).data;
}

const LEGACY_KEY = 'ai-vendor-config';

/** 一次性迁移：旧 localStorage 配置入库。返回是否执行了迁移。 */
export async function migrateLegacyConfig(): Promise<boolean> {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return false;
  localStorage.removeItem(LEGACY_KEY); // 先删防重入；失败也不影响
  try {
    const state = JSON.parse(raw)?.state;
    if (!state?.apiKey) return false;
    const res = await fetch(getApiUrl('/ai-config/providers'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_key: state.vendor || 'mimo',
        name: '小米 MiMo（迁移）',
        baseUrl: state.baseUrl || 'https://token-plan-cn.xiaomimimo.com/v1',
        apiKey: state.apiKey,
      }),
    });
    if (!res.ok) return false;
    const provider = (await res.json()).data;
    // 添加模型并修正 maxTokens（旧值 1048576 是 400 报错元凶）
    await fetch(getApiUrl(`/ai-config/providers/${provider.id}/models`), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: state.model || 'mimo-v2.5-pro', display_name: state.model || 'mimo-v2.5-pro' }),
    });
    return true;
  } catch { return false; }
}
```

- [ ] **Step 2: aiConfigStore.ts 重写**

不 persist。`loadResolved`：先 `migrateLegacyConfig()`，再 `fetchResolved()` 存 store。`selectedModelId` 初始 null。

- [ ] **Step 3: aiService.ts（前端）修改**

- 删 `getConfig()`、`fetchModelList`、`useAIConfigStore` import
- `sendMessage/sendMessageStream` 签名加第三参 `modelId?: string`（sendMessageStream 现有第三参是 onChunk，modelId 加成第四参或改 options 对象——采用 options 对象：`sendMessageStream(message, history, onChunk, modelId?)`），body 改 `{ messages, modelId }`
- 删 `VENDOR_PRESETS` 相关引用（store 重写后不再导出；Grep 全前端 `VENDOR_PRESETS` 处理残留：AssistantPage、AIAnalysisPanel 在 Task 8 处理）

- [ ] **Step 4: useAIAssistant.ts**

`sendStream/send` 内部从 `useAIConfigStore.getState()` 取 `selectedModelId` 传给服务层；删 `addTokenUsage`（store 已移除该方法）；错误文案保持。

- [ ] **Step 5: 构建验证 + Commit**

`cd smart-report-tool && npm run build`（此阶段 AssistantPage/AIAnalysisPanel/AgentPage 会报错——预期内，先只提交 store/service/hook 三个文件，构建验证留到 Task 8 末）。提交 `refactor(web): aiConfigStore改为服务端数据源+旧配置迁移`。

---

### Task 7: AI 设置页 + 路由 + 侧边栏

**Files:**
- Create: `smart-report-tool/src/pages/AISettingsPage.tsx`
- Modify: `smart-report-tool/src/constants/routes.ts`（加 `AI_SETTINGS: '/settings/ai'`）
- Modify: `smart-report-tool/src/router/index.tsx`（加路由）
- Modify: `smart-report-tool/src/components/layout/Sidebar.tsx`（系统设置分组下挂 AI设置）
- Test: 浏览器打开 `/settings/ai` 实测增删改查

**Interfaces:**
- Consumes: Task 3 全部 `/api/ai-config/*` 端点；shadcn 组件 Button/Card/Dialog/Input/Select/Switch/Badge/ConfirmDialog；`getApiUrl`
- Produces: 路由常量 `ROUTES.AI_SETTINGS`；页面默认导出 `AISettingsPage`

- [ ] **Step 1: routes.ts + router/index.tsx**

`ROUTES` 加 `AI_SETTINGS: '/settings/ai'`，`ROUTE_LABELS` 加对应标签。router 加：

```tsx
import AISettingsPage from '@/pages/AISettingsPage';
// ...
<Route path={ROUTES.AI_SETTINGS} element={<RouteGuard requiredFeature="settings"><AISettingsPage /></RouteGuard>} />
```

- [ ] **Step 2: Sidebar.tsx**

menuItems 在系统设置项后插入缩进子项（系统设置保持原样，新增一行）：

```ts
{ icon: Bot, label: 'AI设置', path: ROUTES.AI_SETTINGS, feature: 'settings' as const, indent: true },
```

渲染时 `indent` 项加 `pl-6`（图标改 `h-4 w-4`）；isActive 判断不变。注意 Bot 图标已被 AI助手使用——AI设置用 `Sparkles` 图标（lucide-react 已装）。

- [ ] **Step 3: AISettingsPage.tsx**

页面结构（设计文档 §5.1）：
- 左列（w-72）：厂商卡片列表。每卡片：名称、vendor 标签、baseUrl（截断）、打码 Key、模型数、Switch 启用、编辑/删除按钮；顶部「+ 添加厂商」
- 右列：选中厂商的模型表格（显示名/model_id/温度/输入上限/输出上限/默认标记/启用 Switch/操作）；工具栏「拉取模型列表」「+ 手动添加」
- 底部：用量统计卡片（近 30 天，按模型+功能聚合表格）
- 弹窗 1「添加/编辑厂商」：厂商类型 Select（9 预设，选中自动填 baseUrl+name）、名称、baseUrl、apiKey（编辑时 placeholder 显示打码值、留空不改）、「测试连接」按钮（调 `/ai-config/test-connection`，结果显示成功/失败文案）、保存
- 弹窗 2「添加/编辑模型」：model_id、显示名、temperature（Input number step 0.1, 0-2）、max_input_tokens、max_output_tokens、「设为默认」Switch
- 弹窗 3「拉取模型列表」：调 fetch-models（不 import），checkbox 列表勾选 → 确认导入（body `import:true` + selected ids——若后端按全量差量导入，则前端逐个 POST models，以实际实现为准并在任务执行时对齐）
- 所有变更后刷新数据；删除用 ConfirmDialog

- [ ] **Step 4: 浏览器实测**

登录态打开 `/settings/ai`：添加 MiMo 厂商（用 .env 同款 Key 或从迁移来）→ 测试连接绿勾 → 拉取模型列表导入 → 设默认 → 编辑温度 → 停用/启用 → 用量表格出现记录。

- [ ] **Step 5: Commit**

`feat(web): 新增AI设置页与侧边栏入口`。

---

### Task 8: ModelSelector 重写 + 三个功能页接入 + 删 AIConfigDialog

**Files:**
- Rewrite: `smart-report-tool/src/components/ai/ModelSelector.tsx`
- Modify: `smart-report-tool/src/pages/AssistantPage.tsx`
- Modify: `smart-report-tool/src/pages/AgentPage.tsx`（仅修复编译：删 AIConfigDialog 引用，接新 ModelSelector；该页未挂路由，不改逻辑）
- Modify: `smart-report-tool/src/components/report/AIAnalysisPanel.tsx`
- Delete: `smart-report-tool/src/components/ai/AIConfigDialog.tsx`
- Test: `npm run build` + 浏览器端到端

- [ ] **Step 1: ModelSelector 重写**

下拉选择器（用 ui/select 或 dropdown-menu）：

```tsx
export function ModelSelector({ className }: { className?: string }) {
  const { resolved, selectedModelId, selectModel, loadResolved } = useAIConfigStore();
  useEffect(() => { if (!resolved) loadResolved(); }, []);
  const current = /* selectedModelId 对应项 ?? resolved.defaultModel */;
  if (!resolved) return null;
  if (!current) return (
    <Button variant="ghost" size="sm" className="h-7 text-xs text-amber-500"
      onClick={() => navigate(ROUTES.AI_SETTINGS)}>
      <Sparkles /> 配置 AI 模型
    </Button>
  );
  return (
    <Select value={selectedModelId ?? current.id} onValueChange={selectModel}>
      <SelectTrigger className="h-7 text-xs w-auto gap-1"><SelectValue /></SelectTrigger>
      <SelectContent>
        {resolved.models.map(m => (
          <SelectItem key={m.id} value={m.id}>
            {m.displayName || m.modelId}（{m.providerName}）{m.isDefault ? ' ·默认' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: AssistantPage**

- 删 `AIConfigDialog` import/使用/`configOpen` state；删 `VENDOR_PRESETS` import 与 `vendorName`；`displayModel` 改从 store `currentModel()`
- 头部「设置」按钮 → 替换为 `<ModelSelector />` + 一个跳转 AI 设置的图标按钮（`navigate(ROUTES.AI_SETTINGS)`）
- 未配置引导文案改「请前往 AI 设置配置模型」并可点击跳转
- `useEffect` 里 `loadResolved()`
- tokenStats 展示删除（store 已无该字段，改由 AI 设置页展示用量）

- [ ] **Step 3: AIAnalysisPanel**

- 删 `aiConfig`、`fetchModelList`、`fetchModels`、`availableModels` 相关逻辑
- 面板顶部加 `<ModelSelector />`
- analyze-file 请求：删 config 字段，改 `formData.append('modelId', selectedModelId ?? '')`（空则后端用默认）
- `buildReportContent` 的 model 参数改传 `currentModel()?.displayName ?? '系统默认'`

- [ ] **Step 4: AgentPage 编译修复**

删 AIConfigDialog import/使用；`useAIConfigStore` 旧 API（vendor/model 等字段）引用改为新 store 或删除；ModelSelector 用法不变。

- [ ] **Step 5: 删 AIConfigDialog + 构建**

`git rm smart-report-tool/src/components/ai/AIConfigDialog.tsx`；Grep 全前端 `AIConfigDialog|VENDOR_PRESETS|availableModels|tokenStats|addTokenUsage` 确认零残留；`npm run build` 零错误。

- [ ] **Step 6: Commit**

`refactor(web): 功能页接入统一模型选择器，移除localStorage配置`。

---

### Task 9: 端到端验收 + 文档收尾

**Files:**
- Modify: `README.md`（AI 配置说明更新）、`docs/superpowers/specs/2026-07-28-multi-vendor-ai-design.md`（标注已实施）
- Test: 浏览器全链路

- [ ] **Step 1: 迁移验收**：浏览器手动种入旧格式 `ai-vendor-config` localStorage → 刷新 → 断言已入库且 localStorage 已清除 → AI 助手可聊
- [ ] **Step 2: 多厂商验收**：AI 设置添加第二厂商（无真实 Key 时用 test-connection 的失败路径验证错误提示；有 Key 则全通）
- [ ] **Step 3: 切换模型验收**：助手页切换模型发消息，后端日志确认用了指定 model_id
- [ ] **Step 4: 隔离验收**：test 账号登录，AI 设置为空列表，访问 admin 的 provider id 返回 404
- [ ] **Step 5: 兜底验收**：删除全部厂商后聊天仍可用（.env MiMo），响应头带 X-AI-Fallback，页面显示提示条
- [ ] **Step 6: 回归**：脚本生成报告、报告管理、知识库、用户管理冒烟
- [ ] **Step 7: 文档 + 最终 Commit**：README 更新「AI 配置」小节（指向 AI 设置页）；提交 `docs: 更新AI配置说明`

---

## Self-Review 记录

- Spec 覆盖：§2 数据模型→Task1；§3 API→Task3/4；§4 改造清单→Task2-5；§5 前端→Task6-8；§6 迁移→Task6 Step1/Task9；§7 测试→各 Task 验证步 + Task9
- 已知偏差（执行时注意）：① fetch-models 的勾选导入交互以 Task3 实际 API 为准对齐 ② 流式调用不写 usage 日志（API 不返回 usage，可接受） ③ AgentPage 未挂路由，仅做编译修复
