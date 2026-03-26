module amm::cola {
    use one::coin::{Self, TreasuryCap};
    use std::option;

    public struct COLA has drop {}

    public struct ColaTreasury has key {
        id: UID,
        cap: TreasuryCap<COLA>,
    }

    fun init(witness: COLA, ctx: &mut TxContext) {
        let (cap, metadata) = coin::create_currency(
            witness,
            9,
            b"COLA",
            b"Cola Token",
            b"Test token for Agent Colosseum AMM",
            option::none(),
            ctx,
        );
        transfer::public_freeze_object(metadata);
        transfer::share_object(ColaTreasury {
            id: object::new(ctx),
            cap,
        });
    }

    public entry fun mint(
        treasury: &mut ColaTreasury,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let minted = coin::mint(&mut treasury.cap, amount, ctx);
        transfer::public_transfer(minted, recipient);
    }
}
