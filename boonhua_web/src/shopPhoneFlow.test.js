import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stockStatusForWeight,
  isLowStockWeight,
} from './domain/InventorySpecies.js';
import {
  buildAdminNotifications,
  visibleNotifications,
  unreadCount,
  isNotificationDismissed,
} from './utils/adminNotifications.js';
import {
  buildSalesReportPayload,
} from './utils/reportExport.js';
import {
  getBuyerTypeLabel,
  getOrderAmountOwing,
  getOrderAmountPaid,
  getOrderDateKey,
  getOrderTotal,
  isOrderOutstanding,
  paymentStatusReportLabel,
} from './domain/Order.js';

function phoneMarketList(inventory) {
  return inventory.filter((item) => {
    const weight = parseFloat(item.weight) || 0;
    const price = parseFloat(item.price) || 0;
    return weight > 0 && price > 0;
  });
}

test('shop-to-phone rehearsal: price change, sale, report, and notifications', () => {
  let inventory = [
    { id: 'a', species: 'Octopus', weight: 25, price: 20, landingPrice: 12, category: 'Squid' },
    { id: 'b', species: 'Stingray', weight: 0, price: 18, landingPrice: 10, category: 'Fish' },
  ];

  assert.equal(stockStatusForWeight(25), 'In Stock');
  assert.equal(phoneMarketList(inventory).map((item) => item.species).join(','), 'Octopus');
  // Mobile Market uses daily `price`, not landing/farm-gate cost.
  assert.equal(phoneMarketList(inventory)[0].price, 20);
  assert.equal(phoneMarketList(inventory)[0].landingPrice, 12);

  inventory = inventory.map((item) => (
    item.species === 'Octopus' ? { ...item, price: 22 } : item
  ));
  assert.equal(phoneMarketList(inventory)[0].price, 22);
  assert.equal(phoneMarketList(inventory)[0].landingPrice, 12);

  inventory = inventory.map((item) => (
    item.species === 'Octopus' ? { ...item, weight: 14 } : item
  ));
  assert.equal(stockStatusForWeight(14), 'Low Stock');
  assert.equal(isLowStockWeight(14), true);
  assert.equal(phoneMarketList(inventory).length, 1);

  const sale = {
    saleRef: 'BH-001',
    saleDate: '2026-09-30',
    buyerName: 'Restoran Sri',
    buyerPhone: '0123000000',
    buyerType: 'restaurant',
    species: 'Octopus',
    quantityKg: 11,
    totalAmount: 242,
    paymentStatus: 'unpaid',
    amountPaid: 0,
  };
  assert.equal(isOrderOutstanding(sale), true);
  assert.equal(getOrderAmountOwing(sale), 242);

  const alerts = buildAdminNotifications({
    inventory,
    orders: [sale],
    inventoryHistory: [
      { type: 'spoiled', quantityKg: 1.5, movementDate: '2026-09-30' },
    ],
  });
  assert.ok(alerts.some((item) => item.id === 'low-stock'));
  assert.ok(alerts.some((item) => item.id === 'collections-outstanding'));

  const afterDismiss = {
    read: ['low-stock'],
    dismissed: ['low-stock'],
  };
  assert.equal(isNotificationDismissed('low-stock', afterDismiss), true);
  assert.equal(visibleNotifications(alerts, afterDismiss).some((item) => item.id === 'low-stock'), false);
  assert.equal(unreadCount(alerts, { read: [], dismissed: [] }) >= 2, true);
  assert.equal(unreadCount(alerts, afterDismiss) < unreadCount(alerts, { read: [], dismissed: [] }), true);

  const payload = buildSalesReportPayload({
    storeInfo: { storeName: 'Boon Hua Fishery' },
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    periodLabel: 'September 2026',
    summary: {
      totalSales: 242,
      collected: 0,
      owing: 242,
      paidCount: 0,
      unpaidCount: 1,
      count: 1,
    },
    buyerSummary: [{
      name: 'Restoran Sri',
      buyerType: 'restaurant',
      bills: 1,
      total: 242,
      paid: 0,
      owing: 242,
    }],
    periodOrders: [sale],
    getBuyerTypeLabel,
    getOrderDateKey,
    getOrderTotal,
    getOrderAmountPaid,
    getOrderAmountOwing,
    paymentStatusReportLabel,
  });

  assert.equal(payload.storeName, 'Boon Hua Fishery');
  assert.equal(payload.ledgerRows[0].item, 'Octopus');
  assert.equal(payload.ledgerRows[0].status, 'Unpaid');
  assert.equal(payload.buyerSummary[0].buyerTypeLabel, 'Restaurant');
});
