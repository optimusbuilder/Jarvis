import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { createVertexPlanner } from "./vertex.js";

const env = loadEnv();
const planner = createVertexPlanner(env);
const app = createApp({ env, planner });

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`aura-backend listening on :${env.PORT}`);
});

