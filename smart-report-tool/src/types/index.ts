export type UserRole = 'admin' | 'senior' | 'member';
export type UserStatus = 'pending' | 'active' | 'rejected';
export type LogCategory = 'host' | 'storage' | 'database' | 'virtualization' | 'network';
export type ReportStatus = 'generating' | 'success' | 'failed';
export type AIIntent = 'query_report' | 'analyze_data' | 'general';
export type ScriptType = 'python' | 'bat' | 'ps1' | 'sh' | 'powershell';
export type ScriptRegion = '全部' | '华南区' | '西北区' | '华东区' | '东北区' | '西南区' | '华北区' | '北京区' | '华中区';
export type DocTemplateType = 'docx' | 'xlsx' | 'md' | 'pdf';
export type OutputFormat = 'docx' | 'xlsx' | 'md' | 'pdf' | 'html';
export type AuxFileType = 'txt' | 'xlsx' | 'md' | 'html' | 'csv' | 'json';

export interface User {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  displayName: string;
  status: UserStatus;
  region: ScriptRegion;
  createdAt: string;
}

export interface AuxFile {
  name: string;
  size: number;
  /** 文件系统路径（后端）或 Base64 内容（仅上传时前端持有） */
  path?: string;
  content?: string;
}

export interface Script {
  id: string;
  name: string;
  description: string;
  scriptType: ScriptType;
  /** 适用区域 */
  region: ScriptRegion;
  /** 巡检数据格式（仅允许字母数字和连字符，逗号或空格分隔） */
  inputFormats: string;
  /** 是否手动输入巡检数据格式 */
  inputFormatManual: boolean;
  version: string;
  category: LogCategory;
  fileName: string;
  filePath?: string;
  fileSize: number;
  /** 是否需要关联模板来生成报告 */
  templateRequired: boolean;
  /** 关联的多个模板ID */
  templateIds: string[];
  /** 辅助文件 */
  auxiliaryFiles: AuxFile[];
  /** Python 依赖包列表，如 ["python-docx", "pandas>=1.0"] */
  requirements: string[];
  /** 依赖安装状态 */
  depsStatus?: {
    status: 'none' | 'installing' | 'done' | 'failed';
    log: string;
    packages: string[];
    error?: string;
  };
  uploadedAt: string;
  uploadedBy: string;
}

export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  fileName: string;
  filePath?: string;
  fileSize: number;
  fileType: DocTemplateType;
  /** 适配的脚本类型 */
  compatibleScriptType?: ScriptType;
  category?: string;
  templateRequired?: boolean;
  uploadedAt: string;
  uploadedBy?: string;
}

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

export interface Report {
  id: string;
  name: string;
  type: LogCategory;
  date: string;
  author: string;
  templateId: string;
  /** 使用的脚本ID */
  scriptId?: string;
  /** 使用的脚本名称 */
  scriptName?: string;
  /** 输出格式 */
  outputFormat?: OutputFormat;
  status: ReportStatus;
  /** 报告所属区域（从生成脚本继承） */
  region?: string;
  /** 后端执行日志文件路径 */
  logFilePath?: string;
  /** 后端报告文件路径（第一个，兼容旧数据） */
  filePath?: string;
  /** 后端报告文件路径（全部） */
  filePaths?: string[];
  /** 工作目录路径 */
  workspaceDir?: string;
  createdAt: string;
  /** 联合判断详细信息 */
  judgment?: {
    /** 脚本退出码 */
    exitCode: number;
    /** 退出码是否表示成功 */
    exitCodeSuccess: boolean;
    /** 是否生成了新文件 */
    hasNewFiles: boolean;
    /** 新生成的文件数量 */
    newFilesCount: number;
    /** 是否生成了有效的报告文件 */
    hasValidReportFiles: boolean;
    /** 生成的报告文件列表 */
    generatedReportFiles: string[];
  };
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
  thumbnail?: string;
  description: string;
  htmlContent: string;
  isBuiltIn: boolean;
}

export interface InputFileEntry {
  id: string;
  name: string;
  size: number;
  type: string;
  /** 原始文件 */
  file: File;
  /** SHA-256 哈希值，用于完整性校验 */
  hash?: string;
  /** 如果是压缩包，解压后的子文件 */
  extractedFiles?: { name: string; size: number; content: string }[];
  /** 是否来自压缩包 */
  isArchive: boolean;
  /** 关联组ID（同组文件会被视为同一批次） */
  groupId: string;
  /** 上传/解压进度 0-100 */
  progress: number;
  /** 状态 */
  status: 'pending' | 'uploading' | 'extracting' | 'done' | 'error';
  error?: string;
}

export interface ReportGenerationState {
  step: 1 | 2 | 3 | 4 | 5;
  logCategory: LogCategory;
  /** 步骤1：上传的巡检文件列表 */
  inputFiles: InputFileEntry[];
  /** 步骤2：选择脚本 */
  selectedScriptId: string | null;
  /** 步骤3：选择模板 */
  selectedTemplateId: string | null;
  /** 步骤4：报告基本信息 */
  reportInfo: { name: string; date: string; author: string; authorId: string };
  /** 输出格式 */
  outputFormat: OutputFormat;
  enableAIAnalysis: boolean;
  progress: number;
  status: 'idle' | 'generating' | 'success' | 'failed';
  errorMessage?: string;
}

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
