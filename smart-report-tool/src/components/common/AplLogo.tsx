import { cn } from '@/lib/utils';

interface AplLogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** 深色背景（如深藏青侧栏）上使用，颜色调亮以保证对比度 */
  dark?: boolean;
  className?: string;
}

const sizeClasses: Record<NonNullable<AplLogoProps['size']>, string> = {
  sm: 'text-lg',
  md: 'text-[1.4rem]',
  lg: 'text-3xl',
};

/** APL 三色 Logo：商务降饱和蓝/红/绿，深色侧栏变体调亮 */
export function AplLogo({ size = 'md', dark = false, className }: AplLogoProps) {
  const colors = dark
    ? ['#6FA9E8', '#E88383', '#82BF9E']
    : ['#4A8FD9', '#D95F5F', '#5FA87F'];
  const letters = ['A', 'P', 'L'];

  return (
    <span
      className={cn('font-bold', sizeClasses[size], className)}
      style={{ letterSpacing: '0.05em' }}
      role="img"
      aria-label="APL"
    >
      {letters.map((letter, i) => (
        <span key={letter} style={{ color: colors[i] }}>
          {letter}
        </span>
      ))}
    </span>
  );
}
