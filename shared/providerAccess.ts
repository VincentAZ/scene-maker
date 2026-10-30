import type { providers } from "./scene";

type Provider = (typeof providers)[number];

/**
 * How each provider can be connected. API keys work everywhere. A sign-in is
 * offered only where the provider officially lets third-party apps use it:
 * - OpenRouter: OAuth PKCE issues a user-controlled API key
 *   (https://openrouter.ai/docs/use-cases/oauth-pkce).
 * - OpenAI: "Sign in with ChatGPT" lets locally run personal and open-source
 *   apps use the person's ChatGPT plan
 *   (https://developers.openai.com/siwc/token-sharing-open-source).
 * Anthropic, Google, xAI and Moonshot have no sanctioned way for other apps to
 * use their consumer subscriptions, so their panels explain that instead.
 */
export type ProviderAccess = {
  /** The provider's official page for creating API keys. */
  keyUrl: string;
  signIn?: "openrouter" | "chatgpt";
  /** Why a subscription can't be used here, with a link to the source. */
  subscriptionNote?: { text: string; url: string; link: string };
};

export const providerAccess: Record<Provider, ProviderAccess> = {
  openai: {
    keyUrl: "https://platform.openai.com/api-keys",
    signIn: "chatgpt",
  },
  anthropic: {
    keyUrl: "https://platform.claude.com/settings/keys",
    subscriptionNote: {
      text: "Claude Pro and Max subscriptions can’t be used by other apps. Use an Anthropic API key, or sign in with OpenRouter to reach Claude models with your OpenRouter account.",
      url: "https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use",
      link: "Anthropic’s policy",
    },
  },
  google: {
    keyUrl: "https://aistudio.google.com/apikey",
    subscriptionNote: {
      text: "Google AI Pro and Ultra subscriptions can’t be used by other apps. Use a Gemini API key from Google AI Studio, or sign in with OpenRouter.",
      url: "https://ai.google.dev/gemini-api/docs/api-key",
      link: "Gemini API keys",
    },
  },
  xai: {
    keyUrl: "https://console.x.ai/team/default/api-keys",
    subscriptionNote: {
      text: "xAI doesn’t offer a sign-in for other apps to use SuperGrok subscriptions. Use an xAI API key, or sign in with OpenRouter.",
      url: "https://docs.x.ai/developers/quickstart",
      link: "xAI API setup",
    },
  },
  kimi: {
    keyUrl: "https://platform.kimi.ai/console/api-keys",
    subscriptionNote: {
      text: "Kimi subscriptions can’t be used by other apps. Use a Moonshot API key, or sign in with OpenRouter.",
      url: "https://platform.kimi.ai/docs/introduction",
      link: "Moonshot API docs",
    },
  },
  openrouter: {
    keyUrl: "https://openrouter.ai/settings/keys",
    signIn: "openrouter",
  },
};

/** ChatGPT's own page for plan usage limits and connected apps. */
export const chatGPTUsageUrl = "https://chatgpt.com/#settings/Usage";
