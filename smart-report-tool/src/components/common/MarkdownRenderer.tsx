/**
 * Markdown 渲染组件
 * 
 * 使用 react-markdown + remark-gfm 实现完整的 GFM (GitHub Flavored Markdown) 渲染。
 * 支持：标题(H1-H6)、加粗、斜体、删除线、列表(有序/无序)、
 * 代码块(带语言标识)、行内代码、引用、链接、表格、图片、任务列表。
 * 
 * 与 Tailwind typography (prose) 配合使用，排版清晰美观。
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  /** 是否为流式渲染中（部分内容可能不完整），用于容错 */
  isStreaming?: boolean;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  // 空内容或纯文本（无 Markdown 语法）直接按原文渲染
  if (!content) return null;

  // 纯文本快速路径：无常见 Markdown 标记时跳过 react-markdown 开销
  const looksLikePlainText = !/[#*`~>|\-\[\]!$]/.test(content);
  if (looksLikePlainText) {
    return <pre className={cn('whitespace-pre-wrap font-sans', className)}>{content}</pre>;
  }

  return (
    <div className={cn('prose prose-sm max-w-none break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 代码块渲染（带语言标识，但不使用 syntax highlighter 以减小体积）
          code({ className: codeClass, children, ...props }) {
            const isInline = !codeClass;
            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            // 提取语言标识（如 language-python → python）
            const lang = codeClass?.replace('language-', '') || '';
            return (
              <div className="relative my-3">
                {lang && (
                  <div className="absolute right-2 top-1 text-[10px] text-muted-foreground bg-background/80 px-1.5 rounded">
                    {lang}
                  </div>
                )}
                <pre className="bg-muted rounded-md p-3 overflow-x-auto text-sm">
                  <code className={cn('font-mono', codeClass)} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          // 链接在新窗口打开
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2" {...props}>
                {children}
              </a>
            );
          },
          // 图片自适应
          img({ src, alt, ...props }) {
            return (
              <img src={src} alt={alt} className="rounded-md max-w-full h-auto my-2" loading="lazy" {...props} />
            );
          },
          // 表格样式增强
          table({ children, ...props }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="min-w-full border-collapse border border-border" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          th({ children, ...props }) {
            return (
              <th className="border border-border bg-muted px-3 py-2 text-left text-sm font-semibold" {...props}>
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="border border-border px-3 py-2 text-sm" {...props}>
                {children}
              </td>
            );
          },
          // 引用块样式
          blockquote({ children, ...props }) {
            return (
              <blockquote className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground my-3" {...props}>
                {children}
              </blockquote>
            );
          },
          // 水平线
          hr(props) {
            return <hr className="my-4 border-border" {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
