import { ReactNode } from 'react';
import { resetAllStores } from './store-helpers';

export function StoreTestWrapper({ children }: { children: ReactNode }) {
  // Reset stores before each test
  resetAllStores();
  return <>{children}</>;
}