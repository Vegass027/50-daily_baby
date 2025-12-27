export enum PanelMode {
  BUY = 'buy',
  SELL = 'sell',
  LIMIT = 'limit',
  TRACK = 'track'
}

export interface TokenData {
  name: string;
  ticker: string;
  market_cap: number;
  liquidity: number;
  current_price: number;
  decimals?: number;
}

export interface UserData {
  sol_balance: number;
  usd_balance: number;
  token_balance: number;
  has_active_order: boolean;
}

export interface ActionData {
  selected_amount: number; // Может быть USD для покупки или % для продажи
  slippage: number;
  limit_price?: number;
  position?: PositionData;
  tp_enabled: boolean;
  tp_price?: number;
  tp_percent?: number;
  sl_enabled: boolean;
  sl_price?: number;
  sl_percent?: number;
}

export interface PositionData {
  entry_price: number;
  current_price: number;
  size: number;
  pnl_usd: number;
  pnl_percent: number;
  tokenAddress?: string; // Добавлено для идентификации
}

export interface UserPanelState {
  user_id: number;
  message_id: number;
  token_address: string;
  mode: PanelMode;
  token_data: TokenData;
  user_data: UserData;
  action_data: ActionData;
  created_at: number;
  closed: boolean;
  waiting_for?: 'limit_price' | 'limit_amount' | 'tp_price' | 'sl_price' | 'buy_amount' | 'sell_amount';
}

export interface Trade {
    id: string;
    user_id: number;
    token_address: string;
    type: 'buy' | 'sell';
    price: number;
    size: number;
    total_usd: number;
    timestamp: number;
    tx_signature?: string;
}
