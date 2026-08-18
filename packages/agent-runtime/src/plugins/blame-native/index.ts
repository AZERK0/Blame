import type { AgentPlugin } from "@cline/sdk";

const blameNativePlugin = {
  name: "blame-native",
  manifest: {
    capabilities: ["skills"],
  },
} satisfies AgentPlugin;

export default blameNativePlugin;
