import { cn } from '@/lib/utils';

interface Step {
  number: number;
  title: string;
}

interface StepWizardProps {
  steps: Step[];
  currentStep: number;
}

export function StepWizard({ steps, currentStep }: StepWizardProps) {
  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => {
        const isActive = step.number === currentStep;
        const isCompleted = step.number < currentStep;
        const isLast = index === steps.length - 1;
        return (
          <div key={step.number} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors',
                  isActive && 'border-primary bg-primary text-primary-foreground',
                  isCompleted && 'border-primary bg-primary/10 text-primary',
                  !isActive && !isCompleted && 'border-muted-foreground/30 text-muted-foreground'
                )}
              >
                {isCompleted ? '✓' : step.number}
              </div>
              <span
                className={cn(
                  'mt-2 text-xs font-medium',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {step.title}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  'mx-2 h-0.5 flex-1 transition-colors',
                  isCompleted ? 'bg-primary' : 'bg-muted-foreground/20'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
