import { loadLocalDotenv } from "./localDotenv.js";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { createVertexPlanner } from "./vertex.js";
import { createLocalPlanner } from "./localPlanner.js";
import { logInfo } from "./logging.js";

loadLocalDotenv();

const env = loadEnv();
const planner = env.AURA_PLANNER_MODE === "vertex" ? createVertexPlanner(env) : createLocalPlanner();
const app = createApp({ env, planner });

app.listen(env.PORT||8080,"0.0.0.0", () => {
  logInfo("backend_started", {
    port: env.PORT,
    planner_mode: env.AURA_PLANNER_MODE,
    tts_mode: env.AURA_TTS_MODE,
    version: env.AURA_BACKEND_VERSION
  });
});
