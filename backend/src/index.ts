import { loadLocalDotenv } from "./localDotenv.js";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { createVertexPlanner } from "./vertex.js";
import { createLocalPlanner } from "./localPlanner.js";

loadLocalDotenv();

const env = loadEnv();
const planner = env.AURA_PLANNER_MODE === "vertex" ? createVertexPlanner(env) : createLocalPlanner();
const app = createApp({ env, planner });

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`aura-backend listening on :${env.PORT}`);
});
