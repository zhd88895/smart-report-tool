/**
 * AI 分析提示词模板
 * 按巡检类别提供独立的分析提示词
 */

/** 通用故障告警要求 */
const COMMON_REQUIREMENTS = `请严格遵循以下格式和要求进行分析：

## 通用要求
1. 优先识别并列出日志中的【故障和告警信息】，每条包含：时间戳、严重程度（严重/警告/信息）、来源模块、详细描述
2. 分析正常运行状态，总结性能指标和趋势
3. 如果日志中无明显异常，请明确指出"未发现明显故障"
4. 使用中文回答，语言专业简洁`;

export const ANALYSIS_PROMPTS: Record<string, string> = {
  host: `${COMMON_REQUIREMENTS}

## 主机类专项要求
- 侧重分析：CPU 使用率、内存使用率、磁盘空间和 I/O、进程状态
- 关注：CPU 过载/空闲、内存泄漏/不足、磁盘空间不足/IO延迟高、关键进程异常退出
- 输出格式：先列出【故障告警摘要】，再列出【状态概览】
- 状态概览应包含：主机运行时长、整体负载水平、资源使用趋势`,

  storage: `${COMMON_REQUIREMENTS}

## 存储类专项要求
- 侧重分析：IO 延迟、IOPS、吞吐量、存储容量、RAID 状态、LUN 状态
- 关注：IO延迟突增、容量使用率超阈值、RAID降级/重建、LUN离线、磁盘故障
- 输出格式：先列出【故障告警摘要】，再列出【状态概览】
- 状态概览应包含：总容量/使用率、平均IO延迟、IOPS峰值/均值、健康分布`,

  network: `${COMMON_REQUIREMENTS}

## 网络类专项要求
- 侧重分析：连通性、丢包率、延迟、端口状态、带宽利用率
- 关注：网络中断、高丢包率、延迟抖动、端口异常关闭、流量异常
- 输出格式：先列出【故障告警摘要】，再列出【状态概览】
- 状态概览应包含：网络设备状态汇总、平均延迟/丢包、带宽使用趋势`,

  virtualization: `${COMMON_REQUIREMENTS}

## 虚拟化类专项要求
- 侧重分析：虚拟机运行状态、资源分配与争抢、迁移事件、宿主机健康
- 关注：VM异常关机/重启、CPU/内存资源争抢、磁盘超分配、迁移失败、宿主机过载
- 输出格式：先列出【故障告警摘要】，再列出【状态概览】
- 状态概览应包含：VM总数/运行数、资源超分配比、集群健康状态`,

  database: `${COMMON_REQUIREMENTS}

## 数据库类专项要求
- 侧重分析：连接数、慢查询、锁等待、表空间使用、缓冲池命中率
- 关注：连接数超阈值、慢查询堆积、死锁/锁等待、表空间不足、缓冲池命中率低
- 输出格式：先列出【故障告警摘要】，再列出【状态概览】
- 状态概览应包含：连接数峰值/均值、慢查询TOP N、表空间使用情况、缓冲池命中率`,

  support: `${COMMON_REQUIREMENTS}

## 整机支持包专项要求
输入为服务器支持包（如 BMC 一键收集包）经智能筛选后的关键文件合集，每个文件以「===== 文件: 路径 =====」分隔。

- 输出格式：先列出【故障告警摘要】（按严重程度排序：严重 → 警告 → 信息），再列出【整机健康概览】，最后给出【处理建议】
- 故障告警摘要：每条包含时间、告警级别、部件（如磁盘/RAID/电源/风扇/温度传感器）、问题描述、所在文件
- 整机健康概览，按以下维度归纳：
  - 硬件部件：磁盘、RAID 卡与逻辑盘、内存、CPU、电源、风扇
  - 传感器：温度/电压/功耗是否越限
  - 系统事件：SEL/事件日志中的反复出现或近期的关键事件
  - 固件与配置：固件异常、配置错误、服务异常
- 处理建议：针对每条故障给出可执行的处置动作（如更换磁盘、检查背板、固件升级）
- 注意区分「当前活动告警」与「历史已恢复事件」，历史事件只需概述`,

  other: `${COMMON_REQUIREMENTS}

## 通用分析要求
- 不限定具体方向，全面分析日志中的所有关键信息
- 识别潜在的异常模式和风险点
- 提供改进建议
- 输出格式：先列出【故障告警摘要】，再列出【状态概览】`,
};

/** 获取指定类别的分析提示词 */
export function getPrompt(category: string, fileContent: string, customPrompt?: string, supplements?: any[]): string {
  // 如果用户提供了自定义提示词，使用自定义的
  const systemPart = customPrompt?.trim()
    ? customPrompt
    : (ANALYSIS_PROMPTS[category] || ANALYSIS_PROMPTS.other);

  // 输入内容截断：优先保证所有工作表/文件片段都能被看到；限制 200K 字符以兼容多数模型上下文
  const MAX_CONTENT_LENGTH = 200_000;
  const truncated = fileContent.length > MAX_CONTENT_LENGTH
    ? `${fileContent.slice(0, MAX_CONTENT_LENGTH)}\n\n...（内容过长，已截断，后续部分未传入）`
    : fileContent;

  // 构建补充信息部分
  let supplementSection = '';
  if (supplements && supplements.length > 0) {
    supplementSection = '\n\n## 补充信息\n';
    supplementSection += '以下为用户提供的资产补充信息，请在分析时参考这些信息：\n\n';
    
    // 按资产类型分组
    const groupedSupplements: Record<string, any[]> = {};
    for (const supplement of supplements) {
      if (!groupedSupplements[supplement.asset_type]) {
        groupedSupplements[supplement.asset_type] = [];
      }
      groupedSupplements[supplement.asset_type].push(supplement);
    }
    
    // 输出每种类型的补充信息
    for (const [assetType, typeSupplements] of Object.entries(groupedSupplements)) {
      supplementSection += `### ${getAssetTypeLabel(assetType)}\n`;
      
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

  return `${systemPart}
${supplementSection}

---

以下为日志文件内容（可能包含多个工作表或文件，请综合分析所有部分）：
\`\`\`
${truncated}
\`\`\`

请按照上述要求进行分析，并确保分析覆盖所有工作表/文件片段。`;
}

/**
 * 获取资产类型标签
 */
function getAssetTypeLabel(assetType: string): string {
  const labels: Record<string, string> = {
    host: '服务器信息',
    storage: '存储信息',
    virtualization: '虚拟化信息',
    network: '网络设备信息',
    database: '数据库信息'
  };
  return labels[assetType] || assetType;
}

/** 类别标签映射 */
export const CATEGORY_LABELS: Record<string, string> = {
  host: '主机',
  storage: '存储',
  network: '网络',
  virtualization: '虚拟化',
  database: '数据库',
  support: '整机支持包',
  other: '其他',
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);
