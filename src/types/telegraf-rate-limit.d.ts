import { Middleware } from 'telegraf';

declare module 'telegraf-ratelimit' {
  interface RateLimitOptions {
    window?: number;
    limit?: number;
    keyGenerator?: (ctx: any) => any;
    onLimitExceeded?: (ctx: any, next?: () => void) => void;
  }

  function rateLimit(options?: RateLimitOptions): Middleware;
  
  export = rateLimit;
}