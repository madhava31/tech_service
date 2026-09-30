import React from 'react';

interface LoadingStateProps {
  message?: string;
  count?: number;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ message = 'Loading sales data...', count = 4 }) => {
  return (
    <div className="w-full space-y-4 p-4 animate-pulse">
      <div className="flex justify-between items-center mb-6">
        <div className="h-8 bg-[#F7F8FC] rounded w-64"></div>
        <div className="flex gap-2">
          <div className="h-8 bg-[#F7F8FC] rounded w-24"></div>
          <div className="h-8 bg-[#F7F8FC] rounded w-32"></div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 bg-[#FFFFFF] border border-[#E4E8F2] rounded p-3 space-y-2">
            <div className="h-3 bg-[#F7F8FC] rounded w-16"></div>
            <div className="h-6 bg-[#F7F8FC] rounded w-20"></div>
          </div>
        ))}
      </div>
      <div className="h-12 bg-[#FFFFFF] border border-[#E4E8F2] rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 pt-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="h-96 bg-[#FFFFFF] border border-[#E4E8F2] rounded p-4 space-y-3">
            <div className="h-4 bg-[#F7F8FC] rounded w-3/4"></div>
            <div className="h-4 bg-[#F7F8FC] rounded w-1/2"></div>
            <div className="h-24 bg-[#F7F8FC] rounded w-full"></div>
            <div className="h-12 bg-[#F7F8FC] rounded w-full"></div>
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-[#7A839E] mt-2">{message}</div>
    </div>
  );
};

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Unable to load sales data',
  message = 'We could not retrieve the latest pipeline data from the server. Please check your connection or retry.',
  onRetry,
}) => {
  return (
    <div className="w-full flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-[#FFFFFF] border border-[#E5484D]/40 rounded-xl p-6 text-center space-y-4 shadow-card">
        <div className="w-12 h-12 rounded-full bg-[#E5484D]/10 border border-[#E5484D]/30 text-[#E5484D] flex items-center justify-center mx-auto text-xl">
          ⚠️
        </div>
        <div>
          <h3 className="text-base font-bold text-[#141B34]">{title}</h3>
          <p className="text-xs text-[#7A839E] mt-1.5 leading-relaxed">{message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn small secondary bg-[#F7F8FC] hover:bg-[#E4E8F2] text-[#141B34] border border-[#E4E8F2] px-5 py-2 inline-flex items-center gap-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            🔄 Retry Request
          </button>
        )}
      </div>
    </div>
  );
};

interface EmptyStateProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No opportunities found',
  message = 'There are currently no sales opportunities matching your applied filters.',
  actionLabel = 'Clear Filters',
  onAction,
  icon = '🔍',
}) => {
  return (
    <div className="w-full flex items-center justify-center p-12 text-center">
      <div className="max-w-md w-full bg-[#FFFFFF]/60 border border-[#E4E8F2] rounded-xl p-8 space-y-3">
        <div className="text-3xl mb-1">{icon}</div>
        <h4 className="text-sm font-bold text-[#141B34]">{title}</h4>
        <p className="text-xs text-[#7A839E] leading-relaxed">{message}</p>
        {onAction && (
          <div className="pt-2">
            <button
              onClick={onAction}
              className="btn small secondary bg-[#F7F8FC] text-[#3B6FD4] border border-[#D4DAEA] hover:bg-[#E4E8F2] text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors"
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
