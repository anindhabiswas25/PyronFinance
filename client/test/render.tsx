// Renders the whole app on the fixture adapters. The app itself only ever builds live adapters;
// tests swap them in through PortsFactoryContext.

import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../src/app/router';
import { PortsFactoryContext, type PortsFactory } from '../src/data/DataProvider';
import { createFixturePorts, type FixturePorts } from './fixtures';
import type { ScenarioName } from './fixtures/scenario';

export function renderApp(path: string, options: { scenario?: ScenarioName; speed?: number } = {}) {
  let current: FixturePorts | undefined;
  const factory: PortsFactory = (network) => (current = createFixturePorts(network, options.scenario ?? 'happy', options.speed ?? 1));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <PortsFactoryContext.Provider value={factory}>
      <RouterProvider router={router} />
    </PortsFactoryContext.Provider>,
  );
  return {
    ...result,
    router,
    /** The fixture ports the app built (available once the shell has rendered). */
    ports: () => {
      if (!current) throw new Error('the app has not built its ports yet');
      return current;
    },
  };
}
