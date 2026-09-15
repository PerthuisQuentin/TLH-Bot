import { describe, it, expect, afterEach, vi } from 'vitest';
import { executeToolCall, toolDeclarations } from './index.ts';
import { weatherTool } from './weather.ts';

const context = { guildId: 'guild-1' };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the tool registry', () => {
    it('declares get_weather, which is what an adapter translates for its SDK', () => {
        expect(toolDeclarations.map((declaration) => declaration.name)).toContain('get_weather');
    });

    it('answers an invented function name instead of throwing, so the loop still converges', async () => {
        await expect(
            executeToolCall({ id: 'c1', name: 'get_moon_phase', args: {} }, context),
        ).resolves.toEqual({
            id: 'c1',
            name: 'get_moon_phase',
            response: 'Fonction inconnue: get_moon_phase',
        });
    });

    it('routes a known call to its tool', async () => {
        vi.spyOn(weatherTool, 'execute').mockResolvedValue('20°C');

        await expect(
            executeToolCall({ id: 'c2', name: 'get_weather', args: { city: 'Paris' } }, context),
        ).resolves.toEqual({ id: 'c2', name: 'get_weather', response: '20°C' });
    });
});

describe('weatherTool.execute', () => {
    it('reports a lookup failure to the model rather than throwing it at the loop', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('réseau coupé'));

        const response = await weatherTool.execute({ city: 'Paris' }, context);

        expect(response).toMatch(/^Erreur lors de la récupération de la météo:/);
    });
});
