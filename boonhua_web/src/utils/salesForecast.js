/**
 * Sales prediction — ML via backend (scikit-learn), local fallback if API unavailable.
 */

export const DEFAULT_FORECAST_API =
  'https://boon-hua-fishery.onrender.com';

const LOOKBACK_DAYS = 90;
const FORECAST_DAYS = 7;
const MIN_SALE_DAYS = 3;

function dayLabel(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export class SalesForecastService {
  /** Build daily RM series for the ML API (last LOOKBACK_DAYS calendar days). */
  buildDailySeriesForForecast(orders, getOrderDateKey, getOrderTotal, formatLocalDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daily = [];

    for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = formatLocalDate(d);
      daily.push({ date: key, revenue: 0 });
    }

    const byDate = Object.fromEntries(daily.map((row) => [row.date, row]));
    orders.forEach((order) => {
      const key = getOrderDateKey(order);
      if (!key || !byDate[key]) return;
      byDate[key].revenue += getOrderTotal(order);
    });

    return daily.map((row) => ({
      date: row.date,
      revenue: Math.round(byDate[row.date].revenue * 100) / 100,
    }));
  }

  /**
   * @param {string} apiBaseUrl
   * @param {Array<{date: string, revenue: number}>} daily
   */
  async fetchMlSalesForecast(apiBaseUrl, daily) {
    const base = (apiBaseUrl || DEFAULT_FORECAST_API).trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/sales/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Forecast API error (${res.status})`);
    }
    const data = await res.json();
    return this.normalizeForecastResponse(data);
  }

  normalizeForecastResponse(data) {
    const mapPoint = (p) => ({
      key: p.key,
      name: p.name || dayLabel(p.key),
      revenue: Number(p.revenue) || 0,
      isForecast: Boolean(p.isForecast),
    });

    const last7Actual = (data.last7Actual || []).map(mapPoint);
    const next7Forecast = (data.next7Forecast || []).map(mapPoint);

    return {
      perDay: Number(data.perDay) || 0,
      next7Total: Number(data.next7Total) || 0,
      last7Total: Number(data.last7Total) || 0,
      avg7: Number(data.avg7) || 0,
      avg28: Number(data.avg28) || 0,
      trendPct: data.trendPct != null ? Number(data.trendPct) : null,
      confidence: data.confidence || 'low',
      confidenceNote: data.confidenceNote || '',
      daysWithSales: Number(data.daysWithSales) || 0,
      lookbackDays: Number(data.lookbackDays) || LOOKBACK_DAYS,
      last7Actual,
      next7Forecast,
      chartSeries: data.chartSeries
        ? data.chartSeries.map(mapPoint)
        : [...last7Actual, ...next7Forecast],
      hasEnoughData: Boolean(data.hasEnoughData),
      modelName: data.modelName || 'Gradient boosting (scikit-learn)',
      source: data.source || 'ml',
      forecastLoading: false,
      forecastError: null,
    };
  }

  /** Local fallback when the ML API is unreachable. */
  computeSalesForecastLocal(orders, getOrderDateKey, getOrderTotal, formatLocalDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daily = {};
    for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      daily[formatLocalDate(d)] = 0;
    }

    orders.forEach((order) => {
      const key = getOrderDateKey(order);
      if (!key || daily[key] === undefined) return;
      daily[key] += getOrderTotal(order);
    });

    const historyKeys = Object.keys(daily).sort();
    const historyValues = historyKeys.map((k) => daily[k]);
    const daysWithSales = historyValues.filter((v) => v > 0).length;

    const last7 = historyValues.slice(-7);
    const last28 = historyValues.slice(-28);
    const totalLast7 = last7.reduce((s, v) => s + v, 0);
    const avg7 = totalLast7 / 7;
    const avg28 = last28.reduce((s, v) => s + v, 0) / Math.max(last28.length, 1);
    const perDay = Math.max(0, avg7 * 0.65 + avg28 * 0.35);

    const last7Actual = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = formatLocalDate(d);
      last7Actual.push({
        key,
        name: dayLabel(key),
        revenue: daily[key] ?? 0,
        isForecast: false,
      });
    }

    const next7Forecast = [];
    let next7Total = 0;
    for (let i = 1; i <= FORECAST_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const key = formatLocalDate(d);
      next7Total += perDay;
      next7Forecast.push({
        key,
        name: dayLabel(key),
        revenue: Math.round(perDay * 100) / 100,
        isForecast: true,
      });
    }

    let confidence = 'low';
    if (daysWithSales >= 21) {
      confidence = 'medium';
    }

    return {
      perDay,
      next7Total,
      last7Total: totalLast7,
      avg7,
      avg28,
      trendPct: avg28 > 0 ? ((avg7 - avg28) / avg28) * 100 : null,
      confidence,
      confidenceNote: '',
      daysWithSales,
      lookbackDays: LOOKBACK_DAYS,
      last7Actual,
      next7Forecast,
      chartSeries: [...last7Actual, ...next7Forecast],
      hasEnoughData: daysWithSales >= MIN_SALE_DAYS,
      modelName: '',
      source: 'local',
      forecastLoading: false,
      forecastError: null,
    };
  }

  /** @deprecated Use fetchMlSalesForecast; kept as alias for local fallback. */
  computeSalesForecast(orders, getOrderDateKey, getOrderTotal, formatLocalDate) {
    return this.computeSalesForecastLocal(
      orders,
      getOrderDateKey,
      getOrderTotal,
      formatLocalDate,
    );
  }

  confidenceBadgeClass(level) {
    if (level === 'high') return 'bg-emerald-100 text-emerald-800';
    if (level === 'medium') return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-700';
  }

  confidenceLabel(level) {
    if (level === 'high') return 'Reliable';
    if (level === 'medium') return 'Fair';
    return 'Early';
  }

  /** Plain-language subtitle for the Sales prediction card. */
  forecastSubtitle(forecast) {
    if (forecast.source === 'local') {
      return 'Quick estimate from your sales records on this screen.';
    }
    if (forecast.source === 'ml-baseline') {
      return 'Early estimate from your sales — log more days for sharper numbers.';
    }
    return `Smart estimate from ${forecast.lookbackDays} days of your sales.`;
  }

  /** Plain-language footnote under the prediction stats. */
  forecastNote(forecast) {
    if (forecast.source === 'local') {
      return 'Could not reach the prediction server. Check Settings → API URL is set to your live server, then refresh. The figures above still use your past sales.';
    }
    if (forecast.source === 'ml-baseline') {
      return 'Keep recording sales daily — predictions improve as history grows.';
    }
    if (forecast.confidence === 'high') {
      return 'This forecast matches your recent daily sales patterns well.';
    }
    if (forecast.confidence === 'medium') {
      return 'A solid estimate — more sales history will refine it further.';
    }
    return 'Still learning your shop’s pattern — keep logging sales each day.';
  }
}

const salesForecastService = new SalesForecastService();

export const buildDailySeriesForForecast = (...args) =>
  salesForecastService.buildDailySeriesForForecast(...args);
export const fetchMlSalesForecast = (...args) =>
  salesForecastService.fetchMlSalesForecast(...args);
export const computeSalesForecastLocal = (...args) =>
  salesForecastService.computeSalesForecastLocal(...args);
export const computeSalesForecast = (...args) =>
  salesForecastService.computeSalesForecast(...args);
export const confidenceBadgeClass = (...args) =>
  salesForecastService.confidenceBadgeClass(...args);
export const confidenceLabel = (...args) =>
  salesForecastService.confidenceLabel(...args);
export const forecastSubtitle = (...args) =>
  salesForecastService.forecastSubtitle(...args);
export const forecastNote = (...args) =>
  salesForecastService.forecastNote(...args);

export { salesForecastService };
