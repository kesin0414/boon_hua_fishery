import { getOrderAmountOwing } from '../domain/Order';

export class WhatsAppHelper {
  static normalizeDigits(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('60')) return digits;
    if (digits.startsWith('0')) return `60${digits.slice(1)}`;
    return digits;
  }

  static openBuyerChat(phone, message) {
    const digits = WhatsAppHelper.normalizeDigits(phone);
    if (!digits) {
      alert('No valid phone number for WhatsApp.');
      return;
    }
    const text = encodeURIComponent(message || 'Hi, this is Boon Hua Fishery.');
    window.open(`https://wa.me/${digits}?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  static buyerCollectionMessage(order) {
    const name = order.buyerName || 'there';
    const owing = getOrderAmountOwing(order).toFixed(2);
    const ref = order.saleRef ? ` (ref ${order.saleRef})` : '';
    return `Hi ${name}, this is Boon Hua Fishery regarding your outstanding balance of RM ${owing}${ref}. Please let us know when payment can be arranged. Thank you.`;
  }
}

export const normalizeWhatsAppDigits = WhatsAppHelper.normalizeDigits;
export const openBuyerWhatsApp = WhatsAppHelper.openBuyerChat;
export const buyerCollectionMessage = WhatsAppHelper.buyerCollectionMessage;
