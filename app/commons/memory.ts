import NodeCache from 'node-cache';

export const memoryCache = new NodeCache({
    checkperiod: 60,
    useClones: false,
});
