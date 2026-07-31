import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { loadScenario, loadServerConfig } from './config';

const { port, token } = loadServerConfig(process.env);
const scenarioRef: ScenarioRef = { current: loadScenario(process.env) };

const server = createMock1cServer({
  scenarioRef,
  token,
  dataset: createDataset(),
  leadStore: createLeadStore(),
  log: (msg) => console.log(msg),
});

server.listen(port, () => {
  console.log(`[mock1c] listening on http://localhost:${port}`);
  console.log(`[mock1c] scenario:`, scenarioRef.current);
  console.log(
    `[mock1c] point the worker at it: ONE_C_ADAPTER=rest ONE_C_API_URL=http://localhost:${port} ONE_C_API_TOKEN=${token} ONE_C_MODE=shadow`
  );
});
