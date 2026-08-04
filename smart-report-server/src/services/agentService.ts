/**
 * AI Agent 服务模块
 * 
 * 本模块实现 AI Agent 的核心逻辑，包括：
 * 1. Agent Loop（思考-规划-执行循环）
 * 2. 工具调用执行
 * 3. 上下文管理
 * 4. 流式响应
 * 
 * @module agentService
 */

import { v4 as uuidv4 } from 'uuid';
import { getLogger, generateTraceId } from '../utils/logger';
import { getConfig } from '../config';
import { reportRepository } from '../db/repositories/reportRepository';
import { scriptRepository } from '../db/repositories/scriptRepository';
import { templateRepository } from '../db/repositories/templateRepository';
import { conversationRepository } from '../db/repositories/conversationRepository';
import {
  ToolDefinition,
  ToolResult,
  PendingAction,
  getAllToolDefinitions,
  getToolDefinition,
  getOpenAIToolDefinitions,
  requiresConfirmation,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
} from './agentTools';
import { fileOperationService } from './fileOperationService';
import { webAccessService } from './webAccessService';
import { knowledgeBaseService } from './knowledgeBaseService';

// 日志实例
const log = getLogger('AgentService', 'core');

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

/**
 * Agent 配置
 */
export interface AgentConfig {
  maxToolCalls: number;
  timeoutMs: number;
  maxContextTokens: number;
  truncationLimit: number;
}

/**
 * Agent 请求
 */
export interface AgentRequest {
  conversationId?: string;
  message: string;
  userId: string;
  userName?: string;
  model?: string;
  stream?: boolean;
}

/**
 * Agent 响应
 */
export interface AgentResponse {
  success: boolean;
  conversationId: string;
  message: string;
  toolCalls: ToolCallRecord[];
  pendingActions: PendingAction[];
  error?: string;
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
  result?: ToolResult;
  timestamp: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'awaiting_confirmation';
}

/**
 * SSE 事件类型
 */
export type SSEEventType = 
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'pending_action'
  | 'error'
  | 'done';

/**
 * SSE 事件
 */
export interface SSEEvent {
  type: SSEEventType;
  data: any;
}

// ═══════════════════════════════════════════════════════
//  Agent 服务类
// ═══════════════════════════════════════════════════════

export class AgentService {
  private config: AgentConfig;
  private pendingActions: Map<string, PendingAction> = new Map();

  constructor() {
    this.config = {
      maxToolCalls: 10,
      timeoutMs: 5 * 60 * 1000, // 5 分钟
      maxContextTokens: 4000,
      truncationLimit: 2000,
    };
  }

  /**
   * 获取系统提示词
   */
  private getSystemPrompt(): string {
    const tools = getAllToolDefinitions();
    const readOnlyTools = tools.filter(t => t.permission === 'read_only');
    const writeTools = tools.filter(t => t.permission !== 'read_only');

    return `你是智能巡检报告管理系统的 AI Agent 助手。你可以帮助用户管理巡检脚本、查看报告、分析系统状态。

## 工具使用规范

你拥有以下工具可以调用：

### 只读工具（自动执行）
${readOnlyTools.map(t => `- **${t.name}**: ${t.description}`).join('\n')}

### 写入工具（需用户确认）
${writeTools.map(t => `- **${t.name}**: ${t.description} [${t.permission === 'dangerous' ? '⚠️ 危险操作' : '需确认'}]`).join('\n')}

## 执行规则

1. **只读优先**：优先使用只读工具获取信息，除非用户明确要求修改操作
2. **写入确认**：写入工具会生成待确认操作，用户确认后才会执行
3. **最多10轮**：单次请求最多执行10轮工具调用
4. **结果截断**：单个工具结果超过2000字符会截断，可调用专用方法获取完整数据
5. **错误处理**：工具调用失败时，向用户说明原因并建议替代方案

## 安全规范

- 不执行未经用户确认的写入操作
- 不删除用户未明确要求删除的数据
- 执行危险操作前进行二次确认
- 保护用户隐私，不泄露敏感信息

## 响应规范

- 使用中文回复
- 结构化展示数据（表格、列表）
- 工具调用结果要与用户问题关联
- 复杂任务分步骤说明
`;
  }

  /**
   * 执行 Agent 请求（流式）
   */
  async *executeStream(request: AgentRequest): AsyncGenerator<SSEEvent> {
    const traceId = generateTraceId();
    const startTime = Date.now();
    
    log.info(`Agent 请求开始: ${request.message.substring(0, 50)}...`, traceId);

    try {
      // 获取或创建对话
      let conversationId = request.conversationId;
      let messages: any[] = [];

      if (conversationId) {
        const conversation = await conversationRepository.findById(conversationId);
        if (conversation) {
          messages = conversation.messages || [];
        }
      }

      // 添加用户消息
      messages.push({
        role: 'user',
        content: request.message,
        timestamp: new Date().toISOString(),
      });

      // 确保有对话ID
      if (!conversationId) {
        conversationId = `conv_${Date.now()}_${uuidv4().substring(0, 9)}`;
      }

      // 上下文压缩（如果消息过多）
      messages = this.compressContext(messages);

      // 构建完整的消息上下文
      const fullMessages = [
        { role: 'system', content: this.getSystemPrompt() },
        ...messages,
      ];

      // 开始 Agent Loop
      let toolCallCount = 0;
      let finalMessage = '';
      const toolCalls: ToolCallRecord[] = [];

      while (toolCallCount < this.config.maxToolCalls) {
        // 检查超时
        if (Date.now() - startTime > this.config.timeoutMs) {
          yield { type: 'error', data: { message: '请求超时' } };
          break;
        }

        // 调用 AI 模型（需要实现实际的 API 调用）
        yield { type: 'thinking', data: { message: '正在思考...' } };

        // TODO: 这里需要调用实际的 AI API
        // 暂时模拟响应
        const aiResponse = await this.callAI(request.userId, fullMessages);

        // 检查是否有工具调用
        if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
          for (const toolCall of aiResponse.toolCalls) {
            toolCallCount++;
            
            // 记录工具调用
            const record: ToolCallRecord = {
              id: uuidv4(),
              toolName: toolCall.function.name,
              parameters: JSON.parse(toolCall.function.arguments || '{}'),
              timestamp: new Date().toISOString(),
              status: 'pending',
            };

            // 检查是否需要确认
            if (requiresConfirmation(record.toolName)) {
              record.status = 'awaiting_confirmation';
              const pendingAction: PendingAction = {
                id: record.id,
                toolName: record.toolName,
                parameters: record.parameters,
                description: this.generateActionDescription(record.toolName, record.parameters),
                riskLevel: getToolDefinition(record.toolName)?.permission === 'dangerous' ? 'high' : 'medium',
                createdAt: new Date().toISOString(),
              };

              this.pendingActions.set(record.id, pendingAction);
              toolCalls.push(record);

              yield {
                type: 'pending_action',
                data: {
                  action: pendingAction,
                  toolCall: record,
                },
              };

              continue;
            }

            // 执行只读工具
            yield {
              type: 'tool_call',
              data: {
                toolCall: record,
                message: `调用工具: ${record.toolName}`,
              },
            };

            record.status = 'executing';
            const result = await this.executeTool(record.toolName, record.parameters);
            record.result = result;
            record.status = result.success ? 'completed' : 'failed';

            toolCalls.push(record);

            yield {
              type: 'tool_result',
              data: {
                toolCall: record,
                result,
              },
            };

            // 将工具结果添加到上下文
            fullMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [toolCall],
            });
            fullMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          }
        } else {
          // 没有工具调用，这是最终响应
          finalMessage = aiResponse.message || '';
          break;
        }
      }

      // 如果达到最大工具调用次数
      if (toolCallCount >= this.config.maxToolCalls && !finalMessage) {
        finalMessage = `已达到最大工具调用次数（${this.config.maxToolCalls}次）。请简化你的请求或分多次执行。`;
      }

      // 保存对话
      messages.push({
        role: 'assistant',
        content: finalMessage,
        timestamp: new Date().toISOString(),
        toolCalls: toolCalls.map(tc => ({
          toolName: tc.toolName,
          parameters: tc.parameters,
          status: tc.status,
        })),
      });

      await this.saveConversation(conversationId, request.userId, request.userName, messages);

      // 发送最终消息
      yield {
        type: 'message',
        data: {
          content: finalMessage,
          conversationId,
          toolCalls,
        },
      };

      // 完成
      yield { type: 'done', data: { conversationId } };

      log.info(`Agent 请求完成: ${toolCallCount} 次工具调用, 耗时 ${Date.now() - startTime}ms`, traceId);

    } catch (error: any) {
      log.error(`Agent 请求失败: ${error.message}`, traceId);
      yield { type: 'error', data: { message: error.message } };
    }
  }

  /**
   * 执行工具
   */
  async executeTool(toolName: string, parameters: Record<string, any>): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`执行工具: ${toolName}`, traceId, { parameters });

    try {
      switch (toolName) {
        // 原有工具
        case 'list_reports':
          return await this.toolListReports(parameters);
        case 'get_report_detail':
          return await this.toolGetReportDetail(parameters);
        case 'get_report_files':
          return await this.toolGetReportFiles(parameters);
        case 'list_scripts':
          return await this.toolListScripts(parameters);
        case 'get_script_detail':
          return await this.toolGetScriptDetail(parameters);
        case 'get_script_logs':
          return await this.toolGetScriptLogs(parameters);
        case 'get_system_status':
          return await this.toolGetSystemStatus();
        case 'get_operation_logs':
          return await this.toolGetOperationLogs(parameters);
        case 'create_script':
          return await this.toolCreateScript(parameters);
        case 'update_script':
          return await this.toolUpdateScript(parameters);
        case 'run_script':
          return await this.toolRunScript(parameters);
        case 'delete_report':
          return await this.toolDeleteReport(parameters);
        case 'update_settings':
          return await this.toolUpdateSettings(parameters);
        
        // 文件操作工具
        case 'extract_archive':
          return await toolExtractArchive(parameters);
        case 'list_directory':
          return await toolListDirectory(parameters);
        case 'read_file':
          return await toolReadFile(parameters);
        case 'execute_command':
          return await toolExecuteCommand(parameters);
        
        // 网页访问与知识增强工具
        case 'web_search':
          return await toolWebSearch(parameters);
        case 'fetch_webpage':
          return await toolFetchWebpage(parameters);
        case 'knowledge_base_search':
          return await toolKnowledgeBaseSearch(parameters);
        case 'add_knowledge':
          return await toolAddKnowledge(parameters);
        
        default:
          return { success: false, error: `未知工具: ${toolName}` };
      }
    } catch (error: any) {
      log.error(`工具执行失败: ${toolName}`, traceId, { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 确认并执行待确认的操作
   */
  async confirmAction(actionId: string): Promise<ToolResult> {
    const action = this.pendingActions.get(actionId);
    if (!action) {
      return { success: false, error: '操作不存在或已过期' };
    }

    this.pendingActions.delete(actionId);
    return await this.executeTool(action.toolName, action.parameters);
  }

  /**
   * 取消待确认的操作
   */
  cancelAction(actionId: string): boolean {
    return this.pendingActions.delete(actionId);
  }

  /**
   * 获取待确认操作列表
   */
  getPendingActions(): PendingAction[] {
    return Array.from(this.pendingActions.values());
  }

  // ═══════════════════════════════════════════════════════
  //  工具实现
  // ═══════════════════════════════════════════════════════

  private async toolListReports(params: any): Promise<ToolResult> {
    try {
      const { status, userId, region, keyword, limit = 20, offset = 0 } = params;
      
      // 构建查询条件
      const query: any = {};
      if (status) query.status = status;
      if (userId) query.userId = userId;
      if (region) query.region = region;

      let reports = await reportRepository.findAll(query);

      // 关键词过滤
      if (keyword) {
        const kw = keyword.toLowerCase();
        reports = reports.filter((r: any) => 
          (r.title && r.title.toLowerCase().includes(kw)) ||
          (r.description && r.description.toLowerCase().includes(kw))
        );
      }

      // 分页
      const total = reports.length;
      reports = reports.slice(offset, offset + limit);

      return {
        success: true,
        data: {
          reports: reports.map((r: any) => ({
            id: r.id,
            title: r.title || `报告 ${r.id}`,
            status: r.status,
            userId: r.userId,
            userName: r.userName,
            region: r.region,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
          total,
          limit,
          offset,
        },
        message: `找到 ${total} 个报告`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolGetReportDetail(params: any): Promise<ToolResult> {
    try {
      const { reportId } = params;
      const report = await reportRepository.findById(reportId);

      if (!report) {
        return { success: false, error: '报告不存在' };
      }

      return {
        success: true,
        data: report,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolGetReportFiles(params: any): Promise<ToolResult> {
    try {
      const { reportId } = params;
      const report = await reportRepository.findById(reportId);

      if (!report) {
        return { success: false, error: '报告不存在' };
      }

      return {
        success: true,
        data: { files: report.filePaths || [] },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolListScripts(params: any): Promise<ToolResult> {
    try {
      const { status, keyword, scriptType, limit = 20 } = params;
      
      const query: any = {};
      if (status) query.status = status;
      if (scriptType) query.scriptType = scriptType;

      let scripts = await scriptRepository.findAll(query);

      // 关键词过滤
      if (keyword) {
        const kw = keyword.toLowerCase();
        scripts = scripts.filter((s: any) => 
          (s.name && s.name.toLowerCase().includes(kw)) ||
          (s.description && s.description.toLowerCase().includes(kw))
        );
      }

      scripts = scripts.slice(0, limit);

      return {
        success: true,
        data: {
          scripts: scripts.map((s: any) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            scriptType: s.scriptType,
            status: s.status,
            createdAt: s.createdAt,
          })),
          total: scripts.length,
        },
        message: `找到 ${scripts.length} 个脚本`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolGetScriptDetail(params: any): Promise<ToolResult> {
    try {
      const { scriptId } = params;
      const script = await scriptRepository.findById(scriptId);

      if (!script) {
        return { success: false, error: '脚本不存在' };
      }

      return {
        success: true,
        data: script,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolGetScriptLogs(params: any): Promise<ToolResult> {
    try {
      const { scriptId, reportId, limit = 100 } = params;
      
      // 查询关联的报告
      let query: any = { scriptId };
      if (reportId) {
        query.id = reportId;
      }
      
      const reports = await reportRepository.findAll(query);
      
      if (reports.length === 0) {
        return {
          success: true,
          data: { logs: [], total: 0 },
          message: `脚本 ${scriptId} 没有运行记录`,
        };
      }
      
      // 提取日志（最新的报告）
      const latestReport = reports[reports.length - 1];
      let logs: string[] = [];
      if (latestReport.logs && Array.isArray(latestReport.logs)) {
        logs = latestReport.logs;
      }
      
      // 限制返回数量
      const limitedLogs = logs.slice(-limit);
      
      return {
        success: true,
        data: {
          logs: limitedLogs,
          total: logs.length,
          reportId: latestReport.id,
          reportName: latestReport.name,
          status: latestReport.status,
          generatedAt: latestReport.generatedAt,
        },
        message: `找到 ${logs.length} 条日志记录`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolGetSystemStatus(): Promise<ToolResult> {
    try {
      const config = getConfig();
      
      return {
        success: true,
        data: {
          version: '0.3.0',
          uptime: process.uptime(),
          dataDir: config.DATA_DIR,
          port: config.PORT,
          nodeVersion: process.version,
          platform: process.platform,
          memoryUsage: process.memoryUsage(),
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolGetOperationLogs(params: any): Promise<ToolResult> {
    try {
      const { action, userId, limit = 50, offset = 0 } = params;
      
      // 从日志文件中读取操作日志
      const fs = require('fs');
      const path = require('path');
      const config = getConfig();
      
      const logDir = config.LOGS_DIR;
      const logFile = path.join(logDir, 'app.log');
      
      if (!fs.existsSync(logFile)) {
        return {
          success: true,
          data: { logs: [], total: 0 },
          message: '日志文件不存在',
        };
      }
      
      // 读取日志文件
      const logContent = fs.readFileSync(logFile, 'utf-8');
      const logLines = logContent.split('\n').filter((line: string) => line.trim());
      
      // 解析日志行
      let logs = logLines.map((line: string) => {
        try {
          // 解析日志格式：[时间戳] [级别] [模块名] [TraceID] 消息内容
          const match = line.match(/\[(.*?)\]\s+\[(.*?)\]\s+\[(.*?)\]\s+\[(.*?)\]\s+(.*)/);
          if (match) {
            return {
              timestamp: match[1],
              level: match[2],
              module: match[3],
              traceId: match[4],
              message: match[5],
            };
          }
          return { raw: line };
        } catch (e) {
          return { raw: line };
        }
      });
      
      // 过滤条件
      if (action) {
        logs = logs.filter((log: any) => 
          log.message && log.message.toLowerCase().includes(action.toLowerCase())
        );
      }
      
      if (userId) {
        logs = logs.filter((log: any) => 
          log.message && log.message.includes(userId)
        );
      }
      
      // 分页
      const total = logs.length;
      logs = logs.slice(offset, offset + limit);
      
      return {
        success: true,
        data: {
          logs,
          total,
          limit,
          offset,
        },
        message: `找到 ${total} 条操作日志`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolCreateScript(params: any): Promise<ToolResult> {
    try {
      const { name, description, scriptType, content, requirements } = params;

      const script = {
        id: `script_${Date.now()}_${uuidv4().substring(0, 9)}`,
        name,
        description: description || '',
        scriptType,
        region: 'default', // 默认区域
        inputFormats: '',
        inputFormatManual: false,
        version: '1.0.0',
        category: 'custom',
        fileName: `${name}.${scriptType}`,
        filePath: '',
        fileHash: '',
        fileSize: 0,
        templateRequired: false,
        templateIds: [],
        auxiliaryFiles: [],
        requirements: requirements ? requirements.split(',').map((r: string) => r.trim()) : [],
        depsStatus: {
          status: 'none',
          log: '',
          packages: [],
        },
        content,
        status: 'active',
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'agent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await scriptRepository.create(script as any);

      return {
        success: true,
        data: script,
        message: `脚本 "${name}" 创建成功`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolUpdateScript(params: any): Promise<ToolResult> {
    try {
      const { scriptId, ...updates } = params;

      const existing = await scriptRepository.findById(scriptId);
      if (!existing) {
        return { success: false, error: '脚本不存在' };
      }

      const updated = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      await scriptRepository.update(scriptId, updated);

      return {
        success: true,
        data: { id: scriptId, ...updated },
        message: '脚本更新成功',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolRunScript(params: any): Promise<ToolResult> {
    try {
      const { scriptId, templateId, inputFiles } = params;
      
      // 检查脚本是否存在
      const script = await scriptRepository.findById(scriptId);
      if (!script) {
        return { success: false, error: '脚本不存在' };
      }
      
      // 检查模板是否存在（如果提供了模板ID）
      if (templateId) {
        const template = await templateRepository.findById(templateId);
        if (!template) {
          return { success: false, error: '模板不存在' };
        }
      }
      
      // 这里需要调用报告生成服务
      // 由于报告生成是异步的，我们需要通过HTTP调用报告生成API
      const http = require('http');
      const config = getConfig();
      
      const postData = JSON.stringify({
        scriptId,
        templateId: templateId || null,
        inputFiles: inputFiles || [],
      });
      
      const options = {
        hostname: 'localhost',
        port: config.PORT,
        path: '/api/reports/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      
      return new Promise((resolve, reject) => {
        const req = http.request(options, (res: any) => {
          let data = '';
          
          res.on('data', (chunk: any) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (res.statusCode === 200 || res.statusCode === 201) {
                resolve({
                  success: true,
                  data: {
                    reportId: response.data?.reportId,
                    scriptId,
                    scriptName: script.name,
                    status: 'started',
                    message: '脚本运行已启动，报告正在生成中',
                  },
                  message: `脚本 "${script.name}" 开始运行，报告ID: ${response.data?.reportId}`,
                });
              } else {
                resolve({
                  success: false,
                  error: response.error || response.message || '脚本运行失败',
                });
              }
            } catch (e: any) {
              resolve({
                success: false,
                error: `解析响应失败: ${e.message}`,
              });
            }
          });
        });
        
        req.on('error', (error: any) => {
          resolve({
            success: false,
            error: `请求失败: ${error.message}`,
          });
        });
        
        req.write(postData);
        req.end();
      });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolDeleteReport(params: any): Promise<ToolResult> {
    try {
      const { reportId } = params;

      const existing = await reportRepository.findById(reportId);
      if (!existing) {
        return { success: false, error: '报告不存在' };
      }

      await reportRepository.delete(reportId);

      return {
        success: true,
        data: { id: reportId },
        message: '报告已删除',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolUpdateSettings(params: any): Promise<ToolResult> {
    try {
      const { key, value } = params;
      
      // 检查是否是允许修改的设置
      const allowedSettings = [
        'LOG_FORMAT',
        'ALLOWED_ORIGINS',
        'PYTHON_PIP_INDEX_URL',
      ];
      
      if (!allowedSettings.includes(key)) {
        return {
          success: false,
          error: `设置 "${key}" 不允许通过 API 修改。允许的设置: ${allowedSettings.join(', ')}`,
        };
      }
      
      // 读取当前的 .env 文件
      const fs = require('fs');
      const path = require('path');
      const config = getConfig();
      
      const envPath = path.join(__dirname, '..', '..', '.env');
      
      if (!fs.existsSync(envPath)) {
        return {
          success: false,
          error: '.env 文件不存在',
        };
      }
      
      // 读取 .env 文件内容
      let envContent = fs.readFileSync(envPath, 'utf-8');
      
      // 检查是否已存在该设置
      const regex = new RegExp(`^${key}=.*$`, 'm');
      
      if (regex.test(envContent)) {
        // 更新现有设置
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        // 添加新设置
        envContent += `\n${key}=${value}`;
      }
      
      // 写入 .env 文件
      fs.writeFileSync(envPath, envContent, 'utf-8');
      
      // 更新环境变量
      process.env[key] = value;
      
      return {
        success: true,
        data: {
          key,
          value,
          message: '设置已更新，部分设置可能需要重启服务才能生效',
        },
        message: `设置 "${key}" 已更新为 "${value}"`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════
  //  辅助方法
  // ═══════════════════════════════════════════════════════

  /**
   * 调用 AI API（统一入口）
   */
  private async callAI(userId: string, messages: any[]): Promise<any> {
    try {
      // 动态导入统一 AI 入口，避免模块加载循环
      const { callUserAI } = await import('./aiProviderService');

      // 获取工具定义（OpenAI 格式）
      const tools = getOpenAIToolDefinitions();

      // 调用统一 AI 入口（按用户配置解析厂商模型）
      const response = await callUserAI(userId, {
        messages,
        tools,
        feature: 'agent',
      });

      return {
        message: response.message,
        toolCalls: response.toolCalls || [],
      };
    } catch (error: any) {
      log.error(`AI 调用失败: ${error.message}`);

      // 返回错误信息给用户（保持原有契约：出错不抛出，返回错误文案消息）
      return {
        message: `AI 服务调用失败: ${error.message}`,
        toolCalls: [],
      };
    }
  }

  /**
   * 压缩上下文
   */
  private compressContext(messages: any[]): any[] {
    // 保留最近 20 条消息
    const maxMessages = 20;
    if (messages.length <= maxMessages) {
      return messages;
    }

    // 保留最近的消息
    return messages.slice(-maxMessages);
  }

  /**
   * 生成操作描述
   */
  private generateActionDescription(toolName: string, parameters: Record<string, any>): string {
    switch (toolName) {
      case 'create_script':
        return `创建脚本: ${parameters.name}`;
      case 'update_script':
        return `更新脚本: ${parameters.scriptId}`;
      case 'run_script':
        return `运行脚本: ${parameters.scriptId}`;
      case 'delete_report':
        return `删除报告: ${parameters.reportId}`;
      case 'update_settings':
        return `更新设置: ${parameters.key}`;
      default:
        return `执行操作: ${toolName}`;
    }
  }

  /**
   * 保存对话
   */
  private async saveConversation(
    conversationId: string,
    userId: string,
    userName: string | undefined,
    messages: any[]
  ): Promise<void> {
    try {
      const existing = await conversationRepository.findById(conversationId);

      if (existing) {
        await conversationRepository.update(conversationId, {
          messages,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await conversationRepository.create({
          id: conversationId,
          userId,
          userName: userName || '',
          messages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      log.error(`保存对话失败: ${error.message}`);
    }
  }
}

/**
 * Agent 服务单例
 */
export const agentService = new AgentService();

// ═══════════════════════════════════════════════════════
//  文件操作工具方法
// ═══════════════════════════════════════════════════════

/**
 * 解压压缩包工具
 */
async function toolExtractArchive(params: any): Promise<ToolResult> {
  return await fileOperationService.extractArchive(
    params.archivePath,
    params.targetDir,
    params.password
  );
}

/**
 * 浏览目录工具
 */
async function toolListDirectory(params: any): Promise<ToolResult> {
  return await fileOperationService.listDirectory(
    params.dirPath,
    params.recursive,
    params.pattern,
    params.maxDepth
  );
}

/**
 * 读取文件工具
 */
async function toolReadFile(params: any): Promise<ToolResult> {
  return await fileOperationService.readFile(
    params.filePath,
    params.encoding,
    params.maxLines,
    params.startLine
  );
}

/**
 * 执行命令工具
 */
async function toolExecuteCommand(params: any): Promise<ToolResult> {
  return await fileOperationService.executeCommand(
    params.command,
    params.args,
    params.workDir,
    params.timeout
  );
}

/**
 * 网络搜索工具
 */
async function toolWebSearch(params: any): Promise<ToolResult> {
  return await webAccessService.webSearch(
    params.query,
    params.limit,
    params.domain
  );
}

/**
 * 网页抓取工具
 */
async function toolFetchWebpage(params: any): Promise<ToolResult> {
  return await webAccessService.fetchWebpage(
    params.url,
    params.selector,
    params.extractText
  );
}

/**
 * 知识库搜索工具
 */
async function toolKnowledgeBaseSearch(params: any): Promise<ToolResult> {
  return await knowledgeBaseService.searchKnowledge(
    params.query,
    params.category,
    params.serverType,
    params.limit
  );
}

/**
 * 添加知识工具
 */
async function toolAddKnowledge(params: any): Promise<ToolResult> {
  return await knowledgeBaseService.addKnowledge({
    title: params.title,
    content: params.content,
    category: params.category,
    serverType: params.serverType,
    tags: params.tags || [],
    source: params.source,
  });
}
