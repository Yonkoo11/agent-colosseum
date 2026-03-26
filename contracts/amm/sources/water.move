module amm::water {
    use one::coin::{Self, TreasuryCap};
    use std::option;

    public struct WATER has drop {}

    public struct WaterTreasury has key {
        id: UID,
        cap: TreasuryCap<WATER>,
    }

    fun init(witness: WATER, ctx: &mut TxContext) {
        let (cap, metadata) = coin::create_currency(
            witness,
            9,
            b"WATER",
            b"Water Token",
            b"Test token for Agent Colosseum AMM",
            option::none(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        transfer::share_object(WaterTreasury {
            id: object::new(ctx),
            cap,
        });
    }

    public entry fun mint(
        treasury: &mut WaterTreasury,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let minted = coin::mint(&mut treasury.cap, amount, ctx);
        transfer::public_transfer(minted, recipient);
    }
}
