import { loadLocalDotenv } from "./localDotenv.js";
import { loadEnv } from "./env.js";
import { createAgentApp } from "./app.js";

loadLocalDotenv();

const env = loadEnv();
const app = createAgentApp({ env });

app.listen(env.PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(
    `jarvis-desktop-agent listening on http://127.0.0.1:${env.PORT} (version=${env.AURA_AGENT_VERSION}, audit_log=${env.AURA_AUDIT_LOG_PATH})`

  );
});
