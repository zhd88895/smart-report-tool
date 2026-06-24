import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.top - 8, left: rect.left });
      }
      setVisible(true);
    }, 300);
  };

  const hide = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  return (
    <div
      ref={triggerRef}
      className="relative min-w-0"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && createPortal(
        <div
          className={cn(
            'fixed z-[9999] px-2.5 py-1.5 rounded-md shadow-lg',
            'bg-popover text-popover-foreground text-xs leading-normal',
            'break-words pointer-events-none',
            className
          )}
          style={{ top: pos.top, left: pos.left, maxWidth: 320 }}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
}
