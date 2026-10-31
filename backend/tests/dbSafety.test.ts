import { describe, expect, it } from 'vitest';
import { testDatabaseName } from './helpers';

describe('test database isolation', () => {
  it('creates a uniquely named database within the test prefix', () => {
    expect(testDatabaseName()).toMatch(/^hgv_test_[a-f0-9]{12}$/);
  });

  it('reuses only the exact generated test database name', () => {
    expect(testDatabaseName('hgv_test_0123456789ab')).toBe('hgv_test_0123456789ab');
  });

  it.each(['hgv_player_db', 'hgv_test_other', 'production'])(
    'refuses to reuse a non-generated test database name: %s',
    (name) => {
      expect(() => testDatabaseName(name)).toThrow('Refusing to run database tests on a non-test database.');
    },
  );
});
