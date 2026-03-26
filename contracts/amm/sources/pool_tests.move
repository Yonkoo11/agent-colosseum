#[test_only]
module amm::pool_tests {
    use one::test_scenario::{Self as ts};
    use one::coin::{Self, Coin};
    use one::balance;
    use amm::pool::{Self, Pool, LP};
    use amm::cola::COLA;
    use amm::water::WATER;

    const ADMIN: address = @0xAD;
    const USER: address = @0xBB;

    // ===== Math tests =====

    #[test]
    fun test_sqrt_zero() {
        assert!(pool::sqrt_u128(0) == 0);
    }

    #[test]
    fun test_sqrt_one() {
        assert!(pool::sqrt_u128(1) == 1);
    }

    #[test]
    fun test_sqrt_perfect_squares() {
        assert!(pool::sqrt_u128(4) == 2);
        assert!(pool::sqrt_u128(9) == 3);
        assert!(pool::sqrt_u128(100) == 10);
        assert!(pool::sqrt_u128(10000) == 100);
        assert!(pool::sqrt_u128(1000000) == 1000);
    }

    #[test]
    fun test_sqrt_non_perfect() {
        // floor(sqrt(2)) = 1
        assert!(pool::sqrt_u128(2) == 1);
        // floor(sqrt(8)) = 2
        assert!(pool::sqrt_u128(8) == 2);
        // floor(sqrt(99)) = 9
        assert!(pool::sqrt_u128(99) == 9);
    }

    #[test]
    fun test_sqrt_large() {
        // sqrt(1e18) = 1e9
        assert!(pool::sqrt_u128(1_000_000_000_000_000_000) == 1_000_000_000);
        // sqrt(1e24) = 1e12
        assert!(pool::sqrt_u128(1_000_000_000_000_000_000_000_000) == 1_000_000_000_000);
    }

    #[test]
    fun test_swap_output_formula() {
        // Pool: 1000 X, 1000 Y, fee 30 bps
        // Swap 100 X -> Y
        // dx_net = 100 * 9970 / 10000 = 99.7
        // dy = 1000 * 99.7 / (1000 + 99.7) = 99700 / 1099.7 = 90.66... -> 90
        let out = pool::calc_swap_output(100, 1000, 1000, 30);
        assert!(out == 90, 0);
    }

    #[test]
    fun test_fee_calculation() {
        // Use larger numbers so fee difference is visible after rounding
        // No fee: dy = 1e9 * 1e8 / (1e9 + 1e8) = 1e17/1.1e9 = 90909090
        let out_no_fee = pool::calc_swap_output(100_000_000, 1_000_000_000, 1_000_000_000, 0);
        let out_with_fee = pool::calc_swap_output(100_000_000, 1_000_000_000, 1_000_000_000, 30);
        // Fee should reduce output
        assert!(out_with_fee < out_no_fee, 0);
        // No fee output: 90909090
        assert!(out_no_fee == 90_909_090, 1);
    }

    // ===== Integration tests =====

    fun mint_cola_for_testing(amount: u64, ctx: &mut TxContext): Coin<COLA> {
        coin::from_balance(balance::create_for_testing<COLA>(amount), ctx)
    }

    fun mint_water_for_testing(amount: u64, ctx: &mut TxContext): Coin<WATER> {
        coin::from_balance(balance::create_for_testing<WATER>(amount), ctx)
    }

    #[test]
    fun test_create_pool() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            // LP = sqrt(1e6 * 1e6) - 1000 = 1e6 - 1000 = 999000
            assert!(coin::value(&lp) == 999_000, 0);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let (rx, ry) = pool::reserves(&pool);
            assert!(rx == 1_000_000, 1);
            assert!(ry == 1_000_000, 2);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_swap_x_to_y() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        // Swap
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let cola_in = mint_cola_for_testing(100_000, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);
            // Output should be ~90661 (constant product with 0.3% fee)
            let out_val = coin::value(&water_out);
            assert!(out_val > 90_000 && out_val < 91_000, 0);
            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_swap_y_to_x() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let water_in = mint_water_for_testing(50_000, ctx);
            let cola_out = pool::swap_y_to_x(&mut pool, water_in, 0, ctx);
            let out_val = coin::value(&cola_out);
            // ~47534
            assert!(out_val > 47_000 && out_val < 48_000, 0);
            transfer::public_transfer(cola_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_swap_preserves_k() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let (rx_before, ry_before) = pool::reserves(&pool);
            let k_before = (rx_before as u128) * (ry_before as u128);

            let ctx = ts::ctx(&mut scenario);
            let cola_in = mint_cola_for_testing(100_000, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);

            let (rx_after, ry_after) = pool::reserves(&pool);
            let k_after = (rx_after as u128) * (ry_after as u128);

            // k should only increase (from fees)
            assert!(k_after >= k_before, 0);

            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_add_liquidity_proportional() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let lp_before = pool::lp_supply(&pool);
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(500_000, ctx);
            let water = mint_water_for_testing(500_000, ctx);
            let (lp, excess_x, excess_y) = pool::add_liquidity(&mut pool, cola, water, ctx);

            // Proportional: should mint 50% of existing LP
            let lp_val = coin::value(&lp);
            assert!(lp_val > 0, 0);

            // Excess should be zero for proportional deposit
            assert!(coin::value(&excess_x) == 0, 1);
            assert!(coin::value(&excess_y) == 0, 2);

            transfer::public_transfer(lp, USER);
            transfer::public_transfer(excess_x, USER);
            transfer::public_transfer(excess_y, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_add_liquidity_excess_returned() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            // Unequal amounts: 500k COLA, 200k WATER
            let cola = mint_cola_for_testing(500_000, ctx);
            let water = mint_water_for_testing(200_000, ctx);
            let (lp, excess_x, excess_y) = pool::add_liquidity(&mut pool, cola, water, ctx);

            // WATER is binding, so excess COLA should be returned
            assert!(coin::value(&lp) > 0, 0);
            assert!(coin::value(&excess_x) > 0, 1); // excess cola
            assert!(coin::value(&excess_y) == 0, 2); // no excess water

            transfer::public_transfer(lp, USER);
            transfer::public_transfer(excess_x, USER);
            transfer::public_transfer(excess_y, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_remove_liquidity() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let lp = ts::take_from_sender<Coin<LP<COLA, WATER>>>(&scenario);
            let lp_val = coin::value(&lp);
            let ctx = ts::ctx(&mut scenario);

            let (cola_out, water_out) = pool::remove_liquidity(&mut pool, lp, ctx);

            // Should get back almost all reserves (minus locked MINIMUM_LIQUIDITY share)
            assert!(coin::value(&cola_out) > 900_000, 0);
            assert!(coin::value(&water_out) > 900_000, 1);

            // Reserves must NOT be fully drained - locked LP protects them
            let (rx, ry) = pool::reserves(&pool);
            assert!(rx > 0, 2);
            assert!(ry > 0, 3);

            transfer::public_transfer(cola_out, ADMIN);
            transfer::public_transfer(water_out, ADMIN);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_remove_partial_liquidity() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let mut lp = ts::take_from_sender<Coin<LP<COLA, WATER>>>(&scenario);
            let lp_val = coin::value(&lp);
            let half = lp_val / 2;
            let ctx = ts::ctx(&mut scenario);

            // Split LP in half, remove only half
            let half_lp = coin::split(&mut lp, half, ctx);
            let (cola_out, water_out) = pool::remove_liquidity(&mut pool, half_lp, ctx);

            // Should get roughly half the reserves
            let cola_val = coin::value(&cola_out);
            let water_val = coin::value(&water_out);
            assert!(cola_val > 400_000 && cola_val < 600_000, 0);
            assert!(water_val > 400_000 && water_val < 600_000, 1);

            transfer::public_transfer(lp, ADMIN);
            transfer::public_transfer(cola_out, ADMIN);
            transfer::public_transfer(water_out, ADMIN);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 2)] // ESlippageExceeded
    fun test_slippage_protection() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let cola_in = mint_cola_for_testing(100_000, ctx);
            // min_out set absurdly high
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 999_999, ctx);
            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 0)] // EZeroInput
    fun test_zero_input_aborts() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let cola_in = mint_cola_for_testing(0, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);
            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_large_swap() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            // Large reserves to test u128 math
            let cola = mint_cola_for_testing(1_000_000_000_000, ctx);
            let water = mint_water_for_testing(1_000_000_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            // Swap 90% of reserve (stress test)
            let cola_in = mint_cola_for_testing(900_000_000_000, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);
            let out_val = coin::value(&water_out);
            // Should be close to but less than reserve_y
            assert!(out_val > 0 && out_val < 1_000_000_000_000, 0);
            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_small_swap() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000_000, ctx);
            let water = mint_water_for_testing(1_000_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            // Tiny swap: 100 units
            let cola_in = mint_cola_for_testing(100, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);
            // Should still produce non-zero output
            assert!(coin::value(&water_out) > 0, 0);
            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_multiple_swaps_maintain_invariant() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            let cola = mint_cola_for_testing(1_000_000, ctx);
            let water = mint_water_for_testing(1_000_000, ctx);
            let lp = pool::create_pool(cola, water, ctx);
            transfer::public_transfer(lp, ADMIN);
        };
        // Swap 1: X -> Y
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let (rx0, ry0) = pool::reserves(&pool);
            let k0 = (rx0 as u128) * (ry0 as u128);

            let ctx = ts::ctx(&mut scenario);
            let cola_in = mint_cola_for_testing(50_000, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);

            let (rx1, ry1) = pool::reserves(&pool);
            let k1 = (rx1 as u128) * (ry1 as u128);
            assert!(k1 >= k0, 0);

            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        // Swap 2: Y -> X
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let (rx1, ry1) = pool::reserves(&pool);
            let k1 = (rx1 as u128) * (ry1 as u128);

            let ctx = ts::ctx(&mut scenario);
            let water_in = mint_water_for_testing(30_000, ctx);
            let cola_out = pool::swap_y_to_x(&mut pool, water_in, 0, ctx);

            let (rx2, ry2) = pool::reserves(&pool);
            let k2 = (rx2 as u128) * (ry2 as u128);
            assert!(k2 >= k1, 1);

            transfer::public_transfer(cola_out, USER);
            ts::return_shared(pool);
        };
        // Swap 3: X -> Y again
        ts::next_tx(&mut scenario, USER);
        {
            let mut pool = ts::take_shared<Pool<COLA, WATER>>(&scenario);
            let (rx2, ry2) = pool::reserves(&pool);
            let k2 = (rx2 as u128) * (ry2 as u128);

            let ctx = ts::ctx(&mut scenario);
            let cola_in = mint_cola_for_testing(200_000, ctx);
            let water_out = pool::swap_x_to_y(&mut pool, cola_in, 0, ctx);

            let (rx3, ry3) = pool::reserves(&pool);
            let k3 = (rx3 as u128) * (ry3 as u128);
            assert!(k3 >= k2, 2);

            transfer::public_transfer(water_out, USER);
            ts::return_shared(pool);
        };
        ts::end(scenario);
    }
}
