module colosseum::arena {
    use one::coin::{Self, Coin};
    use one::balance::{Self, Balance};
    use one::event;
    use one::oct::OCT;

    // ===== Errors =====
    const ENotAdmin: u64 = 0;
    const EArenaFull: u64 = 1;
    const ENotRegistered: u64 = 2;
    const ERoundNotActive: u64 = 3;
    const EInsufficientEntryFee: u64 = 4;
    const ENotWinner: u64 = 5;
    const ERoundNotEnded: u64 = 6;
    const EAlreadyRegistered: u64 = 7;
    const EInvalidName: u64 = 8;

    // ===== Constants =====
    const PNL_OFFSET: u64 = 1_000_000_000_000_000_000; // 1e18 offset for unsigned PnL
    const PRICE_SCALE: u128 = 1_000_000_000; // 1e9 fixed-point scale for prices

    // ===== Types =====

    /// Arena: the competition venue (shared object)
    public struct Arena has key {
        id: UID,
        admin: address,
        round: u64,
        entry_fee: u64,
        prize_pool: Balance<OCT>,
        max_agents: u64,
        agent_count: u64,
        active: bool,
    }

    /// Agent profile: tracks an agent's performance in an arena (owned object)
    public struct AgentProfile has key, store {
        id: UID,
        owner: address,
        name: vector<u8>,
        arena_id: ID,
        balance_x: u64,
        balance_y: u64,
        initial_value: u64,
        trades: u64,
        wins: u64,
        cumulative_pnl: u64, // offset by PNL_OFFSET to avoid signed ints
    }

    // ===== Events =====

    public struct ArenaCreated has copy, drop {
        arena_id: ID,
        admin: address,
        entry_fee: u64,
        max_agents: u64,
    }

    public struct AgentRegistered has copy, drop {
        arena_id: ID,
        agent_id: ID,
        owner: address,
        name: vector<u8>,
    }

    public struct TradeRecorded has copy, drop {
        arena_id: ID,
        agent_id: ID,
        balance_x: u64,
        balance_y: u64,
        trade_number: u64,
    }

    public struct RoundEnded has copy, drop {
        arena_id: ID,
        round: u64,
    }

    public struct PrizeClaimed has copy, drop {
        arena_id: ID,
        agent_id: ID,
        amount: u64,
    }

    // ===== Arena creation =====

    public entry fun create_arena(
        entry_fee: u64,
        max_agents: u64,
        ctx: &mut TxContext,
    ) {
        let arena = Arena {
            id: object::new(ctx),
            admin: ctx.sender(),
            round: 0,
            entry_fee,
            prize_pool: balance::zero(),
            max_agents,
            agent_count: 0,
            active: true,
        };

        event::emit(ArenaCreated {
            arena_id: object::id(&arena),
            admin: ctx.sender(),
            entry_fee,
            max_agents,
        });

        transfer::share_object(arena);
    }

    // ===== Agent registration =====

    public entry fun register_agent(
        arena: &mut Arena,
        name: vector<u8>,
        entry_payment: Coin<OCT>,
        initial_balance_x: u64,
        initial_balance_y: u64,
        price_y_per_x: u64, // price of X in terms of Y, scaled by 1e9
        ctx: &mut TxContext,
    ) {
        assert!(arena.active, ERoundNotActive);
        assert!(arena.agent_count < arena.max_agents, EArenaFull);
        assert!(name.length() > 0 && name.length() <= 32, EInvalidName);
        assert!(coin::value(&entry_payment) >= arena.entry_fee, EInsufficientEntryFee);

        // Add entry fee to prize pool
        balance::join(&mut arena.prize_pool, coin::into_balance(entry_payment));
        arena.agent_count = arena.agent_count + 1;

        // Value everything in Y terms: value = balance_x * price / 1e9 + balance_y
        let initial_value = (
            (initial_balance_x as u128) * (price_y_per_x as u128) / PRICE_SCALE
            + (initial_balance_y as u128)
        as u64);

        let profile = AgentProfile {
            id: object::new(ctx),
            owner: ctx.sender(),
            name,
            arena_id: object::id(arena),
            balance_x: initial_balance_x,
            balance_y: initial_balance_y,
            initial_value,
            trades: 0,
            wins: 0,
            cumulative_pnl: PNL_OFFSET, // starts at offset (neutral)
        };

        event::emit(AgentRegistered {
            arena_id: object::id(arena),
            agent_id: object::id(&profile),
            owner: ctx.sender(),
            name: profile.name,
        });

        transfer::public_transfer(profile, ctx.sender());
    }

    // ===== Trade recording =====

    /// Record a trade result. Called after an AMM swap to update agent tracking.
    /// price_y_per_x: current market price of X in Y terms, scaled by 1e9
    public entry fun record_trade(
        profile: &mut AgentProfile,
        new_balance_x: u64,
        new_balance_y: u64,
        price_y_per_x: u64,
        _ctx: &mut TxContext,
    ) {
        profile.balance_x = new_balance_x;
        profile.balance_y = new_balance_y;
        profile.trades = profile.trades + 1;

        // Value in Y terms: balance_x * price / 1e9 + balance_y
        let current_value = (
            (new_balance_x as u128) * (price_y_per_x as u128) / PRICE_SCALE
            + (new_balance_y as u128)
        as u64);

        if (current_value >= profile.initial_value) {
            profile.cumulative_pnl = PNL_OFFSET + (current_value - profile.initial_value);
        } else {
            profile.cumulative_pnl = PNL_OFFSET - (profile.initial_value - current_value);
        };

        event::emit(TradeRecorded {
            arena_id: profile.arena_id,
            agent_id: object::id(profile),
            balance_x: new_balance_x,
            balance_y: new_balance_y,
            trade_number: profile.trades,
        });
    }

    // ===== Round management =====

    public entry fun end_round(
        arena: &mut Arena,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == arena.admin, ENotAdmin);

        event::emit(RoundEnded {
            arena_id: object::id(arena),
            round: arena.round,
        });

        arena.round = arena.round + 1;
    }

    public entry fun close_arena(
        arena: &mut Arena,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == arena.admin, ENotAdmin);
        arena.active = false;
    }

    // ===== Prize distribution =====

    public entry fun distribute_prize(
        arena: &mut Arena,
        profile: &mut AgentProfile,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == arena.admin, ENotAdmin);
        assert!(profile.arena_id == object::id(arena), ENotRegistered);

        let prize_balance = balance::split(&mut arena.prize_pool, amount);
        let prize_coin = coin::from_balance(prize_balance, ctx);

        profile.wins = profile.wins + 1;

        event::emit(PrizeClaimed {
            arena_id: object::id(arena),
            agent_id: object::id(profile),
            amount,
        });

        transfer::public_transfer(prize_coin, profile.owner);
    }

    // ===== View functions =====

    public fun arena_info(arena: &Arena): (u64, u64, u64, u64, bool) {
        (
            arena.round,
            arena.entry_fee,
            balance::value(&arena.prize_pool),
            arena.agent_count,
            arena.active,
        )
    }

    public fun agent_stats(profile: &AgentProfile): (u64, u64, u64, u64, u64) {
        (
            profile.balance_x,
            profile.balance_y,
            profile.trades,
            profile.wins,
            profile.cumulative_pnl,
        )
    }

    public fun agent_name(profile: &AgentProfile): vector<u8> {
        profile.name
    }

    public fun agent_owner(profile: &AgentProfile): address {
        profile.owner
    }

    public fun agent_pnl(profile: &AgentProfile): u64 {
        profile.cumulative_pnl
    }

    public fun pnl_offset(): u64 {
        PNL_OFFSET
    }

    public fun price_scale(): u64 {
        (PRICE_SCALE as u64)
    }
}
