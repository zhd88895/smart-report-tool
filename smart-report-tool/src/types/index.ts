export type UserRole = 'admin' | 'senior' | 'member';
export type UserStatus = 'pending' | 'active' | 'rejected';
export type LogCategory = 'host' | 'storage' | 'database' | 'virtualization' | 'network';
export type ReportStatus = 'generating' | 'success' | 'failed';
export type AIIntent = 'query_report' | 'analyze_data' | 'general';
export type ScriptType = 'python' | 'bat' | 'ps1' | 'sh' | 'powershell';
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
  createdAt: string;
}

export interface AuxFile {
  name: string;
  size: number;
  type: AuxFileType;
  /** Base64 编码的文件内容 */
  content: string;
}

export interface Script {
  id: string;
  name: string;
  description: string;
  scriptType: ScriptType;
  version: string;
  category: LogCategory;
  fileName: string;
  fileSize: number;
  content: string;
  /** 是否需要关联模板来生成报告 */
  templateRequired: boolean;
  /** 关联的多个模板ID */
  templateIds: string[];
  /** 辅助文件 */
  auxiliaryFiles: AuxFile[];
  /** Python 依赖包列表，如 ["python-docx", "pandas>=1.0"] */
  requirements: string[];
  uploadedAt: string;
  uploadedBy: string;
}

export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  fileName: string;
  fileSize: number;
  fileType: DocTemplateType;
  /** Base64 编码的文件内容 */
  content: string;
  /** 匹配的脚本类型 */
  compatibleScriptType: ScriptType;
  uploadedAt: string;
  uploadedBy: string;
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
  authorId: string;
  templateId: string;
  /** 使用的脚本ID */
  scriptId?: string;
  /** 使用的脚本名称 */
  scriptName?: string;
  /** 原始巡检文件名 */
  inputFileName?: string;
  /** 输出格式 */
  outputFormat?: OutputFormat;
  status: ReportStatus;
  logs: string[];
  /** 生成后的报告内容（HTML/base64） */
  generatedContent?: string;
  fileUrl?: string;
  aiAnalysis?: string;
  /** 后端执行日志文件路径 */
  logFilePath?: string;
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
