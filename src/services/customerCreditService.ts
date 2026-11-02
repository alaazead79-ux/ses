import { getDesktopApi, type DesktopCustomerCreditRow } from '@/lib/electronBridge';
import { toPiastres } from './invoiceService';

export type CustomerCredit = DesktopCustomerCreditRow;

export async function listCustomerCredits(): Promise<CustomerCredit[]> {
  const desktop = getDesktopApi();
  if (!desktop) return [];
  return desktop.farm.customers.credits();
}

export async function refundCustomerCredit(input: {
  partyId: string;
  cashboxId: string;
  date: string;
  amount: number; // بالجنيه
}): Promise<{ id: string; docNumber: string; amount: number; creditAfter: number }> {
  const desktop = getDesktopApi();
  if (!desktop) throw new Error('رد الرصيد متاح من تطبيق سطح المكتب فقط');
  return desktop.farm.customers.refundCredit({ ...input, amount: toPiastres(input.amount) });
}
