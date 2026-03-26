module amm::pool {
    use one::coin::{Self, Coin, TreasuryCap};
    use one::balance::{Self, Balance, Supply};
    use one::event;
    use std::option;

    // ===== Errors =====
    const EZeroInput: u64 = 0;
    const EZeroReserves: u64 = 1;
    const ESlippageExceeded: u64 = 2;
    const EInsufficientLiquidity: u64 = 3;
    const EInvariantViolation: u64 = 4;
    const EZeroLPMinted: u64 = 5;
    const EInsufficientInitialLiquidity: u64 = 6;

    // ===== Constants =====
    const MINIMUM_LIQUIDITY: u64 = 1000;
    const FEE_BPS: u64 = 30; // 0.3%
    const BPS_DENOMINATOR: u64 = 10000;

    // ===== Types =====

    /// One-time witness for LP token
    public struct LP<phantom X, phantom Y> has drop {}

    /// Constant-product AMM pool (shared object)
    public struct Pool<phantom X, phantom Y> has key {
        id: UID,
        reserve_x: Balance<X>,
        reserve_y: Balance<Y>,
        lp_supply: Supply<LP<X, Y>>,
        locked_lp: Balance<LP<X, Y>>,
        fee_bps: u64,
    }

    // ===== Events =====

    public struct PoolCreated has copy, drop {
        pool_id: ID,
        initial_x: u64,
        initial_y: u64,
        lp_minted: u64,
    }

    public struct Swapped has copy, drop {
        pool_id: ID,
        sender: address,
        amount_in: u64,
        amount_out: u64,
        x_to_y: bool,
    }

    public struct LiquidityAdded has copy, drop {
        pool_id: ID,
        sender: address,
        amount_x: u64,
        amount_y: u64,
        lp_minted: u64,
    }

    public struct LiquidityRemoved has copy, drop {
        pool_id: ID,
        sender: address,
        amount_x: u64,
        amount_y: u64,
        lp_burned: u64,
    }

    // ===== Math helpers =====

    /// Integer square root for u128 (Babylonian method)
    public fun sqrt_u128(x: u128): u128 {
        if (x == 0) return 0;
        if (x == 1) return 1;

        let mut z = x;
        let mut y = (z + 1) / 2;
        while (y < z) {
            z = y;
            y = (z + x / z) / 2;
        };
        z
    }

    // ===== Pool creation =====

    /// Create a new AMM pool with initial liquidity.
    /// Initial LP = sqrt(x * y) - MINIMUM_LIQUIDITY (locked forever to prevent zero-division).
    /// Returns LP coins to the creator.
    public fun create_pool<X, Y>(
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        ctx: &mut TxContext,
    ): Coin<LP<X, Y>> {
        let amount_x = coin::value(&coin_x);
        let amount_y = coin::value(&coin_y);
        assert!(amount_x > 0 && amount_y > 0, EZeroInput);

        let initial_lp = (sqrt_u128((amount_x as u128) * (amount_y as u128)) as u64);
        assert!(initial_lp > MINIMUM_LIQUIDITY, EInsufficientInitialLiquidity);

        let mut lp_supply = balance::create_supply(LP<X, Y> {});

        // Mint total LP. MINIMUM_LIQUIDITY stays locked inside the pool forever
        // so no one can drain reserves to zero by burning all LP.
        let total_lp_balance = balance::increase_supply(&mut lp_supply, initial_lp);

        let mut lp_bal = total_lp_balance;
        let locked = balance::split(&mut lp_bal, MINIMUM_LIQUIDITY);

        let lp_coin = coin::from_balance(lp_bal, ctx);

        let pool = Pool<X, Y> {
            id: object::new(ctx),
            reserve_x: coin::into_balance(coin_x),
            reserve_y: coin::into_balance(coin_y),
            lp_supply,
            locked_lp: locked,
            fee_bps: FEE_BPS,
        };

        let pool_id = object::id(&pool);

        event::emit(PoolCreated {
            pool_id,
            initial_x: amount_x,
            initial_y: amount_y,
            lp_minted: initial_lp - MINIMUM_LIQUIDITY,
        });

        transfer::share_object(pool);

        lp_coin
    }

    // ===== Swap functions =====

    /// Swap coin X for coin Y. Returns Y coins.
    /// Uses constant-product formula with fee.
    /// Aborts if output < min_out (slippage protection).
    public fun swap_x_to_y<X, Y>(
        pool: &mut Pool<X, Y>,
        coin_in: Coin<X>,
        min_out: u64,
        ctx: &mut TxContext,
    ): Coin<Y> {
        let dx = coin::value(&coin_in);
        assert!(dx > 0, EZeroInput);

        let reserve_x = balance::value(&pool.reserve_x);
        let reserve_y = balance::value(&pool.reserve_y);
        assert!(reserve_x > 0 && reserve_y > 0, EZeroReserves);

        // Calculate output: dy = reserve_y * dx_net / (reserve_x + dx_net)
        // Fee applied to input
        let dx_net = (dx as u128) * ((BPS_DENOMINATOR - pool.fee_bps) as u128) / (BPS_DENOMINATOR as u128);
        let dy = (reserve_y as u128) * dx_net / ((reserve_x as u128) + dx_net);
        let dy_out = (dy as u64);

        assert!(dy_out >= min_out, ESlippageExceeded);
        assert!(dy_out > 0, EZeroInput);

        // Invariant check: new_rx * new_ry >= old_rx * old_ry
        // We check with u128 to prevent overflow
        let old_k = (reserve_x as u128) * (reserve_y as u128);
        let new_k = ((reserve_x + dx) as u128) * ((reserve_y - dy_out) as u128);
        assert!(new_k >= old_k, EInvariantViolation);

        // Execute swap
        balance::join(&mut pool.reserve_x, coin::into_balance(coin_in));
        let out_balance = balance::split(&mut pool.reserve_y, dy_out);

        event::emit(Swapped {
            pool_id: object::id(pool),
            sender: ctx.sender(),
            amount_in: dx,
            amount_out: dy_out,
            x_to_y: true,
        });

        coin::from_balance(out_balance, ctx)
    }

    /// Swap coin Y for coin X. Returns X coins.
    public fun swap_y_to_x<X, Y>(
        pool: &mut Pool<X, Y>,
        coin_in: Coin<Y>,
        min_out: u64,
        ctx: &mut TxContext,
    ): Coin<X> {
        let dy = coin::value(&coin_in);
        assert!(dy > 0, EZeroInput);

        let reserve_x = balance::value(&pool.reserve_x);
        let reserve_y = balance::value(&pool.reserve_y);
        assert!(reserve_x > 0 && reserve_y > 0, EZeroReserves);

        let dy_net = (dy as u128) * ((BPS_DENOMINATOR - pool.fee_bps) as u128) / (BPS_DENOMINATOR as u128);
        let dx = (reserve_x as u128) * dy_net / ((reserve_y as u128) + dy_net);
        let dx_out = (dx as u64);

        assert!(dx_out >= min_out, ESlippageExceeded);
        assert!(dx_out > 0, EZeroInput);

        let old_k = (reserve_x as u128) * (reserve_y as u128);
        let new_k = ((reserve_x - dx_out) as u128) * ((reserve_y + dy) as u128);
        assert!(new_k >= old_k, EInvariantViolation);

        balance::join(&mut pool.reserve_y, coin::into_balance(coin_in));
        let out_balance = balance::split(&mut pool.reserve_x, dx_out);

        event::emit(Swapped {
            pool_id: object::id(pool),
            sender: ctx.sender(),
            amount_in: dy,
            amount_out: dx_out,
            x_to_y: false,
        });

        coin::from_balance(out_balance, ctx)
    }

    // ===== Liquidity functions =====

    /// Add liquidity to pool. Deposits proportional amounts, returns LP tokens.
    /// Any excess of one token is returned to the sender.
    public fun add_liquidity<X, Y>(
        pool: &mut Pool<X, Y>,
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        ctx: &mut TxContext,
    ): (Coin<LP<X, Y>>, Coin<X>, Coin<Y>) {
        let dx = coin::value(&coin_x);
        let dy = coin::value(&coin_y);
        assert!(dx > 0 && dy > 0, EZeroInput);

        let reserve_x = balance::value(&pool.reserve_x);
        let reserve_y = balance::value(&pool.reserve_y);
        let total_lp = balance::supply_value(&pool.lp_supply);

        // Calculate LP tokens to mint: min(dx * total_lp / reserve_x, dy * total_lp / reserve_y)
        let lp_from_x = (dx as u128) * (total_lp as u128) / (reserve_x as u128);
        let lp_from_y = (dy as u128) * (total_lp as u128) / (reserve_y as u128);

        let lp_to_mint;
        let used_x;
        let used_y;

        if (lp_from_x <= lp_from_y) {
            // X is the binding constraint
            lp_to_mint = (lp_from_x as u64);
            used_x = dx;
            // Actual Y used = dy * lp_from_x / lp_from_y, but simpler: used_y = reserve_y * dx / reserve_x
            used_y = ((reserve_y as u128) * (dx as u128) / (reserve_x as u128) as u64);
        } else {
            // Y is the binding constraint
            lp_to_mint = (lp_from_y as u64);
            used_x = ((reserve_x as u128) * (dy as u128) / (reserve_y as u128) as u64);
            used_y = dy;
        };

        assert!(lp_to_mint > 0, EZeroLPMinted);

        // Deposit used amounts
        let mut bal_x = coin::into_balance(coin_x);
        let mut bal_y = coin::into_balance(coin_y);

        // Split excess
        let excess_x = if (used_x < dx) {
            balance::split(&mut bal_x, dx - used_x)
        } else {
            balance::zero<X>()
        };
        let excess_y = if (used_y < dy) {
            balance::split(&mut bal_y, dy - used_y)
        } else {
            balance::zero<Y>()
        };

        balance::join(&mut pool.reserve_x, bal_x);
        balance::join(&mut pool.reserve_y, bal_y);

        let lp_balance = balance::increase_supply(&mut pool.lp_supply, lp_to_mint);

        event::emit(LiquidityAdded {
            pool_id: object::id(pool),
            sender: ctx.sender(),
            amount_x: used_x,
            amount_y: used_y,
            lp_minted: lp_to_mint,
        });

        (
            coin::from_balance(lp_balance, ctx),
            coin::from_balance(excess_x, ctx),
            coin::from_balance(excess_y, ctx),
        )
    }

    /// Remove liquidity from pool. Burns LP tokens, returns proportional X and Y.
    public fun remove_liquidity<X, Y>(
        pool: &mut Pool<X, Y>,
        lp_coin: Coin<LP<X, Y>>,
        ctx: &mut TxContext,
    ): (Coin<X>, Coin<Y>) {
        let lp_amount = coin::value(&lp_coin);
        assert!(lp_amount > 0, EZeroInput);

        let reserve_x = balance::value(&pool.reserve_x);
        let reserve_y = balance::value(&pool.reserve_y);
        let total_lp = balance::supply_value(&pool.lp_supply);

        // Proportional share
        let amount_x = ((reserve_x as u128) * (lp_amount as u128) / (total_lp as u128) as u64);
        let amount_y = ((reserve_y as u128) * (lp_amount as u128) / (total_lp as u128) as u64);

        assert!(amount_x > 0 && amount_y > 0, EInsufficientLiquidity);

        // Burn LP
        balance::decrease_supply(&mut pool.lp_supply, coin::into_balance(lp_coin));

        // Withdraw proportional reserves
        let out_x = balance::split(&mut pool.reserve_x, amount_x);
        let out_y = balance::split(&mut pool.reserve_y, amount_y);

        event::emit(LiquidityRemoved {
            pool_id: object::id(pool),
            sender: ctx.sender(),
            amount_x,
            amount_y,
            lp_burned: lp_amount,
        });

        (coin::from_balance(out_x, ctx), coin::from_balance(out_y, ctx))
    }

    // ===== View functions =====

    public fun reserves<X, Y>(pool: &Pool<X, Y>): (u64, u64) {
        (balance::value(&pool.reserve_x), balance::value(&pool.reserve_y))
    }

    public fun lp_supply<X, Y>(pool: &Pool<X, Y>): u64 {
        balance::supply_value(&pool.lp_supply)
    }

    public fun fee_bps<X, Y>(pool: &Pool<X, Y>): u64 {
        pool.fee_bps
    }

    /// Calculate expected output for a swap (view function, no state change)
    public fun calc_swap_output(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u64,
    ): u64 {
        let dx_net = (amount_in as u128) * ((BPS_DENOMINATOR - fee_bps) as u128) / (BPS_DENOMINATOR as u128);
        let dy = (reserve_out as u128) * dx_net / ((reserve_in as u128) + dx_net);
        (dy as u64)
    }

    // ===== Entry wrappers for CLI/SDK usage =====

    public entry fun create_pool_entry<X, Y>(
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        ctx: &mut TxContext,
    ) {
        let lp = create_pool(coin_x, coin_y, ctx);
        transfer::public_transfer(lp, ctx.sender());
    }

    public entry fun swap_x_to_y_entry<X, Y>(
        pool: &mut Pool<X, Y>,
        coin_in: Coin<X>,
        min_out: u64,
        ctx: &mut TxContext,
    ) {
        let out = swap_x_to_y(pool, coin_in, min_out, ctx);
        transfer::public_transfer(out, ctx.sender());
    }

    public entry fun swap_y_to_x_entry<X, Y>(
        pool: &mut Pool<X, Y>,
        coin_in: Coin<Y>,
        min_out: u64,
        ctx: &mut TxContext,
    ) {
        let out = swap_y_to_x(pool, coin_in, min_out, ctx);
        transfer::public_transfer(out, ctx.sender());
    }

    public entry fun add_liquidity_entry<X, Y>(
        pool: &mut Pool<X, Y>,
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        ctx: &mut TxContext,
    ) {
        let (lp, excess_x, excess_y) = add_liquidity(pool, coin_x, coin_y, ctx);
        let sender = ctx.sender();
        transfer::public_transfer(lp, sender);
        transfer::public_transfer(excess_x, sender);
        transfer::public_transfer(excess_y, sender);
    }

    public entry fun remove_liquidity_entry<X, Y>(
        pool: &mut Pool<X, Y>,
        lp_coin: Coin<LP<X, Y>>,
        ctx: &mut TxContext,
    ) {
        let (coin_x, coin_y) = remove_liquidity(pool, lp_coin, ctx);
        let sender = ctx.sender();
        transfer::public_transfer(coin_x, sender);
        transfer::public_transfer(coin_y, sender);
    }
}
