import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
    { ignores: ['dist/**', 'files/**', '.claude/**'] },

    js.configs.recommended,
    // Type-aware: the rules worth having here (floating promises, misused promises,
    // unnecessary assertions) all need the checker. `projectService` picks up
    // tsconfig.json, which covers scripts/ and commands.ts as well as app/.
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // `Command.handler` is typed as returning a Promise, so a handler with
            // nothing to await is still declared async. That is conformance, not a smell.
            '@typescript-eslint/require-await': 'off',

            // Shell values are decimal.js instances. Interpolating one in a log line
            // is deliberate: it prints full precision, where formatBigNum would round
            // to three significant digits.
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                {
                    allow: [
                        { from: 'lib', name: 'Error' },
                        { from: 'lib', name: 'URL' },
                        { from: 'lib', name: 'URLSearchParams' },
                        { from: 'package', package: 'decimal.js', name: 'Decimal' },
                    ],
                },
            ],
        },
    },

    // This config file and anything else outside tsconfig.json has no type info.
    {
        files: ['**/*.js'],
        extends: [tseslint.configs.disableTypeChecked],
    },

    // Layering, checked mechanically rather than left to CLAUDE.md prose alone.
    // Domain code must not import discord.js or an AI SDK directly.
    {
        files: ['app/idle/**/*.ts', 'app/tools/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'discord.js',
                            message:
                                'Domain code must not import discord.js — see CLAUDE.md Layering.',
                        },
                        {
                            name: '@google/genai',
                            message:
                                'Domain code must not import an AI SDK — see CLAUDE.md Layering.',
                        },
                        {
                            name: 'ollama',
                            message:
                                'Domain code must not import an AI SDK — see CLAUDE.md Layering.',
                        },
                    ],
                },
            ],
        },
    },
    // core/ is stricter still: nothing outside core/ at all, npm packages aside.
    // Two blocks because how far "../" reaches outside core/ depends on depth:
    // a file directly in core/ escapes on the first "../", one in core/heat/ or
    // core/upgrades/ only escapes on the second.
    {
        files: ['app/idle/core/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../**'],
                            message:
                                'core/ must not import outside core/ — see CLAUDE.md Layering.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['app/idle/core/*/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../../**'],
                            message:
                                'core/ must not import outside core/ — see CLAUDE.md Layering.',
                        },
                    ],
                },
            ],
        },
    },

    // Prettier owns formatting; this switches off every rule that would fight it.
    // Must stay last.
    prettierConfig,
);
