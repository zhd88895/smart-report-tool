/**
 * 本地知识库服务模块
 * 
 * 提供本地知识库的构建和检索能力，包括：
 * 1. 知识导入和存储
 * 2. 知识检索和查询
 * 3. 知识分类和标签管理
 * 4. 知识融合和上下文构建
 * 
 * @module knowledgeBaseService
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getLogger, generateTraceId } from '../utils/logger';
import { getConfig } from '../config';
import { ToolResult } from './agentTools';

const log = getLogger('KnowledgeBaseService', 'core');

/**
 * 知识条目接口
 */
export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: 'configuration' | 'troubleshooting' | 'manual' | 'history';
  serverType?: string;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

/**
 * 知识库统计信息
 */
export interface KnowledgeStats {
  totalEntries: number;
  byCategory: Record<string, number>;
  byServerType: Record<string, number>;
  lastUpdated: string;
}

/**
 * 本地知识库服务类
 */
export class KnowledgeBaseService {
  private dataDir: string;
  private knowledgeDir: string;
  private knowledgeIndex: Map<string, KnowledgeEntry> = new Map();

  constructor() {
    const config = getConfig();
    this.dataDir = config.DATA_DIR;
    this.knowledgeDir = path.join(this.dataDir, 'knowledge-base');
    
    // 确保知识库目录存在
    if (!existsSync(this.knowledgeDir)) {
      mkdirSync(this.knowledgeDir, { recursive: true });
    }
  }

  /**
   * 初始化知识库
   */
  async initialize(): Promise<void> {
    const traceId = generateTraceId();
    log.info('初始化知识库', traceId);

    try {
      // 加载知识库索引
      await this.loadKnowledgeIndex();
      
      // 如果索引为空，创建示例知识
      if (this.knowledgeIndex.size === 0) {
        await this.createSampleKnowledge();
      }
      
      log.info(`知识库初始化完成，共 ${this.knowledgeIndex.size} 条知识`, traceId);
    } catch (error: any) {
      log.error(`知识库初始化失败: ${error.message}`, traceId);
    }
  }

  /**
   * 加载知识库索引
   */
  private async loadKnowledgeIndex(): Promise<void> {
    try {
      const indexPath = path.join(this.knowledgeDir, 'index.json');
      if (existsSync(indexPath)) {
        const indexData = await fs.readFile(indexPath, 'utf-8');
        const entries: KnowledgeEntry[] = JSON.parse(indexData);
        
        for (const entry of entries) {
          this.knowledgeIndex.set(entry.id, entry);
        }
      }
    } catch (error: any) {
      log.warn(`加载知识库索引失败: ${error.message}`);
    }
  }

  /**
   * 保存知识库索引
   */
  private async saveKnowledgeIndex(): Promise<void> {
    try {
      const indexPath = path.join(this.knowledgeDir, 'index.json');
      const entries = Array.from(this.knowledgeIndex.values());
      await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error: any) {
      log.error(`保存知识库索引失败: ${error.message}`);
    }
  }

  /**
   * 创建示例知识
   */
  private async createSampleKnowledge(): Promise<void> {
    const sampleKnowledge: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        title: 'DELL R740 服务器配置指南',
        content: `DELL R740 服务器标准配置：
- CPU: 2x Intel Xeon Silver 4210R (10C/20T, 2.4GHz)
- 内存: 16x 16GB DDR4-2933MHz RDIMM (256GB)
- 存储: 8x 2.4TB 10K SAS HDD (RAID 10)
- 网络: 2x 10GbE SFP+ + 2x 1GbE RJ45
- 电源: 2x 750W Platinum PSU
- 管理: iDRAC9 Enterprise

BIOS设置建议：
1. 启用虚拟化技术 (VT-x/VT-d)
2. 设置性能模式为"Maximum Performance"
3. 启用SR-IOV支持
4. 配置启动顺序：UEFI: Hard Disk > Network`,
        category: 'configuration',
        serverType: 'DELL',
        tags: ['DELL', 'R740', '服务器配置', 'BIOS'],
        source: '内部运维手册',
      },
      {
        title: 'DELL服务器硬盘故障处理流程',
        content: `故障现象：
- 硬盘指示灯红色闪烁
- 系统日志显示"Predictive Failure"告警
- RAID降级告警

处理步骤：
1. 登录iDRAC管理界面，查看Physical Disks状态
2. 确认故障硬盘位置（Slot号）
3. 准备同型号替换硬盘
4. 执行热插拔更换（服务器支持热插拔）
5. 等待RAID自动重建（约2-4小时）
6. 验证RAID状态恢复为Optimal
7. 记录故障信息到知识库

注意事项：
- 确保替换硬盘容量≥原硬盘
- 建议使用DELL原装硬盘
- 重建期间避免大规模读写操作`,
        category: 'troubleshooting',
        serverType: 'DELL',
        tags: ['DELL', '硬盘故障', 'RAID', '热插拔'],
        source: '历史故障记录',
      },
      {
        title: 'H3C交换机基础配置',
        content: `基础配置命令：

# 进入系统视图
system-view

# 配置设备名称
sysname Switch-01

# 配置VLAN
vlan 10
 name Sales
quit

vlan 20
 name Technical
quit

# 配置接口
interface GigabitEthernet 1/0/1
 port link-type access
 port access vlan 10
quit

# 配置Trunk
interface GigabitEthernet 1/0/24
 port link-type trunk
 port trunk permit vlan all
quit

# 保存配置
save

# 查看配置
display current-configuration`,
        category: 'manual',
        serverType: 'H3C',
        tags: ['H3C', '交换机', 'VLAN', '配置'],
        source: '官方文档',
      },
    ];

    for (const knowledge of sampleKnowledge) {
      await this.addKnowledge(knowledge);
    }
  }

  /**
   * 添加知识
   */
  async addKnowledge(
    knowledge: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`添加知识: ${knowledge.title}`, traceId);

    try {
      const id = `kb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      const entry: KnowledgeEntry = {
        ...knowledge,
        id,
        createdAt: now,
        updatedAt: now,
      };

      // 保存到索引
      this.knowledgeIndex.set(id, entry);

      // 保存到文件
      const filePath = path.join(this.knowledgeDir, `${id}.json`);
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');

      // 保存索引
      await this.saveKnowledgeIndex();

      log.info(`知识添加成功: ${id}`, traceId);

      return {
        success: true,
        data: entry,
        message: `知识 "${knowledge.title}" 添加成功`,
      };
    } catch (error: any) {
      log.error(`知识添加失败: ${error.message}`, traceId);
      return {
        success: false,
        error: `知识添加失败: ${error.message}`,
      };
    }
  }

  /**
   * 搜索知识
   */
  async searchKnowledge(
    query: string,
    category?: string,
    serverType?: string,
    limit: number = 10
  ): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`搜索知识: ${query}`, traceId);

    try {
      const results: KnowledgeEntry[] = [];
      const queryLower = query.toLowerCase();

      // 遍历所有知识条目
      for (const entry of this.knowledgeIndex.values()) {
        // 检查分类过滤
        if (category && category !== 'all' && entry.category !== category) {
          continue;
        }

        // 检查服务器类型过滤
        if (serverType && entry.serverType && entry.serverType !== serverType) {
          continue;
        }

        // 检查关键词匹配
        const titleMatch = entry.title.toLowerCase().includes(queryLower);
        const contentMatch = entry.content.toLowerCase().includes(queryLower);
        const tagMatch = entry.tags.some(tag => 
          tag.toLowerCase().includes(queryLower)
        );

        if (titleMatch || contentMatch || tagMatch) {
          results.push(entry);
        }
      }

      // 按相关性排序（简单匹配度）
      results.sort((a, b) => {
        const aScore = (a.title.toLowerCase().includes(queryLower) ? 10 : 0) +
                      (a.tags.some(t => t.toLowerCase().includes(queryLower)) ? 5 : 0);
        const bScore = (b.title.toLowerCase().includes(queryLower) ? 10 : 0) +
                      (b.tags.some(t => t.toLowerCase().includes(queryLower)) ? 5 : 0);
        return bScore - aScore;
      });

      // 限制结果数量
      const limitedResults = results.slice(0, limit);

      return {
        success: true,
        data: {
          query,
          category,
          serverType,
          results: limitedResults,
          totalResults: results.length,
        },
        message: `找到 ${limitedResults.length} 条相关知识`,
      };
    } catch (error: any) {
      log.error(`知识搜索失败: ${error.message}`, traceId);
      return {
        success: false,
        error: `知识搜索失败: ${error.message}`,
      };
    }
  }

  /**
   * 获取知识库统计
   */
  async getStats(): Promise<KnowledgeStats> {
    const byCategory: Record<string, number> = {};
    const byServerType: Record<string, number> = {};
    let lastUpdated = '';

    for (const entry of this.knowledgeIndex.values()) {
      // 统计分类
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      
      // 统计服务器类型
      if (entry.serverType) {
        byServerType[entry.serverType] = (byServerType[entry.serverType] || 0) + 1;
      }

      // 更新最后修改时间
      if (!lastUpdated || entry.updatedAt > lastUpdated) {
        lastUpdated = entry.updatedAt;
      }
    }

    return {
      totalEntries: this.knowledgeIndex.size,
      byCategory,
      byServerType,
      lastUpdated,
    };
  }

  /**
   * 构建上下文信息
   */
  buildContext(
    query: string,
    serverType?: string,
    maxEntries: number = 5
  ): string {
    const searchResults: KnowledgeEntry[] = [];
    const queryLower = query.toLowerCase();

    // 搜索相关知识
    for (const entry of this.knowledgeIndex.values()) {
      if (serverType && entry.serverType && entry.serverType !== serverType) {
        continue;
      }

      const titleMatch = entry.title.toLowerCase().includes(queryLower);
      const contentMatch = entry.content.toLowerCase().includes(queryLower);
      const tagMatch = entry.tags.some(tag => 
        tag.toLowerCase().includes(queryLower)
      );

      if (titleMatch || contentMatch || tagMatch) {
        searchResults.push(entry);
      }
    }

    // 按相关性排序
    searchResults.sort((a, b) => {
      const aScore = (a.title.toLowerCase().includes(queryLower) ? 10 : 0) +
                    (a.tags.some(t => t.toLowerCase().includes(queryLower)) ? 5 : 0);
      const bScore = (b.title.toLowerCase().includes(queryLower) ? 10 : 0) +
                    (b.tags.some(t => t.toLowerCase().includes(queryLower)) ? 5 : 0);
      return bScore - aScore;
    });

    // 限制数量
    const limitedResults = searchResults.slice(0, maxEntries);

    if (limitedResults.length === 0) {
      return '';
    }

    // 构建上下文
    let context = '\n\n## 本地知识库参考信息\n\n';
    context += '以下是从本地知识库中检索到的相关信息，请在分析时参考：\n\n';

    for (const entry of limitedResults) {
      context += `### ${entry.title}\n`;
      context += `- **分类**: ${entry.category}\n`;
      if (entry.serverType) {
        context += `- **服务器类型**: ${entry.serverType}\n`;
      }
      context += `- **标签**: ${entry.tags.join(', ')}\n`;
      context += `- **来源**: ${entry.source || '未知'}\n`;
      context += `\n${entry.content}\n\n`;
      context += '---\n\n';
    }

    return context;
  }
}

// 导出单例实例
export const knowledgeBaseService = new KnowledgeBaseService();