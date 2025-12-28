import { ITradingStrategy, SwapParams, UserSettings, QuoteResult } from './ITradingStrategy';

export class TradeRouter {
  private strategiesByChain: Map<string, ITradingStrategy[]> = new Map();

  constructor(strategies: ITradingStrategy[]) {
    for (const strat of strategies) {
      const list = this.strategiesByChain.get(strat.chain) ?? [];
      list.push(strat);
      this.strategiesByChain.set(strat.chain, list);
    }

    // ⭐ Сортировка по priority (от большего к меньшему)
    for (const [chain, strats] of this.strategiesByChain.entries()) {
      strats.sort((a, b) => b.priority - a.priority);
      this.strategiesByChain.set(chain, strats);
      
      console.log(`📊 Strategies for ${chain}:`);
      strats.forEach(s => console.log(`   - ${s.name} (priority: ${s.priority})`));
    }
  }

  async buy(
    chain: string,
    tokenMint: string,
    amountInBaseUnits: number,
    settings: UserSettings,
    userWallet: any
  ): Promise<{ signature: string; strategy: string; outputAmount: number }> {
    const strategies = this.strategiesByChain.get(chain);
    
    if (!strategies || strategies.length === 0) {
      throw new Error(`No strategies configured for chain ${chain}`);
    }

    console.log(`\n🔍 Finding strategy for ${chain} token: ${tokenMint}`);

    for (const strategy of strategies) {
      console.log(`   Checking ${strategy.name}...`);
      
      if (await strategy.canTrade(tokenMint)) {
        console.log(`   ✅ Using ${strategy.name} (priority: ${strategy.priority})\n`);

        const params: SwapParams = {
          tokenIn: this.getNativeMint(chain),
          tokenOut: tokenMint,
          amount: amountInBaseUnits,
          slippage: settings.slippage,
          userWallet,
        };

        // 1. Получаем котировку для определения outputAmount
        const quote = await strategy.getQuote(params);
        if (!quote || !quote.outputAmount) {
          console.warn(`   ⚠️ ${strategy.name} failed to provide a quote. Trying next strategy.`);
          continue;
        }

        // 2. Выполняем обмен
        const signature = await strategy.executeSwap(params, settings);
        
        // 3. Возвращаем расширенный результат
        return { signature, strategy: strategy.name, outputAmount: quote.outputAmount };
      }
    }

    throw new Error(`No strategy can trade token ${tokenMint} on ${chain}`);
  }

  async sell(
    chain: string,
    tokenMint: string,
    amountInBaseUnits: number,
    settings: UserSettings,
    userWallet: any
  ): Promise<{ signature: string; strategy: string; outputAmount: number }> {
    const strategies = this.strategiesByChain.get(chain);
    
    if (!strategies) {
      throw new Error(`No strategies for chain ${chain}`);
    }

    for (const strategy of strategies) {
      if (await strategy.canTrade(tokenMint)) {
        const params: SwapParams = {
          tokenIn: tokenMint,
          tokenOut: this.getNativeMint(chain),
          amount: amountInBaseUnits,
          slippage: settings.slippage,
          userWallet,
        };

        // 1. Получаем котировку для определения outputAmount
        const quote = await strategy.getQuote(params);
        if (!quote || !quote.outputAmount) {
          console.warn(`   ⚠️ ${strategy.name} failed to provide a quote for sell. Trying next strategy.`);
          continue;
        }

        // 2. Выполняем обмен
        const signature = await strategy.executeSwap(params, settings);

        // 3. Возвращаем расширенный результат
        return { signature, strategy: strategy.name, outputAmount: quote.outputAmount };
      }
    }

    throw new Error(`No strategy can trade token ${tokenMint}`);
  }

  async getQuote(
    chain: string,
    tokenMint: string,
    amountInBaseUnits: number,
    userWallet: any
  ): Promise<QuoteResult & { strategy: string }> {
    const strategies = this.strategiesByChain.get(chain);
    
    if (!strategies) {
      throw new Error(`No strategies for chain ${chain}`);
    }

    for (const strategy of strategies) {
      if (await strategy.canTrade(tokenMint)) {
        const params: SwapParams = {
          tokenIn: this.getNativeMint(chain),
          tokenOut: tokenMint,
          amount: amountInBaseUnits,
          slippage: 1.0,
          userWallet,
        };

        const quote = await strategy.getQuote(params);
        return { ...quote, strategy: strategy.name };
      }
    }

    throw new Error(`No strategy can quote token ${tokenMint}`);
  }

  private getNativeMint(chain: string): string {
    switch (chain) {
      case 'Solana':
        return 'So11111111111111111111111111111111111111112';
      case 'Ethereum':
      case 'BSC':
        return '0x0000000000000000000000000000000000000000';
      default:
        throw new Error(`Unknown chain: ${chain}`);
    }
  }

  getStrategiesForChain(chain: string): ITradingStrategy[] {
    return this.strategiesByChain.get(chain) ?? [];
  }

  isChainSupported(chain: string): boolean {
    return this.strategiesByChain.has(chain);
  }
}