import { formatLocalDate } from '../utils/dateUtils';

export const BUYER_TYPES = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'retailer', label: 'Retailer / shop' },
  { value: 'walk_in', label: 'Walk-in customer' },
];

export const SALE_TYPES = [
  { value: 'cash', label: 'Cash — paid immediately' },
  { value: 'credit', label: 'Credit — pay after delivery' },
  { value: 'preorder', label: 'Pre-order — reserved, payment pending' },
];

export class Order {
  static dateKey(order) {
    if (order.saleDate) return order.saleDate;
    const raw = order.createdAt?.toDate?.() || order.orderDate?.toDate?.() || order.createdAt || order.orderDate;
    if (!raw) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return formatLocalDate(date);
  }

  static total(order) {
    return parseFloat(order.totalAmount ?? order.total ?? 0) || 0;
  }

  static paymentStatus(order) {
    if (order.paymentStatus) return order.paymentStatus;
    return 'paid';
  }

  static amountPaid(order) {
    const total = Order.total(order);
    if (Order.paymentStatus(order) === 'paid') return total;
    return parseFloat(order.amountPaid ?? 0) || 0;
  }

  static amountOwing(order) {
    return Math.max(0, Order.total(order) - Order.amountPaid(order));
  }

  static isOutstanding(order) {
    return Order.amountOwing(order) > 0.009;
  }

  static inMonthKey(order, monthKey) {
    const key = Order.dateKey(order);
    return key ? key.slice(0, 7) === monthKey : false;
  }

  static paymentStatusReportLabel(order) {
    const status = Order.paymentStatus(order);
    if (status === 'paid') return 'Paid';
    if (status === 'partial') return 'Partial';
    return 'Unpaid';
  }

  static buyerTypeLabel(value) {
    const hit = BUYER_TYPES.find((t) => t.value === value);
    if (hit) return hit.label;
    if (!value) return '—';
    return String(value).replace(/_/g, ' ');
  }
}

export const getOrderDateKey = Order.dateKey;
export const getOrderTotal = Order.total;
export const getOrderPaymentStatus = Order.paymentStatus;
export const getOrderAmountPaid = Order.amountPaid;
export const getOrderAmountOwing = Order.amountOwing;
export const isOrderOutstanding = Order.isOutstanding;
export const orderInMonthKey = Order.inMonthKey;
export const paymentStatusReportLabel = Order.paymentStatusReportLabel;
export const getBuyerTypeLabel = Order.buyerTypeLabel;
