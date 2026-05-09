import React from 'react';
import { Check } from 'lucide-react';
import type { StageItem } from '../../data/adminTypes';

export const LifecycleStepper: React.FC<{ stages: StageItem[]; compact?: boolean }> = ({ stages, compact }) => {
  // Add safety check for undefined or empty stages
  if (!stages || stages.length === 0) {
    return null;
  }
  
  const currentIdx = stages.findIndex(s => !s.completed) - 1;
  const allDone = stages.every(s => s.completed);

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-0'} w-full`}>
      {stages.map((stage, i) => {
        const isActive = !allDone && i === currentIdx + 1;
        const isDone = stage.completed;
        return (
          <React.Fragment key={stage.id}>
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`
                flex items-center justify-center rounded-full
                ${compact ? 'w-6 h-6' : 'w-8 h-8'}
                ${isDone ? 'bg-gray-900 text-white' : isActive ? 'bg-blue-100 text-blue-700 border-2 border-blue-500' : 'bg-gray-100 text-gray-400 border border-gray-200'}
                transition-colors
              `}>
                {isDone ? <Check className={compact ? 'w-3 h-3' : 'w-4 h-4'} /> : <span className={compact ? 'text-[9px]' : 'text-[11px]'}>{i + 1}</span>}
              </div>
              {!compact && (
                <span className={`text-[10px] mt-1 text-center max-w-[72px] leading-tight ${isDone ? 'text-gray-900' : isActive ? 'text-blue-700' : 'text-gray-400'}`}>
                  {stage.label}
                </span>
              )}
            </div>
            {i < stages.length - 1 && (
              <div className={`flex-1 ${compact ? 'h-0.5 min-w-3' : 'h-0.5 min-w-4'} ${isDone ? 'bg-gray-900' : 'bg-gray-200'} ${compact ? 'mt-0' : '-mt-4'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};