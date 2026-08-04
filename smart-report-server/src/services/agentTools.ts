/**
 * Agent 工具定义模块
 * 
 * 本模块定义了 AI Agent 可以调用的所有工具（Tool），
 * 包括只读工具（自动执行）和写入工具（需用户确认）。
 * 
 * @module agentTools
 */

/**
 * 工具参数定义
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParameter>;
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
  permission: 'read_only' | 'write' | 'dangerous';
  category: 'report' | 'script' | 'system' | 'conversation';
  examples?: Array<{
    description: string;
    parameters: Record<string, any>;
  }>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  truncated?: boolean;
  message?: string;
}

/**
 * 待确认的写入操作
 */
export interface PendingAction {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
}

// ═══════════════════════════════════════════════════════
//  工具定义
// ═══════════════════════════════════════════════════════

/**
 * 只读工具定义列表
 */
export const READ_ONLY_TOOLS: ToolDefinition[] = [
  {
    name: 'list_reports',
    description: '查询报告列表，支持按状态、用户、区域筛选',
    parameters: {
      type: 'object',
      properties: {
        status: {
          name: 'status',
          type: 'string',
          description: '报告状态筛选',
          enum: ['pending', 'running', 'completed', 'failed'],
        },
        userId: {
          name: 'userId',
          type: 'string',
          description: '按创建用户ID筛选',
        },
        region: {
          name: 'region',
          type: 'string',
          description: '按区域筛选',
        },
        keyword: {
          name: 'keyword',
          type: 'string',
          description: '关键词搜索（标题、描述）',
        },
        limit: {
          name: 'limit',
          type: 'number',
          description: '返回数量限制，默认20，最大100',
        },
        offset: {
          name: 'offset',
          type: 'number',
          description: '分页偏移量，默认0',
        },
      },
      required: [],
    },
    permission: 'read_only',
    category: 'report',
    examples: [
      {
        description: '查询最近完成的报告',
        parameters: { status: 'completed', limit: 10 },
      },
      {
        description: '查询某用户的报告',
        parameters: { userId: 'user_123', limit: 20 },
      },
    ],
  },
  {
    name: 'get_report_detail',
    description: '获取单个报告的详细信息，包括状态、文件、生成时间等',
    parameters: {
      type: 'object',
      properties: {
        reportId: {
          name: 'reportId',
          type: 'string',
          description: '报告ID',
          required: true,
        },
      },
      required: ['reportId'],
    },
    permission: 'read_only',
    category: 'report',
    examples: [
      {
        description: '获取报告详情',
        parameters: { reportId: 'rpt_123456' },
      },
    ],
  },
  {
    name: 'get_report_files',
    description: '获取报告关联的文件列表（生成的报告文件）',
    parameters: {
      type: 'object',
      properties: {
        reportId: {
          name: 'reportId',
          type: 'string',
          description: '报告ID',
          required: true,
        },
      },
      required: ['reportId'],
    },
    permission: 'read_only',
    category: 'report',
  },
  {
    name: 'list_scripts',
    description: '查询脚本列表，支持按状态、关键词筛选',
    parameters: {
      type: 'object',
      properties: {
        status: {
          name: 'status',
          type: 'string',
          description: '脚本状态筛选',
          enum: ['active', 'inactive', 'draft'],
        },
        keyword: {
          name: 'keyword',
          type: 'string',
          description: '关键词搜索（名称、描述）',
        },
        scriptType: {
          name: 'scriptType',
          type: 'string',
          description: '脚本类型',
          enum: ['python', 'bat', 'ps1', 'sh'],
        },
        limit: {
          name: 'limit',
          type: 'number',
          description: '返回数量限制',
        },
      },
      required: [],
    },
    permission: 'read_only',
    category: 'script',
  },
  {
    name: 'get_script_detail',
    description: '获取脚本的详细配置信息，包括依赖、参数、运行历史等',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          name: 'scriptId',
          type: 'string',
          description: '脚本ID',
          required: true,
        },
      },
      required: ['scriptId'],
    },
    permission: 'read_only',
    category: 'script',
  },
  {
    name: 'get_script_logs',
    description: '获取脚本的运行日志',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          name: 'scriptId',
          type: 'string',
          description: '脚本ID',
          required: true,
        },
        reportId: {
          name: 'reportId',
          type: 'string',
          description: '指定报告ID的日志（可选）',
        },
        limit: {
          name: 'limit',
          type: 'number',
          description: '返回日志行数，默认100',
        },
      },
      required: ['scriptId'],
    },
    permission: 'read_only',
    category: 'script',
  },
  {
    name: 'get_system_status',
    description: '获取系统运行状态，包括AI配置、依赖状态、数据库状态等',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    permission: 'read_only',
    category: 'system',
  },
  {
    name: 'get_operation_logs',
    description: '查询系统操作日志',
    parameters: {
      type: 'object',
      properties: {
        action: {
          name: 'action',
          type: 'string',
          description: '操作类型筛选',
        },
        userId: {
          name: 'userId',
          type: 'string',
          description: '按用户筛选',
        },
        limit: {
          name: 'limit',
          type: 'number',
          description: '返回数量限制，默认50',
        },
        offset: {
          name: 'offset',
          type: 'number',
          description: '分页偏移量',
        },
      },
      required: [],
    },
    permission: 'read_only',
    category: 'system',
  },
];

/**
 * 写入工具定义列表（需用户确认）
 */
export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'create_script',
    description: '创建新的巡检脚本',
    parameters: {
      type: 'object',
      properties: {
        name: {
          name: 'name',
          type: 'string',
          description: '脚本名称',
          required: true,
        },
        description: {
          name: 'description',
          type: 'string',
          description: '脚本描述',
        },
        scriptType: {
          name: 'scriptType',
          type: 'string',
          description: '脚本类型',
          enum: ['python', 'bat', 'ps1', 'sh'],
          required: true,
        },
        content: {
          name: 'content',
          type: 'string',
          description: '脚本内容',
          required: true,
        },
        requirements: {
          name: 'requirements',
          type: 'string',
          description: 'Python依赖（仅Python脚本）',
        },
      },
      required: ['name', 'scriptType', 'content'],
    },
    permission: 'write',
    category: 'script',
  },
  {
    name: 'update_script',
    description: '修改脚本配置或内容',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          name: 'scriptId',
          type: 'string',
          description: '脚本ID',
          required: true,
        },
        name: {
          name: 'name',
          type: 'string',
          description: '新名称',
        },
        description: {
          name: 'description',
          type: 'string',
          description: '新描述',
        },
        content: {
          name: 'content',
          type: 'string',
          description: '新脚本内容',
        },
        requirements: {
          name: 'requirements',
          type: 'string',
          description: '新依赖',
        },
        status: {
          name: 'status',
          type: 'string',
          description: '状态',
          enum: ['active', 'inactive'],
        },
      },
      required: ['scriptId'],
    },
    permission: 'write',
    category: 'script',
  },
  {
    name: 'run_script',
    description: '运行指定的巡检脚本生成报告',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          name: 'scriptId',
          type: 'string',
          description: '脚本ID',
          required: true,
        },
        templateId: {
          name: 'templateId',
          type: 'string',
          description: '模板ID（可选）',
        },
        inputFiles: {
          name: 'inputFiles',
          type: 'array',
          description: '输入文件列表',
          items: { type: 'string' },
        },
      },
      required: ['scriptId'],
    },
    permission: 'write',
    category: 'script',
  },
  {
    name: 'delete_report',
    description: '删除指定的报告及其文件',
    parameters: {
      type: 'object',
      properties: {
        reportId: {
          name: 'reportId',
          type: 'string',
          description: '报告ID',
          required: true,
        },
      },
      required: ['reportId'],
    },
    permission: 'dangerous',
    category: 'report',
  },
  {
    name: 'update_settings',
    description: '修改系统配置',
    parameters: {
      type: 'object',
      properties: {
        key: {
          name: 'key',
          type: 'string',
          description: '配置键',
          required: true,
        },
        value: {
          name: 'value',
          type: 'string',
          description: '配置值',
          required: true,
        },
      },
      required: ['key', 'value'],
    },
    permission: 'write',
    category: 'system',
  },
  // ═══════════════════════════════════════════════════════
  //  文件操作工具（本地文件系统）
  // ═══════════════════════════════════════════════════════
  {
    name: 'extract_archive',
    description: '解压本地压缩包文件（支持zip、tar、gz、rar等格式），解压到指定目录',
    parameters: {
      type: 'object',
      properties: {
        archivePath: {
          name: 'archivePath',
          type: 'string',
          description: '压缩包文件路径（绝对路径或相对于DATA_DIR的路径）',
          required: true,
        },
        targetDir: {
          name: 'targetDir',
          type: 'string',
          description: '解压目标目录（可选，默认为压缩包所在目录）',
        },
        password: {
          name: 'password',
          type: 'string',
          description: '压缩包密码（可选）',
        },
      },
      required: ['archivePath'],
    },
    permission: 'write',
    category: 'system',
    examples: [
      {
        description: '解压ZIP文件到当前目录',
        parameters: { archivePath: '/uploads/server-support.zip' },
      },
      {
        description: '解压带密码的RAR文件',
        parameters: { archivePath: '/uploads/data.rar', password: '123456' },
      },
    ],
  },
  {
    name: 'list_directory',
    description: '浏览本地目录结构，列出文件和子目录',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          name: 'dirPath',
          type: 'string',
          description: '目录路径（绝对路径或相对于DATA_DIR的路径）',
          required: true,
        },
        recursive: {
          name: 'recursive',
          type: 'boolean',
          description: '是否递归列出子目录内容（默认false）',
        },
        pattern: {
          name: 'pattern',
          type: 'string',
          description: '文件名匹配模式（支持glob，如*.txt, *.log）',
        },
        maxDepth: {
          name: 'maxDepth',
          type: 'number',
          description: '递归最大深度（默认3）',
        },
      },
      required: ['dirPath'],
    },
    permission: 'read_only',
    category: 'system',
    examples: [
      {
        description: '列出目录内容',
        parameters: { dirPath: '/uploads/server-support' },
      },
      {
        description: '递归查找所有日志文件',
        parameters: { dirPath: '/uploads/server-support', recursive: true, pattern: '*.log' },
      },
    ],
  },
  {
    name: 'read_file',
    description: '读取本地文件内容（支持文本文件和常见格式）',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          name: 'filePath',
          type: 'string',
          description: '文件路径（绝对路径或相对于DATA_DIR的路径）',
          required: true,
        },
        encoding: {
          name: 'encoding',
          type: 'string',
          description: '文件编码（默认utf-8）',
          enum: ['utf-8', 'gbk', 'gb2312', 'latin1'],
        },
        maxLines: {
          name: 'maxLines',
          type: 'number',
          description: '最大读取行数（默认1000行，避免大文件）',
        },
        startLine: {
          name: 'startLine',
          type: 'number',
          description: '起始行号（默认1）',
        },
      },
      required: ['filePath'],
    },
    permission: 'read_only',
    category: 'system',
    examples: [
      {
        description: '读取文本文件',
        parameters: { filePath: '/uploads/server-support/info.txt' },
      },
      {
        description: '读取日志文件前100行',
        parameters: { filePath: '/uploads/server-support/system.log', maxLines: 100 },
      },
    ],
  },
  {
    name: 'execute_command',
    description: '执行本地系统命令（安全限制：只允许文件操作相关命令）',
    parameters: {
      type: 'object',
      properties: {
        command: {
          name: 'command',
          type: 'string',
          description: '要执行的命令',
          required: true,
        },
        args: {
          name: 'args',
          type: 'array',
          description: '命令参数列表',
          items: { type: 'string' },
        },
       工作目录: {
          name: 'workDir',
          type: 'string',
          description: '工作目录（可选）',
        },
        timeout: {
          name: 'timeout',
          type: 'number',
          description: '超时时间（毫秒，默认30000）',
        },
      },
      required: ['command'],
    },
    permission: 'dangerous',
    category: 'system',
    examples: [
      {
        description: '查看文件信息',
        parameters: { command: 'ls', args: ['-la', '/uploads/server-support'] },
      },
      {
        description: '查找特定文件',
        parameters: { command: 'find', args: ['/uploads/server-support', '-name', '*.log'] },
      },
    ],
  },
  // ═══════════════════════════════════════════════════════
  //  网页访问与知识增强工具
  // ═══════════════════════════════════════════════════════
  {
    name: 'web_search',
    description: '网络搜索，查询在线文档、技术论坛及官方知识库获取最新信息',
    parameters: {
      type: 'object',
      properties: {
        query: {
          name: 'query',
          type: 'string',
          description: '搜索关键词',
          required: true,
        },
        limit: {
          name: 'limit',
          type: 'number',
          description: '返回结果数量限制（默认10）',
        },
        domain: {
          name: 'domain',
          type: 'string',
          description: '限定搜索域名（可选）',
        },
      },
      required: ['query'],
    },
    permission: 'read_only',
    category: 'system',
    examples: [
      {
        description: '搜索DELL服务器故障代码',
        parameters: { query: 'DELL服务器故障代码 0x0000007B' },
      },
      {
        description: '搜索特定厂商技术支持',
        parameters: { query: 'H3C交换机配置命令', domain: 'www.h3c.com' },
      },
    ],
  },
  {
    name: 'fetch_webpage',
    description: '抓取网页内容，获取在线文档、技术文章等详细信息',
    parameters: {
      type: 'object',
      properties: {
        url: {
          name: 'url',
          type: 'string',
          description: '网页URL',
          required: true,
        },
        selector: {
          name: 'selector',
          type: 'string',
          description: 'CSS选择器，用于提取特定内容（可选）',
        },
        extractText: {
          name: 'extractText',
          type: 'boolean',
          description: '是否只提取文本内容（默认true）',
        },
      },
      required: ['url'],
    },
    permission: 'read_only',
    category: 'system',
    examples: [
      {
        description: '抓取技术文档页面',
        parameters: { url: 'https://www.dell.com/support/kbdoc/000123456' },
      },
      {
        description: '抓取特定章节内容',
        parameters: { url: 'https://example.com/article', selector: '.content' },
      },
    ],
  },
  {
    name: 'knowledge_base_search',
    description: '搜索本地知识库，查找服务器配置信息、历史故障记录、运维手册等',
    parameters: {
      type: 'object',
      properties: {
        query: {
          name: 'query',
          type: 'string',
          description: '搜索关键词',
          required: true,
        },
        category: {
          name: 'category',
          type: 'string',
          description: '知识分类（可选）',
          enum: ['configuration', 'troubleshooting', 'manual', 'history', 'all'],
        },
        serverType: {
          name: 'serverType',
          type: 'string',
          description: '服务器类型（可选）',
        },
        limit: {
          name: 'limit',
          type: 'number',
          description: '返回结果数量限制（默认10）',
        },
      },
      required: ['query'],
    },
    permission: 'read_only',
    category: 'system',
    examples: [
      {
        description: '搜索DELL服务器故障记录',
        parameters: { query: 'DELL R740 硬盘故障', category: 'troubleshooting' },
      },
      {
        description: '搜索服务器配置信息',
        parameters: { query: '内存配置', category: 'configuration', serverType: 'DELL' },
      },
    ],
  },
  {
    name: 'add_knowledge',
    description: '添加知识到本地知识库，支持服务器配置、故障记录、运维手册等',
    parameters: {
      type: 'object',
      properties: {
        title: {
          name: 'title',
          type: 'string',
          description: '知识标题',
          required: true,
        },
        content: {
          name: 'content',
          type: 'string',
          description: '知识内容',
          required: true,
        },
        category: {
          name: 'category',
          type: 'string',
          description: '知识分类',
          enum: ['configuration', 'troubleshooting', 'manual', 'history'],
          required: true,
        },
        serverType: {
          name: 'serverType',
          type: 'string',
          description: '服务器类型（可选）',
        },
        tags: {
          name: 'tags',
          type: 'array',
          description: '标签列表（可选）',
          items: { type: 'string' },
        },
        source: {
          name: 'source',
          type: 'string',
          description: '知识来源（可选）',
        },
      },
      required: ['title', 'content', 'category'],
    },
    permission: 'write',
    category: 'system',
    examples: [
      {
        description: '添加故障记录',
        parameters: {
          title: 'DELL R740 硬盘故障解决方案',
          content: '故障现象：硬盘指示灯红色闪烁...',
          category: 'troubleshooting',
          serverType: 'DELL',
          tags: ['硬盘', '故障', 'DELL'],
        },
      },
    ],
  },
];

/**
 * 获取所有工具定义
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return [...READ_ONLY_TOOLS, ...WRITE_TOOLS];
}

/**
 * 获取工具定义（按名称）
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return getAllToolDefinitions().find((t) => t.name === name);
}

/**
 * 获取只读工具定义
 */
export function getReadOnlyToolDefinitions(): ToolDefinition[] {
  return READ_ONLY_TOOLS;
}

/**
 * 获取写入工具定义（需确认）
 */
export function getWriteToolDefinitions(): ToolDefinition[] {
  return WRITE_TOOLS;
}

/**
 * 检查工具是否需要用户确认
 */
export function requiresConfirmation(toolName: string): boolean {
  const tool = getToolDefinition(toolName);
  if (!tool) return false;
  return tool.permission === 'write' || tool.permission === 'dangerous';
}

/**
 * 转换工具定义为 OpenAI Function Calling 格式
 */
export function toOpenAIToolFormat(tool: ToolDefinition): any {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * 获取所有工具的 OpenAI 格式定义
 */
export function getOpenAIToolDefinitions(): any[] {
  return getAllToolDefinitions().map(toOpenAIToolFormat);
}
