import { describe, it, expect } from 'vitest';
import { mapMlStatus, mapShopeeStatus } from './index';

describe('mapMlStatus', () => {
  it('mantém status conhecidos como estão', () => {
    expect(mapMlStatus('active')).toBe('active');
    expect(mapMlStatus('paused')).toBe('paused');
    expect(mapMlStatus('closed')).toBe('closed');
  });

  it('cai em not_listed para qualquer status desconhecido', () => {
    expect(mapMlStatus('under_review')).toBe('not_listed');
    expect(mapMlStatus('')).toBe('not_listed');
  });
});

describe('mapShopeeStatus', () => {
  it('mapeia NORMAL para active', () => {
    expect(mapShopeeStatus('NORMAL')).toBe('active');
  });

  it('mapeia UNLIST para paused', () => {
    expect(mapShopeeStatus('UNLIST')).toBe('paused');
  });

  it('mapeia BANNED e DELETED para closed', () => {
    expect(mapShopeeStatus('BANNED')).toBe('closed');
    expect(mapShopeeStatus('DELETED')).toBe('closed');
  });

  it('cai em not_listed para status desconhecido', () => {
    expect(mapShopeeStatus('QUALQUER_OUTRA_COISA')).toBe('not_listed');
  });
});
