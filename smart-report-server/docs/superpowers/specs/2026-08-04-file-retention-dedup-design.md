# 设计：文件保留天数清理 + 上传文件 hash 去重（秒传）

日期：2026-08-04
状态：已获用户批准（2026-08-04）

## 背景与问题

1. `data/uploads/` 中的报告输入临时文件经 multer 落盘后从未清理，现存 109 个 / 63MB 残留文件。
2. `storage.retentionDays`（文件保留天数）设置项存在但无实现，处于隐藏状态。
3. 用户重复上传同一文件（如巡检日志）时，每次都完整重新上传并产生新的临时文件，浪费带宽与磁盘。

已有可复用设施：

- 前端 `BatchFileUploader` 已用 Web Worker 计算完整 SHA-256 并随 `inputHashes` 上传。
- 后端 `reportService.computeFileHash`（sha256 流式）与输入文件完整性校验已存在。

## 方案

内容寻址去重存储 + 上传前预检查（秒传）+ 定时保留清理。

被否决的备选：

- 仅后端落盘后去重：省磁盘不省带宽，不满足「不用上传」。
- 内存索引代替 DB 表：启动需重算全部存量 hash，且无法按最近使用时间清理。

## 组件设计

### 1. fileDedupService（后端新增）

内容寻址存储（CAS）与 hash 索引。

- 存储目录：`data/uploads/dedup/`，文件名 `<sha256><原扩展名>`，同内容仅存一份。
- 新表 `file_hashes`：

  | 列 | 类型 | 说明 |
  |---|---|---|
  | hash | TEXT PK | SHA-256（64 位十六进制） |
  | file_name | TEXT | 首次上传时的原始文件名（展示用） |
  | size | INTEGER | 字节数 |
  | path | TEXT | 工作区相对路径（dedup/xxx） |
  | uploaded_by | TEXT | 首次上传用户 ID（审计） |
  | created_at | TEXT | 首次入库时间 |
  | last_used_at | TEXT | 最近注册/引用时间，清理依据 |

- `register(tempPath, originalName, userId)`：流式计算 SHA-256；命中则删除新临时文件并 touch 旧记录，未命中则移动文件入 dedup 目录并插入行。返回 `{ hash, path, size, deduped }`。
- `registerBuffer(buffer, originalName, userId)`：内存 buffer 版（AI 分析上传用），逻辑同上。
- `lookup(hash)`：查表并校验磁盘文件真实存在；文件丢失则删除索引行并返回 null。
- `touch(hash)`：刷新 `last_used_at`。
- 启动迁移：建表 + 建 `dedup/` 目录。

### 2. 预检查端点

`POST /api/files/check-hashes`（需登录）

- 请求：`{ hashes: string[] }`（上限 100 个，逐个校验 64 位十六进制格式）。
- 响应：`{ existing: { [hash]: { fileName, size } } }`，仅包含 lookup 命中的项。
- 安全：知道某文件 hash 必先拥有其内容，跨用户去重不构成信息泄露。

### 3. 报告生成去重接入

- `reports.ts /generate`：新增可选字段 `dedupRefs`（JSON，`{ [index]: hash }`）。
- 前端 `BatchFileUploader`：hash 计算完成后调用 check-hashes；命中的文件标记「⚡秒传」，不追加上传字段；生成时按原索引传 `dedupRefs`。
- 后端组装输入文件列表：索引在 `dedupRefs` 中的从 CAS 解析路径（并 touch），其余用 multer 临时文件；新上传文件在生成成功后调用 `register()` 收编进 CAS（失败不阻塞生成，只记警告）。现有 `inputHashes` 完整性校验对两类文件照常生效。

### 4. AI 分析去重接入

- 前端 `AIAnalysisPanel`：选中文件后用 `crypto.subtle.digest('SHA-256')` 计算完整 hash（≤10MB，主线程可接受），先调 check-hashes。
- 命中：不附文件，表单改传 `dedupHash`；后端从 CAS 读入 buffer 分析。
- 未命中：照常上传，后端用 `registerBuffer()` 收编进 CAS 后分析。

### 5. fileCleanupService（后端新增）+ 设置开放

- 启动时延迟 1 分钟运行一次，之后每 6 小时运行：
  - CAS 清理：`last_used_at` 早于 `now - retentionDays` 的记录，删文件 + 删行；
  - 散落清理：`data/uploads/` 根目录（不含 `dedup/` 子目录）中 mtime 超期的游离文件直接删除（覆盖现存 109 个残留及未来漏网文件）；
  - 每次运行记录日志（删除数量、释放空间）。
- N 动态读取 `settingsService.getNumber('storage.retentionDays', 90)`。
- 取消隐藏该设置，描述改为「临时上传文件超过 N 天未使用自动删除，调整后于下次清理周期生效」。
- 清理范围严格限定 `data/uploads`，不触碰 scripts / reports / knowledge-base 等永久存储。

## 数据流

```
上传前：前端算 SHA-256 → check-hashes → 命中？秒传(传 hash 引用) : 正常上传
上传后（未命中）：multer 临时文件 → 业务使用 → register() 收编入 CAS
清理周期：CAS 按 last_used_at 超期删除；uploads 根目录游离文件按 mtime 超期删除
```

## 错误处理

- check-hashes 对非法 hash 格式静默跳过；全部非法返回空 existing。
- 秒传引用在生成/分析时 lookup 失败（文件被清理）：返回 400「文件已过期，请重新上传」，前端提示重传。
- register 失败（磁盘满等）：不影响主流程，临时文件留在原处由散落清理兜底。
- 清理过程单文件失败：记警告继续，不影响其余文件。

## 测试与验收

1. `tsc --noEmit` 双端零错误，`vite build` 通过。
2. 浏览器实测：AI 分析同一文件两次，第二次秒传（无文件上传，分析正常）。
3. 接口实测：check-hashes 命中/未命中/文件丢失三种路径。
4. 清理实测：手动触发清理逻辑（临时把保留天数调小或构造超期文件），确认残留文件被删、CAS 中近期使用文件不受影响。
5. 设置页可见「文件保留天数」且修改可保存。

## 明确不做（YAGNI）

- 知识库、脚本、模板等永久存储的上传不做去重。
- 不做前端断点续传、分片上传。
- 不做跨用户去重的管理界面（索引表仅供服务内部使用）。
