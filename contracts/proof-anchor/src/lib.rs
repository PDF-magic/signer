#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, BytesN, Env};

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub struct AnchorReceipt {
    pub proof_hash: BytesN<32>,
    pub ledger: u32,
    pub ledger_timestamp: u64,
}

#[contract]
pub struct ProofAnchor;

#[contractimpl]
impl ProofAnchor {
    pub fn anchor(env: Env, proof_hash: BytesN<32>) -> AnchorReceipt {
        let receipt = AnchorReceipt {
            proof_hash,
            ledger: env.ledger().sequence(),
            ledger_timestamp: env.ledger().timestamp(),
        };
        env.events().publish((symbol_short!("proof"),), receipt.clone());
        receipt
    }
}

#[cfg(test)]
mod test {
    use super::{ProofAnchor, ProofAnchorClient};
    use soroban_sdk::{BytesN, Env};

    #[test]
    fn anchors_the_exact_digest() {
        let env = Env::default();
        let contract_id = env.register(ProofAnchor, ());
        let client = ProofAnchorClient::new(&env, &contract_id);
        let digest = BytesN::from_array(&env, &[7; 32]);

        let receipt = client.anchor(&digest);

        assert_eq!(receipt.proof_hash, digest);
        assert_eq!(receipt.ledger, env.ledger().sequence());
        assert_eq!(receipt.ledger_timestamp, env.ledger().timestamp());
    }
}
