/**
 * AI 分析服务模块
 * 
 * 本模块提供 AI 分析相关的业务逻辑，包括：
 * 1. 文件内容提取
 * 2. 流式 AI 分析
 * 3. 类别提示词模板
 * 
 * @module analysisService
 */

import fs from 'fs/promises';
import path from 'path';
import { getLogger, generateTraceId } from '../utils/logger';
import { getConfig } from '../config';
import { callUserAI } from './aiProviderService';

// 日志实例
const log = getLogger('AnalysisService', 'core');

/**
 * 分析类别
 */
export type AnalysisCategory = 
  | 'host'           // 主机巡检
  | 'storage'        // 存储巡检
  | 'database'       // 数据库巡检
  | 'virtualization' // 虚拟化巡检
  | 'network'        // 网络巡检
  | 'security'       // 安全巡检
  | 'performance'    // 性能分析
  | 'general';       // 通用分析

/**
 * 分析请求
 */
export interface AnalysisRequest {
  /** 用户 ID（用于解析该用户的 AI 模型配置） */
  userId: string;
  /** 数据库模型记录 ID；缺省用用户默认模型 */
  modelId?: string;
  /** 文件路径或内容 */
  file?: {
    path?: string;
    content?: string;
    name?: string;
  };
  /** 分析类别 */
  category: AnalysisCategory;
  /** 用户提示词 */
  userPrompt?: string;
  /** 资产补充信息 */
  supplements?: any[];
  /** 是否流式响应 */
  stream?: boolean;
}

/**
 * 分析响应
 */
export interface AnalysisResponse {
  /** 分析结果 */
  result: string;
  /** 建议 */
  suggestions?: string[];
  /** 问题列表 */
  issues?: Array<{
    severity: 'high' | 'medium' | 'low';
    description: string;
    location?: string;
  }>;
  /** 统计信息 */
  stats?: Record<string, any>;
}

/**
 * 类别提示词模板
 */
const CATEGORY_PROMPTS: Record<AnalysisCategory, string> = {
  host: `你是一名专业的主机运维工程师。请分析以下主机巡检报告，重点关注：
1. 系统资源使用情况（CPU、内存、磁盘）
2. 系统服务状态
3. 安全配置和补丁状态
4. 日志中的异常和错误
5. 性能瓶颈和优化建议

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  storage: `你是一名专业的存储工程师。请分析以下存储巡检报告，重点关注：
1. 存储容量使用情况
2. RAID 状态和健康度
3. 磁盘 I/O 性能
4. 存储控制器状态
5. 备份和恢复状态

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  database: `你是一名专业的数据库管理员。请分析以下数据库巡检报告，重点关注：
1. 数据库连接和会话状态
2. 表空间使用情况
3. 慢查询和性能问题
4. 备份和恢复状态
5. 安全配置和权限

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  virtualization: `你是一名专业的虚拟化工程师。请分析以下虚拟化巡检报告，重点关注：
1. 宿主机资源使用情况
2. 虚拟机状态和配置
3. 存储和网络配置
4. 高可用性和容灾状态
5. 性能优化建议

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  network: `你是一名专业的网络工程师。请分析以下网络巡检报告，重点关注：
1. 网络设备状态
2. 带宽使用情况
3. 网络安全配置
4. 故障和告警信息
5. 性能优化建议

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  security: `你是一名专业的安全工程师。请分析以下安全巡检报告，重点关注：
1. 系统漏洞和补丁状态
2. 安全配置和策略
3. 访问控制和权限
4. 安全日志和事件
5. 安全加固建议

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  performance:`你是一名专业的性能工程师。请分析以下性能数据，重点关注：
1. 系统资源使用趋势
2. 性能瓶颈识别
3. 响应时间和吞吐量
4. 并发和负载情况
5. 性能优化建议

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,

  general: `你是一名专业的运维工程师。请分析以下巡检报告，重点关注：
1. 系统整体健康状态
2. 主要问题和风险
3. 性能和资源使用情况
4. 安全和合规性
5. 改进建议和优先级

请提供详细的分析报告，包括发现的问题、严重程度和改进建议。`,
};

/**
 * AI 分析服务类
 */
export class AnalysisService {
  /**
   * 提取文件内容
   */
  async extractFileContent(filePath: string): Promise<string> {
    const traceId = generateTraceId();
    log.info(`提取文件内容: ${filePath}`, traceId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      log.info(`文件内容提取成功: ${content.length} 字符`, traceId);
      return content;
    } catch (error: any) {
      log.error(`文件内容提取失败: ${error.message}`, traceId);
      throw new Error(`无法读取文件: ${error.message}`);
    }
  }

  /**
   * 获取类别提示词
   */
  getCategoryPrompt(category: AnalysisCategory): string {
    return CATEGORY_PROMPTS[category] || CATEGORY_PROMPTS.general;
  }

  /**
   * 构建分析提示词
   */
  buildAnalysisPrompt(request: AnalysisRequest): string {
    const categoryPrompt = this.getCategoryPrompt(request.category);
    const userPrompt = request.userPrompt || '';
    
    let fileContent = '';
    if (request.file?.content) {
      fileContent = `\n\n文件内容:\n${request.file.content}`;
    } else if (request.file?.path) {
      fileContent = `\n\n文件路径: ${request.file.path}`;
    }

    // 构建补充信息部分
    let supplementSection = '';
    if (request.supplements && request.supplements.length > 0) {
      supplementSection = '\n\n## 补充信息\n';
      supplementSection += '以下为用户提供的资产补充信息，请在分析时参考这些信息：\n\n';
      
      // 按资产类型分组
      const groupedSupplements: Record<string, any[]> = {};
      for (const supplement of request.supplements) {
        if (!groupedSupplements[supplement.asset_type]) {
          groupedSupplements[supplement.asset_type] = [];
        }
        groupedSupplements[supplement.asset_type].push(supplement);
      }
      
      // 输出每种类型的补充信息
      for (const [assetType, typeSupplements] of Object.entries(groupedSupplements)) {
        supplementSection += `### ${this.getAssetTypeLabel(assetType)}\n`;
        
        for (const supplement of typeSupplements) {
          if (supplement.field_value) {
            supplementSection += `- **${supplement.field_name}**: ${supplement.field_value}\n`;
          } else if (supplement.parsed_content) {
            supplementSection += `- **${supplement.field_name}** (文件: ${supplement.file_name}):\n`;
            supplementSection += '```plaintext\n';
            supplementSection += supplement.parsed_content.substring(0, 1000); // 限制显示长度
            if (supplement.parsed_content.length > 1000) {
              supplementSection += '\n... (内容已截断)';
            }
            supplementSection += '\n```\n';
          }
        }
        supplementSection += '\n';
      }
    }

    return `${categoryPrompt}
${supplementSection}

${userPrompt}

请根据以上要求分析巡检报告，并提供：
1. 问题总结（按严重程度排序）
2. 详细分析（每个问题的原因和影响）
3. 改进建议（具体可操作的措施）
4. 优先级建议（哪些问题需要立即处理）

请使用 Markdown 格式输出分析结果。${fileContent}`;
  }

  /**
   * 获取资产类型标签
   */
  private getAssetTypeLabel(assetType: string): string {
    const labels: Record<string, string> = {
      host: '服务器信息',
      storage: '存储信息',
      virtualization: '虚拟化信息',
      network: '网络设备信息',
      database: '数据库信息'
    };
    return labels[assetType] || assetType;
  }

  /**
   * 执行 AI 分析
   */
  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    const traceId = generateTraceId();
    log.info(`开始 AI 分析: ${request.category}`, traceId);

    try {
      // 提取文件内容（如果提供了文件路径）
      let fileContent = request.file?.content;
      if (request.file?.path && !fileContent) {
        fileContent = await this.extractFileContent(request.file.path);
      }

      // 构建提示词
      const prompt = this.buildAnalysisPrompt({
        ...request,
        file: {
          ...request.file,
          content: fileContent,
        },
      });

      // 调用统一 AI 入口（按用户配置解析厂商模型）
      const response = await callUserAI(request.userId, {
        messages: [
          { role: 'system', content: '你是一名专业的运维工程师，擅长分析各类巡检报告。' },
          { role: 'user', content: prompt },
        ],
        modelId: request.modelId,
        feature: 'report_analysis',
      });

      log.info(`AI 分析完成`, traceId);

      return {
        result: response.message,
      };
    } catch (error: any) {
      log.error(`AI 分析失败: ${error.message}`, traceId);
      throw new Error(`AI 分析失败: ${error.message}`);
    }
  }

  /**
   * 执行流式 AI 分析
   */
  async *analyzeStream(request: AnalysisRequest): AsyncGenerator<string> {
    const traceId = generateTraceId();
    log.info(`开始流式 AI 分析: ${request.category}`, traceId);

    try {
      // 提取文件内容（如果提供了文件路径）
      let fileContent = request.file?.content;
      if (request.file?.path && !fileContent) {
        fileContent = await this.extractFileContent(request.file.path);
      }

      // 构建提示词
      const prompt = this.buildAnalysisPrompt({
        ...request,
        file: {
          ...request.file,
          content: fileContent,
        },
      });

      // 调用统一 AI 入口（旧实现 stream:true 实际也是非流式返回，直接用非流式调用，行为不变）
      const response = await callUserAI(request.userId, {
        messages: [
          { role: 'system', content: '你是一名专业的运维工程师，擅长分析各类巡检报告。' },
          { role: 'user', content: prompt },
        ],
        modelId: request.modelId,
        feature: 'report_analysis',
      });

      // 一次性返回完整结果（与旧行为一致）
      yield response.message;

      log.info(`流式 AI 分析完成`, traceId);
    } catch (error: any) {
      log.error(`流式 AI 分析失败: ${error.message}`, traceId);
      throw new Error(`流式 AI 分析失败: ${error.message}`);
    }
  }

  /**
   * 获取支持的分析类别
   */
  getSupportedCategories(): Array<{ id: AnalysisCategory; name: string; description: string }> {
    return [
      { id: 'host', name: '主机巡检', description: '分析主机系统资源、服务状态、安全配置等' },
      { id: 'storage', name: '存储巡检', description: '分析存储容量、RAID状态、磁盘IO等' },
      { id: 'database', name: '数据库巡检', description: '分析数据库连接、表空间、慢查询等' },
      { id: 'virtualization', name: '虚拟化巡检', description: '分析宿主机资源、虚拟机状态、高可用等' },
      { id: 'network', name: '网络巡检', description: '分析网络设备状态、带宽使用、安全配置等' },
      { id: 'security', name: '安全巡检', description: '分析系统漏洞、安全配置、访问控制等' },
      { id: 'performance', name: '性能分析', description: '分析系统资源使用趋势、性能瓶颈等' },
      { id: 'general', name: '通用分析', description: '通用巡检报告分析' },
    ];
  }
}

/**
 * AI 分析服务单例
 */
export const analysisService = new AnalysisService();
