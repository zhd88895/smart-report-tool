# AI 支持包整包智能分析设计

日期：2026-08-04
状态：已获用户批准

## 背景

AI 智能分析（`/api/ai/analyze-file`）目前允许上传压缩包，但内容无法提交给 AI：前端 `AIAnalysisPanel` 原样发送压缩包二进制，后端 `readAndConvertFile` 对 tar.gz/zip 只能读出乱码。目标：让 AI 能真正分析服务器厂商支持包（以华为 BMC 一键收集包 `.tar.gz` 为参考样本，537 条目 / 解压约 25MB，含 `AppDump/sensor_alarm/current_event.txt` 等关键告警文件）。

## 已定决策

- 交互：**整包智能分析**——用户上传支持包后零额外操作，后端自动解压、按规则挑选关键文本、汇总交给 AI 出整体报告（用户已选 A）。
- 类别：新增「整机支持包」`support` 类别与专用提示词，上传压缩包时前端自动切换（用户已选 A）。
- 技术路线：后端原生内存解压（npm `tar` 已是直接依赖；zip 新增零原生依赖的 `adm-zip`），不调外部命令、不起 Python 进程。

## 组件

### 1. archiveAnalysisService（后端新增 `src/services/archiveAnalysisService.ts`）

- `extractEntries(buffer: Buffer, fileName: string): Promise<ArchiveEntry[]>`
  - tar / tar.gz / tgz：npm `tar` 流式解析（`tar.t({ onentry })`，gzip 由 tar 自动识别）
  - 单文件 .gz（非 tar）：`zlib.gunzipSync` 后按内部文件名作为单条目
  - zip：`adm-zip` 内存解析
  - `ArchiveEntry = { path: string; size: number; text: string | null }`（text 为 null 表示二进制/超限跳过）
  - 文本判定：扩展名白名单（.txt/.log/.csv/.json/.xml/.ini/.cfg/.conf/.yaml 等）+ 无扩展名文件前 8KB 抽样 NUL 检测
  - 安全：路径穿越（`..`/绝对路径）过滤；条目数上限 2000；单文件 32MB；总解压 200MB
- `smartSelect(entries): { context: string; summary: SelectSummary }`
  - 三档优先级：
    - P0 告警/事件/诊断：路径匹配 `event|alarm|sel|diagnose|fault|fdm_log`（文本）→ 全取；单文件超 64KB 取头 48KB + 尾 16KB
    - P1 关键系统日志：路径匹配 `kernel|raid|storage|sensor|bmc|system|os` 的 .log/.txt → 取尾部 32KB
    - P2 其他文本 → 取尾部 8KB
  - 总文本预算 150KB，按 P0→P1→P2 顺序填充，预算耗尽即止
  - 输出 `context`：`===== 文件: <路径> (<原始大小>) =====` 分隔的拼接文本；`summary`：`{ total, selected, skippedBinary, skippedBudget, truncatedList }`

### 2. analyze-file 接入（`src/routes/ai.ts`）

- 压缩包检测：扩展名（zip/tar/gz/tgz/tar.gz）或 magic bytes（PK\x03\x04 / \x1f\x8b / tar ustar）
- 命中压缩包 → `extractEntries` → `smartSelect` → 把 `context`（含筛选摘要头部）作为文件内容走现有提示词/流式分析流程
- 解压失败 / 包内无文本文件 → 400 中文明确错误
- 整包仍走 `fileDedupService.registerBuffer` 收编（秒传兼容不变）；`dedupHash` 分支从 CAS 读到 buffer 后同样支持压缩包路径
- 上传上限：analyze-file multer memoryStorage 提到 50MB

### 3. 「整机支持包」类别（前后端）

- 后端 `CATEGORY_KEYS` 加 `support`；`getPrompt` 加 support 专用提示词：引导 AI 从硬件告警、RAID/存储状态、传感器（温度/电源/风扇）、系统事件、固件/驱动问题维度做整机健康诊断，按严重程度排序输出问题清单与处理建议
- 前端 `CATEGORIES` 加 `{ key: 'support', label: '整机支持包' }`；`DEFAULT_PROMPTS` 同步
- 前端上传文件检测到压缩包扩展名时：自动 `setCategory('support')` + 显示提示「检测到压缩包，将自动提取包内关键日志进行整体分析」

### 4. 前端限制与 UI

- `AIAnalysisPanel` 文件大小校验 10MB → 50MB
- 压缩包选中后文件名旁显示「整包智能分析」徽标
- 分析时把后端返回的筛选摘要展示在结果上方（通过 SSE 前先发一行 `data: {"summary":...}`？——简化为把摘要拼进 context 顶部，AI 报告中自然体现；不做额外协议字段）

### 5. 错误处理

| 场景 | 行为 |
|---|---|
| 解压失败（损坏/加密） | 400「压缩包解压失败：…」 |
| 包内无文本文件 | 400「压缩包内未找到可分析的文本日志」 |
| 超条目/总量上限 | 跳过超出部分，摘要中注明 |
| RAR | 400「RAR 格式暂不支持」 |

### 6. 测试

- 样本 `samples/2288HV6_..._20260507-0829.tar.gz`（2.8MB）curl + 浏览器双路实测：AI 报告应识别 DISK0 磁盘故障（Major）、RAID 阵列失效、逻辑盘降级
- 双端 `tsc --noEmit`、前端 `vite build`
- 秒传兼容：同一支持包二次分析走 dedupHash 分支仍正确解压分析

## 非目标

- 报告生成（脚本链路）的压缩包处理不变（已有前端解压逻辑）
- 不做用户勾选文件树交互（方案 A 已定）
- 不改 knowledge base / 模板存储
