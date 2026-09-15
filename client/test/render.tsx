// Renders the whole app on the fixture adapters. The app itself only ever builds live adapters;
// tests swap them in through PortsFactoryContext.

import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../src/app/router';
import { PortsFactoryContext, type PortsFactory } from '../src/data/DataProvider';
import { createFixturePorts } from './fixtures';
import type { ScenarioName } from './fixtures/scenario';

export function renderApp(path: string, options: { scenario?: ScenarioName; speed?: number } = {}) {
  const factory: PortsFactory = (network) => createFixturePorts(network, options.scenario ?? 'happy', options.speed ?? 1);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <PortsFactoryContext.Provider value={factory}>
      <RouterProvider router={router} />
    </PortsFactoryContext.Provider>,
  );
  return { ...result, router };
}
