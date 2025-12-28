import { RealtimeChannel } from '@supabase/supabase-js';
import supabase from './SupabaseClient';
import { EventEmitter } from 'events';

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimePayload<T = any> {
  eventType: RealtimeEvent;
  new: T;
  old: T;
  table: string;
}

class RealtimeService extends EventEmitter {
  private channels: Map<string, RealtimeChannel> = new Map();
  private connected: boolean = false;

  /**
   * Подписка на изменения таблицы Order
   */
  subscribeToOrders(callback: (payload: RealtimePayload) => void) {
    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'Order',
        },
        (payload) => {
          console.log('[Realtime] Order changed:', payload);
          this.connected = true;
          callback({
            eventType: payload.eventType as RealtimeEvent,
            new: payload.new,
            old: payload.old,
            table: 'Order',
          });
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Orders subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          this.connected = true;
        }
      });

    this.channels.set('orders', channel);
    return channel;
  }

  /**
   * Подписка на изменения таблицы Position
   */
  subscribeToPositions(callback: (payload: RealtimePayload) => void) {
    const channel = supabase
      .channel('positions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'Position',
        },
        (payload) => {
          console.log('[Realtime] Position changed:', payload);
          this.connected = true;
          callback({
            eventType: payload.eventType as RealtimeEvent,
            new: payload.new,
            old: payload.old,
            table: 'Position',
          });
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Positions subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          this.connected = true;
        }
      });

    this.channels.set('positions', channel);
    return channel;
  }

  /**
   * Подписка на изменения таблицы Trade
   */
  subscribeToTrades(callback: (payload: RealtimePayload) => void) {
    const channel = supabase
      .channel('trades-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT', // Только новые сделки
          schema: 'public',
          table: 'Trade',
        },
        (payload) => {
          console.log('[Realtime] Trade created:', payload);
          this.connected = true;
          callback({
            eventType: 'INSERT',
            new: payload.new,
            old: payload.old,
            table: 'Trade',
          });
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Trades subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          this.connected = true;
        }
      });

    this.channels.set('trades', channel);
    return channel;
  }

  /**
   * Проверить, подключен ли Realtime
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Получить количество активных каналов
   */
  getActiveChannelsCount(): number {
    return this.channels.size;
  }

  /**
   * Отписаться от всех каналов
   */
  async unsubscribeAll() {
    for (const [name, channel] of this.channels) {
      await supabase.removeChannel(channel);
      console.log(`[Realtime] Unsubscribed from ${name}`);
    }
    this.channels.clear();
    this.connected = false;
  }

  /**
   * Отписаться от конкретного канала
   */
  async unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName);
    if (channel) {
      await supabase.removeChannel(channel);
      this.channels.delete(channelName);
      console.log(`[Realtime] Unsubscribed from ${channelName}`);
      if (this.channels.size === 0) {
        this.connected = false;
      }
    }
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
