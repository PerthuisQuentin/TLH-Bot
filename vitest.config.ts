import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        exclude: ['node_modules', 'dist', 'files'],
        coverage: {
            provider: 'v8',
            // Without an explicit `include`, only files a test actually imported are
            // reported — untouched modules would silently vanish instead of showing 0%.
            include: ['app/**/*.ts'],
            exclude: ['**/*.test.ts'],
        },
    },
});
