/**
 * AI 分析服务（支持工具调用）
 * 
 * 扩展 AI 分析功能，支持：
 * 1. 自动解压本地压缩包
 * 2. 浏览解压后的文件目录
 * 3. 读取和解析内部文件
 * 4. 通过本地命令接口执行文件操作
 * 
 * @module aiAnalysisWithTools
 */

import { getLogger, generateTraceId } from '../utils/logger';
import { callUserAI } from './aiProviderService';
import { fileOperationService } from './fileOperationService';
import { webAccessService } from './webAccessService';
import { knowledgeBaseService } from './knowledgeBaseService';
import { getPrompt, CATEGORY_LABELS } from './aiPrompts';
import { AnalysisCategory, AnalysisRequest, AnalysisResponse } from './analysisService';

const log = getLogger('AIAnalysisWithTools', 'core');

/**
 * AI 分析请求（扩展版）
 */
export interface AnalysisRequestWithTools extends AnalysisRequest {
  /** 是否启用工具调用 */
  enableTools?: boolean;
  /** 工作目录 */
  workDir?: string;
  /** 自动解压压缩包 */
  autoExtract?: boolean;
}

/**
 * AI 分析服务（支持工具调用）
 */
export class AIAnalysisWithToolsService {
  /**
   * 分析文件（支持工具调用）
   */
  async analyzeWithTools(request: AnalysisRequestWithTools): Promise<AnalysisResponse> {
    const traceId = generateTraceId();
    log.info(`开始 AI 分析（工具模式）: ${request.category}`, traceId);

    try {
      let fileContent = '';
      let workingDir = request.workDir || '';
      const extractedFiles: string[] = [];

      // 1. 如果提供了文件路径，处理文件
      if (request.file?.path) {
        const filePath = request.file.path;
        
        // 检查是否是压缩包
        if (this.isArchiveFile(filePath)) {
          log.info(`检测到压缩包，自动解压: ${filePath}`, traceId);
          
          // 解压压缩包
          const extractResult = await fileOperationService.extractArchive(filePath);
          if (extractResult.success && extractResult.data) {
            workingDir = extractResult.data.targetDir;
            extractedFiles.push(...this.flattenFileList(extractResult.data.extractedFiles));
            
            log.info(`解压成功，文件数量: ${extractedFiles.length}`, traceId);
            
            // 浏览解压后的目录结构
            const dirResult = await fileOperationService.listDirectory(workingDir, true);
            if (dirResult.success && dirResult.data) {
              fileContent += `\n\n## 文件目录结构\n`;
              fileContent += this.formatDirectoryStructure(dirResult.data);
            }
            
            // 读取关键文件内容
            const keyFiles = this.identifyKeyFiles(extractedFiles);
            for (const keyFile of keyFiles.slice(0, 5)) { // 限制读取5个关键文件
              const readResult = await fileOperationService.readFile(
                keyFile,
                'utf-8',
                200 // 限制读取200行
              );
              if (readResult.success && readResult.data) {
                fileContent += `\n\n## 文件内容: ${keyFile}\n`;
                fileContent += '```plaintext\n';
                fileContent += readResult.data.content;
                fileContent += '\n```\n';
              }
            }
          }
        } else {
          // 普通文件，直接读取
          fileContent = await this.extractFileContent(filePath);
        }
      }

      // 2. 如果有补充信息，添加到文件内容
      if (request.supplements && request.supplements.length > 0) {
        fileContent += '\n\n## 补充信息\n';
        for (const supplement of request.supplements) {
          if (supplement.field_value) {
            fileContent += `- **${supplement.field_name}**: ${supplement.field_value}\n`;
          } else if (supplement.parsed_content) {
            fileContent += `- **${supplement.field_name}**:\n`;
            fileContent += '```plaintext\n';
            fileContent += supplement.parsed_content.substring(0, 1000);
            if (supplement.parsed_content.length > 1000) {
              fileContent += '\n... (内容已截断)';
            }
            fileContent += '\n```\n';
          }
        }
      }

      // 3. 添加本地知识库上下文
      const knowledgeContext = knowledgeBaseService.buildContext(
        fileContent,
        undefined, // 服务器类型可以从补充信息中提取
        5 // 最多5条知识
      );
      if (knowledgeContext) {
        fileContent += knowledgeContext;
      }

      // 4. 构建提示词
      const prompt = getPrompt(
        request.category,
        fileContent,
        request.userPrompt
      );

      // 5. 调用统一 AI 入口（按用户配置解析厂商模型）
      const response = await callUserAI(request.userId, {
        messages: [
          { 
            role: 'system', 
            content: this.getSystemPrompt(request.category) 
          },
          { role: 'user', content: prompt },
        ],
        feature: 'report_analysis',
      });

      log.info(`AI 分析完成（工具模式）`, traceId);

      return {
        result: response.message,
        stats: {
          extractedFiles: extractedFiles.length,
          workingDir,
          keyFilesCount: this.identifyKeyFiles(extractedFiles).length,
        },
      };
    } catch (error: any) {
      log.error(`AI 分析失败（工具模式）: ${error.message}`, traceId);
      throw new Error(`AI 分析失败: ${error.message}`);
    }
  }

  /**
   * 检查是否是压缩包文件
   */
  private isArchiveFile(filePath: string): boolean {
    const archiveExtensions = ['.zip', '.tar', '.gz', '.tgz', '.rar', '.7z'];
    return archiveExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
  }

  /**
   * 展平文件列表
   */
  private flattenFileList(files: any[], prefix: string = ''): string[] {
    const result: string[] = [];
    for (const file of files) {
      const filePath = prefix ? `${prefix}/${file.name}` : file.name;
      if (file.type === 'file') {
        result.push(filePath);
      } else if (file.children) {
        result.push(...this.flattenFileList(file.children, filePath));
      }
    }
    return result;
  }

  /**
   * 格式化目录结构
   */
  private formatDirectoryStructure(files: any[], indent: number = 0): string {
    let result = '';
    const indentStr = '  '.repeat(indent);
    
    for (const file of files) {
      if (file.type === 'directory') {
        result += `${indentStr}📁 ${file.name}/\n`;
        if (file.children) {
          result += this.formatDirectoryStructure(file.children, indent + 1);
        }
      } else {
        const sizeStr = file.size ? ` (${this.formatFileSize(file.size)})` : '';
        result += `${indentStr}📄 ${file.name}${sizeStr}\n`;
      }
    }
    
    return result;
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * 识别关键文件
   */
  private identifyKeyFiles(files: string[]): string[] {
    const keyPatterns = [
      /info\.txt$/i,
      /system\.log$/i,
      /hardware\.info$/i,
      /software\.info$/i,
      /network\.info$/i,
      /storage\.info$/i,
      /virtualization\.info$/i,
      /database\.info$/i,
      /summary\.txt$/i,
      /report\.txt$/i,
      /\.txt$/i,
      /\.log$/i,
      /\.csv$/i,
      /\.xml$/i,
      /\.html$/i,
    ];

    // 优先匹配关键文件
    const keyFiles = files.filter(file => 
      keyPatterns.some(pattern => pattern.test(file))
    );

    // 如果没有匹配到关键文件，返回前5个文件
    if (keyFiles.length === 0) {
      return files.slice(0, 5);
    }

    return keyFiles;
  }

  /**
   * 提取文件内容
   */
  private async extractFileContent(filePath: string): Promise<string> {
    try {
      const result = await fileOperationService.readFile(filePath, 'utf-8', 1000);
      if (result.success && result.data) {
        return result.data.content;
      }
      return '';
    } catch (error: any) {
      log.error(`文件内容提取失败: ${error.message}`);
      return '';
    }
  }

  /**
   * 获取系统提示词
   */
  private getSystemPrompt(category: string): string {
    const categoryLabel = CATEGORY_LABELS[category] || '通用';
    
    return `你是一名专业的${categoryLabel}运维工程师，擅长分析各类巡检报告。

你的能力包括：
1. 分析巡检日志和报告数据
2. 识别故障和告警信息
3. 评估系统健康状态
4. 提供改进建议

你可以使用以下工具来辅助分析：
- 解压压缩包文件
- 浏览文件目录结构
- 读取文件内容
- 执行系统命令
- 网络搜索（查询在线文档、技术论坛）
- 网页抓取（获取技术文档详细内容）
- 本地知识库搜索（查找历史故障记录、配置信息）
- 添加知识到本地知识库

请根据用户提供的文件和补充信息，结合本地知识库和在线资源，进行全面的分析，并提供专业的建议。`;
  }
}

// 导出单例实例
export const aiAnalysisWithToolsService = new AIAnalysisWithToolsService();