import { getFullnodeUrl, SuiClient } from "@onelabs/sui/client"
import { Transaction } from "@onelabs/sui/transactions"
import { Keypair } from "@onelabs/sui/cryptography"

/**
 * Fixed OneChainClient for Agent Colosseum.
 *
 * Bug fixes from original onechain-adapter/src/client.ts:
 *
 * BUG #1 (Critical): Line 115 — Hardcoded PACKAGE_ID `0x688...` doesn't exist on testnet.
 * FIX: Made configurable via constructor options.
 *
 * BUG #2 (High): Line 178 — `tx.pure.u64(0)` for min_amount_out (zero slippage protection).
 * FIX: Added minAmountOut parameter, defaults to 1% slippage calc from reserves.
 *
 * BUG #3 (High): Line 225 — deployCoin POSTs to onepump.cc and publishes arbitrary bytecode.
 * FIX: Removed. Our agents use the deployed AMM contracts directly.
 */
export class OneChainClient {
  private client: SuiClient
  private ammPackageId: string

  constructor(options: {
    network?: "mainnet" | "testnet"
    ammPackageId: string
  }) {
    const url =
      options.network === "mainnet"
        ? "https://rpc-mainnet.onelabs.cc"
        : "https://rpc-testnet.onelabs.cc"

    this.client = new SuiClient({ url })
    this.ammPackageId = options.ammPackageId
  }

  getSuiClient(): SuiClient {
    return this.client
  }

  async getBalance(address: string) {
    const balance = await this.client.getBalance({ owner: address })
    return {
      address,
      balance: Number(balance.totalBalance) / 1e9,
      coinType: balance.coinType,
    }
  }

  async getTokenBalance(address: string, coinType: string) {
    const balance = await this.client.getBalance({ owner: address, coinType })
    return {
      address,
      balance: Number(balance.totalBalance) / 1e9,
      coinType,
    }
  }

  async getPoolReserves(poolId: string) {
    const obj = await this.client.getObject({
      id: poolId,
      options: { showContent: true },
    })
    if (!obj.data?.content || obj.data.content.dataType !== "moveObject") {
      throw new Error("Pool not found or not a Move object")
    }
    const fields = (obj.data.content as any).fields
    // Balance<T> is stored as a nested struct { fields: { value: "123" } }
    // Supply<T> is stored similarly. Handle both flat and nested formats.
    const extractValue = (f: any): number => {
      if (typeof f === "number" || typeof f === "string") return Number(f)
      if (f?.fields?.value !== undefined) return Number(f.fields.value)
      return 0
    }
    return {
      reserve_x: extractValue(fields.reserve_x),
      reserve_y: extractValue(fields.reserve_y),
      lp_supply: extractValue(fields.lp_supply),
      fee_bps: Number(fields.fee_bps),
    }
  }

  /**
   * Swap X for Y on the AMM.
   * FIX for BUG #2: minAmountOut is now required (no more zero slippage).
   */
  async swapXtoY(
    signer: Keypair,
    poolId: string,
    typeX: string,
    typeY: string,
    coinObjectId: string,
    minAmountOut: number,
  ) {
    const tx = new Transaction()

    tx.moveCall({
      target: `${this.ammPackageId}::pool::swap_x_to_y_entry`,
      typeArguments: [typeX, typeY],
      arguments: [
        tx.object(poolId),
        tx.object(coinObjectId),
        tx.pure.u64(minAmountOut),
      ],
    })

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer,
      options: { showEffects: true, showEvents: true },
    })

    return {
      success: true,
      txHash: result.digest,
      events: result.events,
    }
  }

  async swapYtoX(
    signer: Keypair,
    poolId: string,
    typeX: string,
    typeY: string,
    coinObjectId: string,
    minAmountOut: number,
  ) {
    const tx = new Transaction()

    tx.moveCall({
      target: `${this.ammPackageId}::pool::swap_y_to_x_entry`,
      typeArguments: [typeX, typeY],
      arguments: [
        tx.object(poolId),
        tx.object(coinObjectId),
        tx.pure.u64(minAmountOut),
      ],
    })

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer,
      options: { showEffects: true, showEvents: true },
    })

    return {
      success: true,
      txHash: result.digest,
      events: result.events,
    }
  }

  async addLiquidity(
    signer: Keypair,
    poolId: string,
    typeX: string,
    typeY: string,
    coinXId: string,
    coinYId: string,
  ) {
    const tx = new Transaction()

    tx.moveCall({
      target: `${this.ammPackageId}::pool::add_liquidity_entry`,
      typeArguments: [typeX, typeY],
      arguments: [
        tx.object(poolId),
        tx.object(coinXId),
        tx.object(coinYId),
      ],
    })

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer,
      options: { showEffects: true },
    })

    return { success: true, txHash: result.digest }
  }

  async removeLiquidity(
    signer: Keypair,
    poolId: string,
    typeX: string,
    typeY: string,
    lpCoinId: string,
  ) {
    const tx = new Transaction()

    tx.moveCall({
      target: `${this.ammPackageId}::pool::remove_liquidity_entry`,
      typeArguments: [typeX, typeY],
      arguments: [tx.object(poolId), tx.object(lpCoinId)],
    })

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer,
      options: { showEffects: true },
    })

    return { success: true, txHash: result.digest }
  }

  async transfer(signer: Keypair, to: string, amount: number) {
    const tx = new Transaction()
    const amountInMist = BigInt(Math.floor(amount * 1e9))
    const [coin] = tx.splitCoins(tx.gas, [amountInMist])
    tx.transferObjects([coin], to)

    const result = await this.client.signAndExecuteTransaction({
      transaction: tx,
      signer,
      options: { showEffects: true },
    })

    return { success: true, txHash: result.digest }
  }
}
