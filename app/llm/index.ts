// The whole AI surface the rest of the app is allowed to know. One file per entry point
// behind it; `chat.ts` is the engine they all share.
export { ask } from './ask.ts';
export { chatNaturally } from './chat-naturally.ts';
export { generateRolePromotionMessage } from './role-promotion.ts';
export { generateJackpotMessage } from './jackpot.ts';

export { MAX_TOOL_ROUNDS } from './chat.ts';
export { getProvider } from './provider.ts';
export { LlmErrorKind, LlmProviderId } from './types.ts';
