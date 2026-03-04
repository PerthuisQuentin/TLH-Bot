import NodeCache from 'node-cache';

/**
 * Memory cache instance with TTL support
 * checkperiod: 60 = cleanup expired keys every 60 seconds
 */
export const memoryCache = new NodeCache({
  checkperiod: 60,
  useClones: false,
});
