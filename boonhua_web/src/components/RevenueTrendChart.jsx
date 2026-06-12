/** CSS bar chart — avoids Recharts zero-width issues in flex/overflow layouts */
export function RevenueTrendChart({ data, showForecastLegend = false }) {
  if (!data?.length) return null;

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const hasForecast = data.some((d) => d.isForecast);

  return (
    <div className="bh-revenue-bars w-full">
      {showForecastLegend && hasForecast && (
        <div className="flex flex-wrap gap-4 text-xs text-slate-500 mb-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-gradient-to-t from-[#4379EE] to-[#5DC0AE]" />
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border-2 border-dashed border-violet-400 bg-violet-100" />
            Predicted
          </span>
        </div>
      )}
      <div className="flex items-end justify-between gap-1 sm:gap-2 h-[260px] px-1 pb-1 border-b border-slate-200">
        {data.map((day) => {
          const heightPct = day.revenue > 0
            ? Math.max((day.revenue / maxRevenue) * 100, 6)
            : 0;
          const isForecast = day.isForecast === true;
          return (
            <div
              key={day.key}
              className="flex-1 flex flex-col items-center justify-end h-full min-w-0 group"
            >
              <span className="text-[10px] font-bold text-slate-600 mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {day.revenue > 0
                  ? `RM ${day.revenue.toFixed(0)}${isForecast ? ' (est.)' : ''}`
                  : ''}
              </span>
              <div
                className={
                  isForecast
                    ? 'w-full max-w-[52px] rounded-t-lg border-2 border-dashed border-violet-400 bg-violet-100/90 transition-all'
                    : 'w-full max-w-[52px] rounded-t-lg bg-gradient-to-t from-[#4379EE] to-[#5DC0AE] shadow-sm transition-all'
                }
                style={{ height: `${heightPct}%`, minHeight: day.revenue > 0 ? '8px' : 0 }}
                title={`${day.name}: RM ${day.revenue.toFixed(2)}${isForecast ? ' (predicted)' : ''}`}
                role="img"
                aria-label={`${day.name} ${isForecast ? 'predicted' : 'actual'} revenue RM ${day.revenue.toFixed(2)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-1 sm:gap-2 mt-2">
        {data.map((day) => (
          <div
            key={`${day.key}-label`}
            className={`flex-1 text-center text-[9px] sm:text-[10px] leading-tight min-w-0 ${
              day.isForecast ? 'text-violet-600 font-semibold' : 'text-slate-500'
            }`}
            title={day.name}
          >
            <span className="block truncate">{day.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
