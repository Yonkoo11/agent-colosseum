#[test_only]
module colosseum::arena_tests {
    use one::test_scenario::{Self as ts};
    use one::coin::{Self, Coin};
    use one::balance;
    use one::oct::OCT;
    use colosseum::arena::{Self, Arena, AgentProfile};

    const ADMIN: address = @0xAD;
    const AGENT1: address = @0xA1;
    const AGENT2: address = @0xA2;

    fun mint_oct_for_testing(amount: u64, ctx: &mut TxContext): Coin<OCT> {
        coin::from_balance(balance::create_for_testing<OCT>(amount), ctx)
    }

    #[test]
    fun test_create_arena() {
        let mut scenario = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut scenario);
            arena::create_arena(1_000_000_000, 10, ctx); // 1 OCT entry, 10 max agents
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let a = ts::take_shared<Arena>(&scenario);
            let (round, fee, prize, count, active) = arena::arena_info(&a);
            assert!(round == 0, 0);
            assert!(fee == 1_000_000_000, 1);
            assert!(prize == 0, 2);
            assert!(count == 0, 3);
            assert!(active == true, 4);
            ts::return_shared(a);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_register_agent() {
        let mut scenario = ts::begin(ADMIN);
        {
            arena::create_arena(1_000_000_000, 10, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AGENT1);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let payment = mint_oct_for_testing(1_000_000_000, ctx);
            arena::register_agent(&mut a, b"MomentumBot", payment, 500_000, 500_000, 1_000_000_000, ctx);
            ts::return_shared(a);
        };
        ts::next_tx(&mut scenario, AGENT1);
        {
            let a = ts::take_shared<Arena>(&scenario);
            let (_, _, prize, count, _) = arena::arena_info(&a);
            assert!(count == 1, 0);
            assert!(prize == 1_000_000_000, 1);

            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            let (bx, by, trades, wins, pnl) = arena::agent_stats(&profile);
            assert!(bx == 500_000, 2);
            assert!(by == 500_000, 3);
            assert!(trades == 0, 4);
            assert!(pnl == arena::pnl_offset(), 5);

            ts::return_to_sender(&scenario, profile);
            ts::return_shared(a);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_record_trade() {
        let mut scenario = ts::begin(ADMIN);
        {
            arena::create_arena(1_000_000_000, 10, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AGENT1);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let payment = mint_oct_for_testing(1_000_000_000, ctx);
            arena::register_agent(&mut a, b"TraderBot", payment, 500_000, 500_000, 1_000_000_000, ctx);
            ts::return_shared(a);
        };
        ts::next_tx(&mut scenario, AGENT1);
        {
            let mut profile = ts::take_from_sender<AgentProfile>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            // Simulate: swapped 100k X for 95k Y
            arena::record_trade(&mut profile, 400_000, 595_000, 1_000_000_000, ctx);
            let (bx, by, trades, _, pnl) = arena::agent_stats(&profile);
            assert!(bx == 400_000, 0);
            assert!(by == 595_000, 1);
            assert!(trades == 1, 2);
            // PnL: current (995000) - initial (1000000) = -5000, so pnl = offset - 5000
            assert!(pnl == arena::pnl_offset() - 5_000, 3);
            ts::return_to_sender(&scenario, profile);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_end_round() {
        let mut scenario = ts::begin(ADMIN);
        {
            arena::create_arena(0, 10, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            arena::end_round(&mut a, ts::ctx(&mut scenario));
            let (round, _, _, _, _) = arena::arena_info(&a);
            assert!(round == 1, 0);
            ts::return_shared(a);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_distribute_prize() {
        let mut scenario = ts::begin(ADMIN);
        {
            arena::create_arena(1_000_000_000, 10, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AGENT1);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let payment = mint_oct_for_testing(1_000_000_000, ctx);
            arena::register_agent(&mut a, b"Winner", payment, 500_000, 500_000, 1_000_000_000, ctx);
            ts::return_shared(a);
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            let mut profile = ts::take_from_address<AgentProfile>(&scenario, AGENT1);
            let ctx = ts::ctx(&mut scenario);
            arena::distribute_prize(&mut a, &mut profile, 500_000_000, ctx);
            let (_, _, _, wins, _) = arena::agent_stats(&profile);
            assert!(wins == 1, 0);
            ts::return_to_address(AGENT1, profile);
            ts::return_shared(a);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1)] // EArenaFull
    fun test_arena_full() {
        let mut scenario = ts::begin(ADMIN);
        {
            arena::create_arena(0, 1, ts::ctx(&mut scenario)); // max 1 agent
        };
        // Register first agent
        ts::next_tx(&mut scenario, AGENT1);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let payment = mint_oct_for_testing(0, ctx);
            arena::register_agent(&mut a, b"Agent1", payment, 0, 0, 1_000_000_000, ctx);
            ts::return_shared(a);
        };
        // Second should fail
        ts::next_tx(&mut scenario, AGENT2);
        {
            let mut a = ts::take_shared<Arena>(&scenario);
            let ctx = ts::ctx(&mut scenario);
            let payment = mint_oct_for_testing(0, ctx);
            arena::register_agent(&mut a, b"Agent2", payment, 0, 0, 1_000_000_000, ctx);
            ts::return_shared(a);
        };
        ts::end(scenario);
    }
}
