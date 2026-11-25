export const OVERVIEW_DATE_RANGE_KEY = 'boonhua_overview_date_range';
export const REPORT_DATE_RANGE_KEY = 'boonhua_report_date_range';

export class DateUtils {
  static formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  static parseLocalDate(isoDate) {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    if (!y || !m || !d) return new Date(NaN);
    return new Date(y, m - 1, d);
  }

  static eachDayInRange(from, to) {
    const start = DateUtils.parseLocalDate(from);
    const end = DateUtils.parseLocalDate(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return [];
    }
    const days = [];
    const cursor = new Date(start);
    while (cursor <= end && days.length < 31) {
      days.push(DateUtils.formatLocalDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  static getLast7DaysRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return {
      from: DateUtils.formatLocalDate(start),
      to: DateUtils.formatLocalDate(end),
    };
  }

  static getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      from: DateUtils.formatLocalDate(start),
      to: DateUtils.formatLocalDate(end),
    };
  }

  static loadStoredReportDateRange() {
    try {
      const raw = localStorage.getItem(REPORT_DATE_RANGE_KEY);
      if (!raw) return null;
      const { dateFrom, dateTo } = JSON.parse(raw);
      if (dateFrom && dateTo) return { dateFrom, dateTo };
    } catch {
      /* ignore */
    }
    return null;
  }

  static saveStoredReportDateRange(dateFrom, dateTo) {
    try {
      localStorage.setItem(REPORT_DATE_RANGE_KEY, JSON.stringify({ dateFrom, dateTo }));
    } catch {
      /* ignore */
    }
  }

  static loadStoredDateRange() {
    try {
      const raw = localStorage.getItem(OVERVIEW_DATE_RANGE_KEY);
      if (!raw) return null;
      const { dateFrom, dateTo } = JSON.parse(raw);
      if (dateFrom && dateTo) return { dateFrom, dateTo };
    } catch {
      /* ignore */
    }
    return null;
  }

  static saveStoredDateRange(dateFrom, dateTo) {
    try {
      localStorage.setItem(OVERVIEW_DATE_RANGE_KEY, JSON.stringify({ dateFrom, dateTo }));
    } catch {
      /* ignore */
    }
  }
}

/** YYYY-MM-DD in local timezone (avoids UTC off-by-one in charts). */
export const formatLocalDate = DateUtils.formatLocalDate.bind(DateUtils);
export const parseLocalDate = DateUtils.parseLocalDate.bind(DateUtils);
export const eachDayInRange = DateUtils.eachDayInRange.bind(DateUtils);
export const getLast7DaysRange = DateUtils.getLast7DaysRange.bind(DateUtils);
export const getCurrentMonthRange = DateUtils.getCurrentMonthRange.bind(DateUtils);
export const loadStoredDateRange = DateUtils.loadStoredDateRange.bind(DateUtils);
export const saveStoredDateRange = DateUtils.saveStoredDateRange.bind(DateUtils);
export const loadStoredReportDateRange = DateUtils.loadStoredReportDateRange.bind(DateUtils);
export const saveStoredReportDateRange = DateUtils.saveStoredReportDateRange.bind(DateUtils);
