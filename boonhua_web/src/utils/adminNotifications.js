import { getOrderAmountOwing, isOrderOutstanding } from '../domain/Order';
import { isLowStockWeight, LOW_STOCK_THRESHOLD_KG } from '../domain/InventorySpecies';
import { getLast7DaysRange } from './dateUtils';

const STORAGE_PREFIX = 'boonhua_admin_notifications';

const LOSS_TYPES = new Set(['spoiled', 'wastage', 'damaged', 'expired', 'other']);

export function notificationStorageKey(userEmail) {
  return `${STORAGE_PREFIX}:${userEmail || 'admin'}`;
}

export function loadNotificationPrefs(userEmail) {
  try {
    const raw = localStorage.getItem(notificationStorageKey(userEmail));
    if (!raw) return { read: [], dismissed: [] };
    const parsed = JSON.parse(raw);
    return {
      read: Array.isArray(parsed.read) ? parsed.read : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
    };
  } catch {
    return { read: [], dismissed: [] };
  }
}

export function saveNotificationPrefs(userEmail, prefs) {
  try {
    localStorage.setItem(notificationStorageKey(userEmail), JSON.stringify(prefs));
  } catch {
    /* ignore quota errors */
  }
}

export function stockLossesNotificationId(dateFrom, dateTo) {
  return `stock-losses-${dateFrom}-${dateTo}`;
}

export function buildAdminNotifications({ inventory = [], orders = [], inventoryHistory = [] }) {
  const { from: dateFrom, to: dateTo } = getLast7DaysRange();

  const items = [];

  const lowStock = inventory.filter((item) => isLowStockWeight(item.weight));
  if (lowStock.length > 0) {
    items.push({
      id: 'low-stock',
      variant: 'warning',
      title: 'Low stock alert',
      message: `${lowStock.map((i) => i.species).join(', ')} — at or below ${LOW_STOCK_THRESHOLD_KG} kg. Consider restocking.`,
      link: '/inventory',
    });
  }

  const outstanding = orders.filter((order) => isOrderOutstanding(order));
  const totalOwing = outstanding.reduce((sum, order) => sum + getOrderAmountOwing(order), 0);
  if (totalOwing > 0.009) {
    items.push({
      id: 'collections-outstanding',
      variant: 'danger',
      title: 'Collection risk',
      message: `RM ${totalOwing.toFixed(2)} outstanding across ${outstanding.length} open bill(s). Follow up before extending more credit.`,
      link: '/credit',
    });
  }

  const lossKg = inventoryHistory
    .filter((row) => {
      const key = row.movementDate;
      if (!key) return true;
      return key >= dateFrom && key <= dateTo;
    })
    .filter((row) => LOSS_TYPES.has(row.type))
    .reduce((sum, row) => sum + parseFloat(row.quantityKg || 0), 0);

  if (lossKg > 0) {
    items.push({
      id: stockLossesNotificationId(dateFrom, dateTo),
      variant: 'danger',
      title: 'Stock losses in selected period',
      message: `${lossKg.toFixed(1)} kg recorded as spoilage, wastage, or damage (${dateFrom} to ${dateTo}).`,
      link: '/inventory?tab=ledger',
    });
  }

  return items;
}

export function visibleNotifications(notifications, prefs) {
  const dismissed = new Set(prefs?.dismissed || []);
  return notifications.filter((item) => !dismissed.has(item.id));
}

export function unreadCount(notifications, prefs) {
  const read = new Set(prefs?.read || []);
  return visibleNotifications(notifications, prefs).filter((item) => !read.has(item.id)).length;
}

export function isNotificationDismissed(id, prefs) {
  return (prefs?.dismissed || []).includes(id);
}
