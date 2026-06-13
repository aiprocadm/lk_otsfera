import { describe, it, expect, vi } from 'vitest';
const { parseWorkbook } = vi.hoisted(() => ({ parseWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/parse-workbook', () => ({ parseWorkbook }));
import { FileOneCAdapter } from '@/lib/services/oneCSync/adapter-file';

describe('FileOneCAdapter', () => {
  it('orgs and documents are never created from Excel', async () => {
    parseWorkbook.mockResolvedValue({ orgs: [{ name:'A', inn:'77', partnerInn:null }], orders: [], payments: [] });
    const a = new FileOneCAdapter(Buffer.from('x'));
    expect(await a.pullOrganizations({})).toEqual([]);
    expect(await a.pullDocuments({})).toEqual([]);
  });
  it('derives financialStatus from amounts when no status column', async () => {
    parseWorkbook.mockResolvedValue({ orgs: [], orders: [
      { externalId:'O1', orderNumber:'O1', orgInn:'77', totalAmount:100, paidAmount:100 }], payments: [] });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0]).toMatchObject({ externalId:'O1', financialStatus:'paid', organizationInn:'77' });
    expect(orders[0].organizationExternalId).toBeUndefined();
  });
  it('uses status column via translation when present', async () => {
    parseWorkbook.mockResolvedValue({ orgs: [], orders: [
      { externalId:'O2', orderNumber:'O2', orgInn:'77', totalAmount:100, paidAmount:0, financialStatusRaw:'Счёт выставлен' }], payments: [] });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].financialStatus).toBe('billed');
  });
  it('partially paid derives partially_paid', async () => {
    parseWorkbook.mockResolvedValue({ orgs: [], orders: [
      { externalId:'O3', orderNumber:'O3', orgInn:'77', totalAmount:100, paidAmount:40 }], payments: [] });
    const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
    expect(orders[0].financialStatus).toBe('partially_paid');
  });
  it('links payment to order when orderRef present, else org-level by INN', async () => {
    parseWorkbook.mockResolvedValue({ orgs: [], orders: [], payments: [
      { externalId:'P1', orgInn:'77', amount:50, paidAt:'2026-04-01T00:00:00Z', method:null, note:null, orderRef:'O1' },
      { externalId:'P2', orgInn:'77', amount:50, paidAt:'2026-04-01T00:00:00Z', method:null, note:null, orderRef:null }] });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0]).toMatchObject({ externalId:'P1', orderExternalId:'O1' });
    expect(pays[1]).toMatchObject({ externalId:'P2', organizationInn:'77' });
    expect(pays[1].orderExternalId).toBeUndefined();
  });
  it('marks refund from method text or negative amount', async () => {
    parseWorkbook.mockResolvedValue({ orgs: [], orders: [], payments: [
      { externalId:'P3', orgInn:'77', amount:50, paidAt:'2026-04-01T00:00:00Z', method:'Возврат покупателю', note:null, orderRef:null }] });
    const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
    expect(pays[0].isRefund).toBe(true);
  });
  it('pushLead throws (read-only)', async () => {
    await expect(new FileOneCAdapter(Buffer.from('x')).pushLead({} as any)).rejects.toThrow();
  });
});
