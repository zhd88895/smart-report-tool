/**
 * 知识库上下文构建工具
 *
 * 从日志内容/文件清单中提取故障关键词，按相关性从知识库文件中
 * 节选对应章节（而非只截头部），让 AI 能基于手册对应章节给出
 * 完整的故障处理方法。
 *
 * 供 routes/ai.ts（同步分析）与 services/analysisTaskService.ts
 * （队列化分析）共用。
 *
 * @module utils/knowledgeExcerpt
 */

/** 每个知识库文件注入提示词的最大字符数（大手册只节选相关章节） */
export const KB_PER_FILE_BUDGET = 15000;
/** 关键词命中处向后扩展的上下文行数 */
const KB_WINDOW_LINES = 25;

/** 过于泛化的词不参与匹配（避免整篇手册都算"相关"） */
const KB_STOP_WORDS = new Set([
  'error', 'fail', 'failed', 'failing', 'failure', 'fault', 'warning', 'critical',
  'fatal', 'alert', 'level', 'event', 'this', 'that', 'with', 'from', 'the',
  'reporting', 'specified', 'detected', 'status', 'system', 'log',
]);

/**
 * 从日志内容 + 文件名提取匹配关键词：
 * - 文件名拆解（HP RX7640.log → hp、rx7640）
 * - 告警码（CPU_FAN_FAIL 等全大写词）及其拆分词（cpu、fan）
 * - 故障关键行里的实义词
 */
export function extractLogKeywords(logContent: string, fileName: string): string[] {
  const kws = new Set<string>();
  for (const w of fileName.split(/[^A-Za-z0-9]+/)) {
    if (w.length >= 3) kws.add(w.toLowerCase());
  }
  for (const m of logContent.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)) {
    kws.add(m[0].toLowerCase());
    for (const part of m[0].toLowerCase().split('_')) {
      if (part.length >= 3) kws.add(part);
    }
  }
  for (const line of logContent.split('\n')) {
    if (/error|fail|fault|critical|fatal|warning/i.test(line)) {
      for (const w of line.split(/[^A-Za-z0-9]+/)) {
        if (w.length >= 4) kws.add(w.toLowerCase());
      }
    }
  }
  return [...kws].filter((k) => !KB_STOP_WORDS.has(k)).slice(0, 60);
}

/**
 * 按关键词相关性从知识库文件内容中节选章节：
 * 命中行按命中数排序取 Top，向前 3 行 / 向后 KB_WINDOW_LINES 行扩窗，
 * 相邻窗口合并，总量不超过预算；无命中时回退为头部截取。
 */
export function selectRelevantExcerpt(
  content: string,
  keywords: string[],
  budget: number
): { text: string; relevanceSelected: boolean } {
  if (content.length <= budget) return { text: content, relevanceSelected: false };
  const lines = content.split('\n');
  const hits: Array<[number, number]> = [];
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    let score = 0;
    for (const kw of keywords) if (low.includes(kw)) score++;
    if (score > 0) hits.push([i, score]);
  });
  if (hits.length === 0) {
    return { text: content.slice(0, budget), relevanceSelected: false };
  }
  const topLines = hits
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map((e) => e[0])
    .sort((a, b) => a - b);
  // 合并相邻/重叠窗口
  const windows: Array<[number, number]> = [];
  for (const i of topLines) {
    const start = Math.max(0, i - 3);
    const end = Math.min(lines.length, i + KB_WINDOW_LINES);
    const last = windows[windows.length - 1];
    if (last && start <= last[1] + 5) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  let text = '';
  for (const [s, e] of windows) {
    const chunk = lines.slice(s, e).join('\n');
    if (text.length + chunk.length > budget) break;
    text += (text ? '\n\n……（另一相关章节节选）……\n\n' : '') + chunk;
  }
  return { text, relevanceSelected: true };
}

/**
 * 构建知识库上下文字段（注入提示词用）。
 *
 * @param knowledgeFileIds 用户勾选的知识库文件 ID
 * @param keywordSource    用于提取关键词的文本（日志内容或压缩包文件清单）
 * @param fileName         原始文件名（参与关键词提取）
 * @returns 上下文字符串；无选中文件或无内容时返回空串
 */
export async function buildKnowledgeContext(
  knowledgeFileIds: string[],
  keywordSource: string,
  fileName: string
): Promise<string> {
  if (knowledgeFileIds.length === 0) return '';
  const { knowledgeBaseRepository } = await import('../db/repositories/knowledgeBaseRepository');
  const kbFiles = await knowledgeBaseRepository.findFilesByIds(knowledgeFileIds);
  if (kbFiles.length === 0) return '';

  const keywords = extractLogKeywords(keywordSource, fileName);
  let context = '\n\n## 知识库参考信息\n\n以下为用户从知识库中选取的参考文件（大型文档已按日志中的故障关键词自动节选相关章节）。分析时请主动将日志中的故障现象与参考文件中的对应章节关联，若找到对应的处理/更换/排查流程，请引用该章节给出完整、可操作的解决方法：\n\n';
  for (const kf of kbFiles) {
    const full = kf.content || '';
    const { text, relevanceSelected } = selectRelevantExcerpt(full, keywords, KB_PER_FILE_BUDGET);
    const note = relevanceSelected
      ? '（已按日志关键词节选相关章节）'
      : full.length > KB_PER_FILE_BUDGET
        ? '（内容较长，已截取开头部分）'
        : '';
    context += `### ${kf.title} (${kf.file_name})${note}\n\n\`\`\`plaintext\n${text}\n\`\`\`\n\n---\n\n`;
  }
  return context;
}
