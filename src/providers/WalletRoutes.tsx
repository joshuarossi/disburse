import { Outlet } from 'react-router-dom';
import { Web3Provider } from './Web3Provider';

/** Wallet connectors load only when a route needs account access. */
export default function WalletRoutes() {
  return <Web3Provider><Outlet /></Web3Provider>;
}
